/* Synthetic SQLite test: one final order can cross zero, no historic double charges. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {billOrder,reconcileUnbilledOrders} from '../src/wallet-orders.js';
import {subscriptionAccess} from '../src/subscription-billing.js';

function fixture(balance=23,fee=25){
 const db=new DatabaseSync(':memory:');
 db.exec([
 'CREATE TABLE state(id INTEGER PRIMARY KEY,json TEXT,updated_at TEXT)',
 'CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT)',
 'CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT)',
 'CREATE TABLE wallet_accounts(client_id TEXT PRIMARY KEY,balance REAL,currency TEXT,base_order_fee REAL,min_order_fee REAL,max_order_fee REAL,credit_limit REAL NOT NULL DEFAULT 0,billing_version TEXT,billing_start_rowid INTEGER,status TEXT,updated_at TEXT,CHECK (balance >= -credit_limit))',
 'CREATE TABLE subscriptions(id TEXT PRIMARY KEY,client_id TEXT,status TEXT,amount REAL,period_end TEXT,period_start TEXT,billing_cycle TEXT,currency TEXT,created_at TEXT)',
 'CREATE TABLE audit_log(id TEXT PRIMARY KEY,client_id TEXT,actor_email TEXT,action TEXT,entity_type TEXT,entity_id TEXT,metadata_json TEXT,created_at TEXT)',
 'CREATE TABLE order_billing(order_id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,fee REAL,status TEXT,attempts INTEGER,last_error TEXT,created_at TEXT,charged_at TEXT,updated_at TEXT,wallet_log_id TEXT)',
 'CREATE TABLE wallet_log(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,type TEXT,amount REAL,balance_after REAL,note TEXT,created_at TEXT,created_by TEXT,order_id TEXT,reference_type TEXT,reference_id TEXT,idempotency_key TEXT,metadata_json TEXT,UNIQUE(client_id,idempotency_key))'
 ].join(';')+';');
 db.prepare('INSERT INTO wallet_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('fixture',balance,'EGP',fee,0,0,0,'v27',0,'active','2026-10-13T00:00:00Z');
 db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?)').run('SUB-FIXTURE','fixture','active',0,'2099-12-31','2026-10-01','monthly','EGP','2026-10-01T00:00:00Z');
 db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?,?,?,?)').run('START','fixture','admin','subscription.billing.start','subscription','SUB-FIXTURE','{}','2026-10-01T00:00:00Z');
 class Statement{
   constructor(sql){this.sql=sql;this.args=[];}
   bind(...args){this.args=args;return this;}
   async first(){return db.prepare(this.sql).get(...this.args)||null;}
   async all(){return {results:db.prepare(this.sql).all(...this.args)};}
   async run(){const r=db.prepare(this.sql).run(...this.args);return {meta:{changes:r.changes}};}
 }
 const env={DB:{
   prepare:sql=>new Statement(sql),
   async batch(statements){
     db.exec('BEGIN IMMEDIATE');
     try{
       const out=[];
       for(const st of statements){const r=db.prepare(st.sql).run(...st.args);out.push({meta:{changes:r.changes}});}
       db.exec('COMMIT');return out;
     }catch(e){db.exec('ROLLBACK');throw e;}
   }
 }};
 const addOrder=(id,createdAt='2026-10-13T12:00:00Z')=>db.prepare('INSERT INTO orders VALUES (?,?,?,?,?)').run(id,'fixture','shop','2026-10-13',createdAt);
 const balanceNow=()=>({...db.prepare("SELECT balance,credit_limit FROM wallet_accounts WHERE client_id='fixture'").get()});
 const logs=()=>db.prepare("SELECT order_id,amount,balance_after,idempotency_key FROM wallet_log WHERE client_id='fixture' AND type='deduct' ORDER BY rowid").all().map(row=>({...row}));
 return {db,env,addOrder,balanceNow,logs};
}

const last=fixture(23,25);
last.addOrder('FINAL');
const charge=await billOrder(last.env,'FINAL');
assert.equal(charge.status,'charged');
assert.equal(charge.balance,-2);
assert.deepEqual(last.balanceNow(),{balance:-2,credit_limit:2});
assert.deepEqual(last.logs(),[{order_id:'FINAL',amount:25,balance_after:-2,idempotency_key:'order:FINAL'}]);
assert.equal((await subscriptionAccess(last.env,'fixture',{applyMonthly:false})).locked,true);
assert.equal((await subscriptionAccess(last.env,'fixture',{applyMonthly:false})).reason,'balance_empty');
assert.equal((await billOrder(last.env,'FINAL')).status,'charged');
assert.equal(last.logs().length,1,'same order cannot be charged twice');
last.addOrder('AFTER');
const stop=await billOrder(last.env,'AFTER');
assert.equal(stop.status,'pending_insufficient');
assert.equal(stop.code,'INSUFFICIENT_BALANCE');
assert.equal(last.balanceNow().balance,-2);
assert.equal(last.logs().length,1);
assert.equal((await reconcileUnbilledOrders(last.env,{clientId:'fixture'})).length,0);
last.db.prepare("UPDATE wallet_accounts SET balance=ROUND(balance+100,2) WHERE client_id='fixture'").run();
assert.equal(last.balanceNow().balance,98);
assert.equal((await subscriptionAccess(last.env,'fixture',{applyMonthly:false})).locked,false);
const legacyPending=await billOrder(last.env,'AFTER');
assert.equal(legacyPending.code,'BACKLOG_REQUIRES_REVIEW');
assert.equal(last.logs().length,1);
last.db.close();

const exact=fixture(25,25);exact.addOrder('ZERO');
assert.equal((await billOrder(exact.env,'ZERO')).balance,0);
assert.equal(exact.balanceNow().credit_limit,0);
assert.equal((await subscriptionAccess(exact.env,'fixture',{applyMonthly:false})).locked,true);
exact.db.close();

const race=fixture(5,8);race.addOrder('RACE-1');race.addOrder('RACE-2');
const results=await Promise.all([billOrder(race.env,'RACE-1'),billOrder(race.env,'RACE-2')]);
assert.equal(results.filter(x=>x.status==='charged').length,1);
assert.equal(results.filter(x=>x.status==='pending_insufficient').length,1);
assert.equal(race.balanceNow().balance,-3);
assert.equal(race.logs().length,1);
race.db.close();

const paused=fixture(20,30);
paused.db.prepare("UPDATE wallet_accounts SET status='paused' WHERE client_id='fixture'").run();
paused.addOrder('PAUSED');
assert.equal((await billOrder(paused.env,'PAUSED')).skipped,'billing_not_v27');
assert.equal(paused.balanceNow().balance,20);
assert.equal((await subscriptionAccess(paused.env,'fixture',{applyMonthly:false})).reason,'wallet_paused');
paused.db.close();
console.log('Last-order billing PASS: signed debt, lock, deduplication, zero, topup, race, admin pause.');
