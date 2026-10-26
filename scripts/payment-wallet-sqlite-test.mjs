// Real migration schema, synthetic in-memory balances only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {billOrder} from '../src/wallet-orders.js';
import {approveTopup,rejectTopup} from '../src/wallet-topup-admin.js';
import {subscriptionAccess,configureSubscription} from '../src/subscription-billing.js';
import {handleSubscriptionControl} from '../src/subscription-control.js';
import {requestTopup} from '../src/wallet-topup-request.js';
import {adminCreditWallet} from '../src/wallet-legacy.js';

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
 let beforeBatch=null,breakMirror=false;
 class Statement{
  constructor(sql){this.sql=sql;this.args=[];}
  bind(...args){assert.ok(args.every(v=>v!==undefined));this.args=args;return this;}
  async first(column){if(breakMirror&&this.sql.includes('SELECT json,updated_at FROM state WHERE id=1'))throw Object.assign(new Error('SIMULATED_LEGACY_MIRROR_FAILURE'),{code:'SIMULATED_MIRROR_OFFLINE'});const r=db.prepare(this.sql).get(...this.args)||null;return column&&r?r[column]:r;}
  async all(){return {results:db.prepare(this.sql).all(...this.args)};}
  async run(){const r=db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};}
 }
 const env={DB:{prepare:sql=>new Statement(sql)}};
 // D1 executes every statement in a batch as one serialized transaction.
 env.DB.batch=async statements=>{
  if(beforeBatch){const f=beforeBatch;beforeBatch=null;await f();}
  db.exec('BEGIN IMMEDIATE');try{const results=statements.map(st=>{const r=db.prepare(st.sql).run(...st.args);return {success:true,meta:{changes:Number(r.changes)}};});db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}
 };
 return {db,env,hook:f=>{beforeBatch=f;},setMirrorFailure:v=>{breakMirror=!!v;},balance:id=>db.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').get(id||'qa').balance,
  order:id=>db.prepare('INSERT INTO orders(id,client_id,store_id,date,created_at) VALUES(?,\'qa\',\'shop\',\'2090-01-01\',\'2090-01-01T00:00:00Z\')').run(id),
  topup:id=>db.prepare('INSERT INTO wallet_topup_requests(id,client_id,amount,sender_phone,requested_at) VALUES(?,\'qa\',100,\'01000000000\',?)').run(id,ts)};
}

const duplicate=fixture();duplicate.order('SAME');
const repeated=await Promise.all([billOrder(duplicate.env,'SAME'),billOrder(duplicate.env,'SAME')]);
assert.ok(repeated.every(r=>r.status==='charged'),'same concurrent order must return its committed charge');
assert.equal(duplicate.balance(),-2);
assert.equal(duplicate.db.prepare('SELECT status FROM order_billing').get().status,'charged');
assert.equal(duplicate.db.prepare('SELECT COUNT(*) n FROM wallet_log').get().n,1);
duplicate.db.close();

const rejected=fixture();rejected.topup('REJECT-RACE');
rejected.hook(()=>rejectTopup(rejected.env,'REJECT-RACE','admin'));
await assert.rejects(()=>approveTopup(rejected.env,'REJECT-RACE','admin'),e=>e.code==='TOPUP_NOT_PENDING');
assert.equal(rejected.balance(),23,'a concurrent rejection must prevent credit');
assert.equal(rejected.db.prepare('SELECT COUNT(*) n FROM wallet_log').get().n,0);
rejected.db.close();

