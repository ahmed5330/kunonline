// Real migration schema, synthetic in-memory balances only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {billOrder} from '../src/wallet-orders.js';
import {approveTopup,rejectTopup} from '../src/wallet-topup-admin.js';
import {requestTopup} from '../src/wallet-topup-request.js';

function fixture({balance=23,fee=25,minimum=0}={}){
 const db=new DatabaseSync(':memory:');
 for(const name of fs.readdirSync('migrations').filter(n=>/^00(0[1-9]|1[0-4])_.*\.sql$/.test(n)).sort())db.exec(fs.readFileSync('migrations/'+name,'utf8'));
 db.exec('CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT)');
 const ts='2026-10-01T00:00:00Z';
 for(const id of ['qa','other']){
  db.prepare('INSERT INTO wallet_accounts(client_id,balance,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,status,updated_at) VALUES(?,?,?,0,0,?,\'v27\',\'active\',?)').run(id,balance,fee,Math.max(0,-balance),ts);
  db.prepare('INSERT INTO subscriptions(id,client_id,status,amount,created_at,updated_at) VALUES(?,?,\'active\',?,?,?)').run('SUB-'+id,id,minimum,ts,ts);
  db.prepare('INSERT INTO audit_log(id,client_id,action,created_at) VALUES(?,?,\'subscription.billing.start\',?)').run('START-'+id,id,ts);
 }
 let beforeBatch=null;
 class Statement{
  constructor(sql){this.sql=sql;this.args=[];}
  bind(...args){assert.ok(args.every(v=>v!==undefined));this.args=args;return this;}
  async first(column){const r=db.prepare(this.sql).get(...this.args)||null;return column&&r?r[column]:r;}
  async all(){return {results:db.prepare(this.sql).all(...this.args)};}
  async run(){const r=db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};}
 }
 const env={DB:{prepare:sql=>new Statement(sql)}};
 // D1 executes every statement in a batch as one serialized transaction.
 env.DB.batch=async statements=>{
  if(beforeBatch){const f=beforeBatch;beforeBatch=null;await f();}
  db.exec('BEGIN IMMEDIATE');try{const results=statements.map(st=>{const r=db.prepare(st.sql).run(...st.args);return {success:true,meta:{changes:Number(r.changes)}};});db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}
 };
 return {db,env,hook:f=>{beforeBatch=f;},balance:id=>db.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').get(id||'qa').balance,
  order:id=>db.prepare('INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES(?,\'qa\',\'shop\',\'2090-01-01\',\'2090-01-01T00:00:00Z\')').run(id),
  topup:id=>db.prepare('INSERT INTO wallet_topup_requests(id,client_id,amount,sender_phone,requested_at) VALUES(?,\'qa\',100,\'01000000000\',?)').run(id,ts)};
}

const duplicate=fixture();duplicate.order('SAME');
const repeated=await Promise.all([billOrder(duplicate.env,'SAME'),billOrder(duplicate.env,'SAME')]);
assert.ok(repeated.every(r=>r.status==='charged'),'same concurrent order must return its committed charge');
assert.equal(duplicate.balance(),-2);
assert.equal(duplicate.db.prepare('SELECT status FROM order_billing').get().status,'charged');
assert.equal(duplicate.db.prepare('SELECT COUNT(*) n FROM wallet_log').get().n,1);
duplicate.db.prepare("INSERT INTO orders(id,client_id,date,created_at) VALUES('OLD','qa','2020-01-01','2090-01-01')").run();
assert.equal((await billOrder(duplicate.env,'OLD')).status,'waived','late imported historical order must not be charged');
duplicate.order('COPY');duplicate.db.prepare("INSERT INTO order_duplicate_links VALUES('COPY','SAME')").run();
assert.equal((await billOrder(duplicate.env,'COPY')).skipped,'linked_duplicate_order');
assert.equal(duplicate.balance(),-2);
duplicate.db.close();

const rejected=fixture();rejected.topup('REJECT-RACE');
rejected.hook(()=>rejectTopup(rejected.env,'REJECT-RACE','admin'));
await assert.rejects(()=>approveTopup(rejected.env,'REJECT-RACE','admin'),e=>e.code==='TOPUP_NOT_PENDING');
assert.equal(rejected.balance(),23,'a concurrent rejection must prevent credit');
assert.equal(rejected.db.prepare('SELECT COUNT(*) n FROM wallet_log').get().n,0);
rejected.db.close();

const paid=fixture({balance:-2});paid.topup('PAY');
const results=await Promise.allSettled([approveTopup(paid.env,'PAY','admin'),approveTopup(paid.env,'PAY','admin')]);
assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
assert.equal(paid.balance(),98);assert.equal(paid.balance('other'),-2);
assert.equal(paid.db.prepare('SELECT COUNT(*) n FROM wallet_log').get().n,1);
await assert.rejects(()=>rejectTopup(paid.env,'PAY','admin'),e=>e.code==='TOPUP_NOT_PENDING');
paid.db.close();
console.log('Preview payment SQL races PASS: final-order deduplication, approval/rejection and tenant isolation.');