const paid=fixture({balance:-2,minimum:10});paid.topup('PAY');
const approved=await Promise.all([approveTopup(paid.env,'PAY','admin'),approveTopup(paid.env,'PAY','admin')]);
assert.ok(approved.every(r=>r.ok));assert.equal(paid.balance(),88);
assert.equal(paid.balance('other'),-2,'other tenant balance stays unchanged');
assert.equal(paid.db.prepare('SELECT COUNT(*) n FROM wallet_log').get().n,2,'one credit and one monthly debit');
assert.equal((await approveTopup(paid.env,'PAY','admin')).balance,88);
await assert.rejects(()=>rejectTopup(paid.env,'PAY','admin'),e=>e.code==='TOPUP_NOT_PENDING');
await configureSubscription(paid.env,'qa',{status:'paused'},'admin');
await adminCreditWallet(paid.env,'qa',5,'admin','test',{requestId:'fixture-key-123'});
await adminCreditWallet(paid.env,'qa',5,'admin','test',{requestId:'fixture-key-123'});
assert.equal(paid.balance(),93);
await assert.rejects(()=>adminCreditWallet(paid.env,'qa',6,'admin','test',{requestId:'fixture-key-123'}),e=>e.code==='ADMIN_CREDIT_KEY_CONFLICT');
assert.equal((await subscriptionAccess(paid.env,'qa')).locked,true,'credit must preserve admin suspension');
await configureSubscription(paid.env,'qa',{baseOrderFee:7},'admin');
assert.equal((await subscriptionAccess(paid.env,'qa')).locked,true,'editing fees must preserve suspension');
await configureSubscription(paid.env,'qa',{status:'active'},'admin');
assert.equal((await subscriptionAccess(paid.env,'qa')).locked,false);
assert.equal(paid.balance(),93,'reactivation must not repeat the monthly fee');
for(const amount of [Infinity,-Infinity,NaN,1e308,-1,0]){
 await assert.rejects(()=>adminCreditWallet(paid.env,'qa',amount),e=>e.status===400);
 await assert.rejects(()=>requestTopup(paid.env,'qa',{amount},'qa'),e=>e.status===400);
}
for(const amount of [Infinity,1e308,-1,'bad'])await assert.rejects(()=>configureSubscription(paid.env,'qa',{monthlyMinimum:amount}),e=>e.code==='SUBSCRIPTION_AMOUNT_INVALID');
paid.topup('INVALID-CREDIT');
await assert.rejects(()=>approveTopup(paid.env,'INVALID-CREDIT','admin','',{creditAmount:1e308}),e=>e.code==='TOPUP_CREDIT_AMOUNT_INVALID');
assert.equal(paid.balance(),93,'invalid input must leave the balance intact');
paid.db.close();

// Once wallet_log and wallet_accounts are committed, a legacy state sync outage
// cannot report "topup rejected": retries must remain idempotent, with explicit
// mirror warning until recovery.
const mirrorTopup=fixture({balance:-2,minimum:0});mirrorTopup.topup('MIRROR-FAIL');
mirrorTopup.setMirrorFailure(true);
const creditedOnce=await approveTopup(mirrorTopup.env,'MIRROR-FAIL','admin');
assert.equal(creditedOnce.ok,true);
assert.equal(creditedOnce.legacyMirrorPending,true);
assert.equal(creditedOnce.balance,98);
assert.equal(mirrorTopup.db.prepare("SELECT COUNT(*) n FROM wallet_log WHERE client_id='qa'").get().n,1);
const creditedTwice=await approveTopup(mirrorTopup.env,'MIRROR-FAIL','admin');
assert.equal(creditedTwice.alreadyApproved,true);
assert.equal(creditedTwice.legacyMirrorPending,true);
assert.equal(mirrorTopup.balance(),98,'mirror outage must not double-charge or re-credit a topup');
mirrorTopup.setMirrorFailure(false);
const recoveredMirror=await approveTopup(mirrorTopup.env,'MIRROR-FAIL','admin');
assert.equal(recoveredMirror.alreadyApproved,true);
assert.equal(recoveredMirror.legacyMirrorPending,false);
assert.equal(mirrorTopup.balance(),98);
mirrorTopup.db.close();

const mirrorManual=fixture({balance:10,minimum:0});
mirrorManual.setMirrorFailure(true);
const manualOne=await adminCreditWallet(mirrorManual.env,'qa',7,'admin','synthetic',{requestId:'mirror-credit-77'});
assert.equal(manualOne.ok,true);
assert.equal(manualOne.legacyMirrorPending,true);
assert.equal(mirrorManual.balance(),17);
const manualRetry=await adminCreditWallet(mirrorManual.env,'qa',7,'admin','synthetic',{requestId:'mirror-credit-77'});
assert.equal(manualRetry.alreadyCredited,true);
assert.equal(manualRetry.legacyMirrorPending,true);
assert.equal(mirrorManual.balance(),17);
mirrorManual.setMirrorFailure(false);
const mirrorNowOk=await adminCreditWallet(mirrorManual.env,'qa',7,'admin','synthetic',{requestId:'mirror-credit-77'});
assert.equal(mirrorNowOk.legacyMirrorPending,false);
assert.equal(mirrorManual.balance(),17);
mirrorManual.db.close();

const mirrorOrder=fixture({balance:30,fee:8,minimum:0});
mirrorOrder.order('BILL-WHEN-MIRROR-FAILS');
mirrorOrder.setMirrorFailure(true);
const billedWithMirrorDown=await billOrder(mirrorOrder.env,'BILL-WHEN-MIRROR-FAILS');
assert.equal(billedWithMirrorDown.status,'charged');
assert.equal(billedWithMirrorDown.legacyMirrorPending,true);
assert.equal(mirrorOrder.balance(),22);
assert.equal(mirrorOrder.db.prepare("SELECT COUNT(*) n FROM wallet_log WHERE client_id='qa'").get().n,1);
const billedAgain=await billOrder(mirrorOrder.env,'BILL-WHEN-MIRROR-FAILS');
assert.equal(billedAgain.status,'charged');
assert.equal(mirrorOrder.balance(),22,'mirror outage must not trigger another order fee');
mirrorOrder.db.close();

const mirrorMonthly=fixture({balance:30,fee:5,minimum:10});
mirrorMonthly.setMirrorFailure(true);
const monthlyWithMirrorDown=await subscriptionAccess(mirrorMonthly.env,'qa',{applyMonthly:true});
assert.equal(monthlyWithMirrorDown.monthlyCharged,true);
assert.equal(monthlyWithMirrorDown.legacyMirrorPending,true);
assert.equal(monthlyWithMirrorDown.balance,20);
mirrorMonthly.setMirrorFailure(false);
const monthlyOnce=await subscriptionAccess(mirrorMonthly.env,'qa',{applyMonthly:true});
assert.equal(monthlyOnce.balance,20,'retry must not deduct monthly fee twice');
assert.equal(mirrorMonthly.db.prepare("SELECT COUNT(*) n FROM wallet_log WHERE client_id='qa'").get().n,1);
mirrorMonthly.db.close();

// A stale monthly balance snapshot must not shrink credit below concurrent debt.
const monthly=fixture({balance:5,fee:8,minimum:10});monthly.order('FINAL');
monthly.hook(()=>billOrder(monthly.env,'FINAL'));
await subscriptionAccess(monthly.env,'qa',{applyMonthly:true});
assert.equal(monthly.balance(),-13);
assert.equal(monthly.db.prepare('SELECT credit_limit FROM wallet_accounts WHERE client_id=\'qa\'').get().credit_limit,13);
monthly.db.close();

const legacy=fixture({balance:50});
legacy.db.prepare("UPDATE wallet_accounts SET billing_version='legacy',status='paused' WHERE client_id='qa'").run();
await configureSubscription(legacy.env,'qa',{baseOrderFee:4},'admin');
assert.equal((await subscriptionAccess(legacy.env,'qa')).reason,'wallet_paused','legacy migration must preserve a manual pause during fee edits');
assert.equal(legacy.balance(),50);
legacy.db.close();

for(const role of ['client','employee']){
 for(const [path,method] of [['/api/admin/subscriptions/other','PATCH'],['/api/admin/subscriptions/other/credit','POST'],['/api/admin/subscriptions/other/start-trial','POST'],['/api/admin/wallet/topups/PAY/approve','POST'],['/api/admin/wallet/topups/PAY/proof','GET']]){
  const delegate={fetch:async()=>Response.json({role,clientId:'qa'})};
  const env={DB:{prepare(){throw Error('Unauthorized route touched database');}}};
  const request=new Request('https://fixture.example'+path,{method,...(method==='GET'?{}:{body:'{}'})});
  const response=await handleSubscriptionControl({request,env,ctx:{},delegate});
  assert.equal(response.status,403);assert.equal((await response.json()).code,'ADMIN_ONLY');
 }
}
console.log('SQLite payment safety PASS: concurrent debit/credit/rejection, monthly debt, tenant isolation, admin pause/reactivation and permissions.');
