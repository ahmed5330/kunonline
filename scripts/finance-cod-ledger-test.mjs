import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {orderEconomics,codCandidates,codPendingSummary,createReconciliation,listReconciliations} from '../src/index-commerce-v3.js';

const db=new DatabaseSync(':memory:');
db.exec(`
 CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,name TEXT,awb TEXT,total REAL,discount_amount REAL,refund_amount REAL,state TEXT,checkpoint TEXT,history TEXT,collected_at TEXT,collected_amount REAL,product_cost REAL,qty REAL);
 CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT);
 CREATE TABLE cod_reconciliation_items(id TEXT PRIMARY KEY,reconciliation_id TEXT,client_id TEXT,store_id TEXT,order_id TEXT,awb TEXT,expected_amount REAL,actual_amount REAL,difference REAL,status TEXT,created_at TEXT);
 CREATE TABLE cod_reconciliations(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,provider TEXT,reference TEXT,status TEXT,expected_amount REAL,actual_amount REAL,difference REAL,currency TEXT,reconciled_at TEXT,note TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
`);
function add(id,client,store,date,amount,discount=0,refund=0,quantity=1,cost=0){
 db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,client,store,date,date+'T09:00:00Z','اختبار',id,amount,discount,refund,'signed',null,'[]',null,null,cost,quantity);
}
add('S1','tenant-1','store-A','2026-10-11',1000,100,20,3,300);
add('DUP-S1','tenant-1','store-A','2026-10-11',1000,100,20,3,300);
add('S2','tenant-1','store-A','2026-10-11',500,0,0,1,100);
add('OLD','tenant-1','store-A','2026-09-11',100,0,0,1,20);
add('OTHER-STORE','tenant-1','store-B','2026-10-11',700,0,0,1,80);
add('OTHER-TENANT','tenant-2','store-A','2026-10-11',900,0,0,1,50);
db.prepare('INSERT INTO order_duplicate_links VALUES(?,?)').run('DUP-S1','S1');
class Prepared{
 constructor(sql){this.sql=sql;this.args=[];}
 bind(...args){this.args=args;return this;}
 first(){return Promise.resolve(db.prepare(this.sql).get(...this.args)||null);}
 all(){return Promise.resolve({results:db.prepare(this.sql).all(...this.args)});}
 run(){const result=db.prepare(this.sql).run(...this.args);return Promise.resolve(result);}
}
const env={DB:{
 prepare:sql=>new Prepared(sql),
 batch:async(statements)=>{const results=[];for(const stmt of statements)results.push(await stmt.run());return results;}
}};
assert.equal(orderEconomics({total:1000,discount_amount:100,refund_amount:20,product_cost:300,qty:3}).cogs,300,'order-level product cost must not be multiplied by item quantity');
let candidates=await codCandidates(env,'tenant-1','store-A');
assert.deepEqual(candidates.map(x=>x.id).sort(),['OLD','S1','S2'],'duplicate order should never be eligible for COD reconciliation');
assert.equal(candidates.find(x=>x.id==='S1')?.expectedAmount,880);
candidates=await codCandidates(env,'tenant-1','store-A',{from:'2026-10-01',to:'2026-10-31'});
assert.deepEqual(candidates.map(x=>x.id).sort(),['S1','S2'],'the detail list and summary must share the same date window');
let summary=await codPendingSummary(env,'tenant-1','store-A',{from:'2026-10-01',to:'2026-10-31'});
assert.equal(summary.totalOrders,2,'unbounded financial summary respects date and branch and removes linked duplicate');
assert.equal(summary.totalExpected,1380);
assert.equal((await codPendingSummary(env,'tenant-2','store-A',{from:'2026-10-01',to:'2026-10-31'})).totalExpected,900,'a different tenant is isolated');
assert.equal((await codPendingSummary(env,'tenant-1','store-B',{from:'2026-10-01',to:'2026-10-31'})).totalExpected,700,'a different store is isolated');

const me={role:'client',clientId:'tenant-1',email:'qa@example.com',uid:'mock'};
const post=(orderIds,actualAmount)=>new Request('https://test/api/cod-reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderIds,actualAmount,provider:'J&T',reference:'TEST'})});
let attempt=await createReconciliation(post(['S1','DUP-S1'],1760),env,me,'tenant-1','store-A');
assert.equal(attempt.status,400,'duplicate order cannot enter a COD payment batch');
assert.equal(db.prepare('SELECT COUNT(*) n FROM cod_reconciliations').get().n,0,'invalid mixed COD batch must not write financial records');
for(const invalid of ['garbage',-3,Infinity,{},true]){
 const bad=await createReconciliation(post(['S1'],invalid),env,me,'tenant-1','store-A');
 assert.equal(bad.status,400,'malformed or negative amount must never create a COD dispute / monetary posting');
 assert.equal((await bad.json()).code,'COD_AMOUNT_INVALID');
}
assert.equal((await createReconciliation(post(['S1','OTHER-STORE'],1580),env,me,'tenant-1',null)).status,400,'never mix multiple warehouses in one cash batch');
assert.equal((await createReconciliation(post(Array.from({length:201},(_,i)=>'ORD-'+i),0),env,me,'tenant-1','store-A')).status,400,'prevent oversized SQL parameters and partial settlement');
assert.equal(db.prepare('SELECT COUNT(*) n FROM cod_reconciliations').get().n,0,'invalid COD requests must be fully read-only');

const response=await createReconciliation(post(['S1'],880),env,me,'tenant-1','store-A');
assert.equal(response.status,201);
const payload=await response.json();
assert.equal(payload.status,'reconciled');
const row=db.prepare("SELECT state,collected_amount,collected_at FROM orders WHERE id='S1'").get();
assert.equal(row.state,'collected');
assert.equal(row.collected_amount,880,'settlement must persist actual allocated COD rather than fallback to original 1000 order total');
assert.ok(row.collected_at,'settlement date must be recorded');
assert.equal(db.prepare("SELECT state FROM orders WHERE id='DUP-S1'").get().state,'signed','duplicate is never mutated by reconciling canonical order');
summary=await codPendingSummary(env,'tenant-1','store-A',{from:'2026-10-01',to:'2026-10-31'});
assert.equal(summary.totalOrders,1);
assert.equal(summary.totalExpected,500);
const history=await listReconciliations(env,'tenant-1','store-A',{from:'2026-10-01',to:'2026-12-31'});
assert.equal(history.length,1);
assert.equal(history[0].actual_amount,880);
assert.equal((await listReconciliations(env,'tenant-1','store-A',{from:'2026-01-01',to:'2026-09-30'})).length,0);
const repeat=await createReconciliation(post(['S1'],880),env,me,'tenant-1','store-A');
assert.equal(repeat.status,400,'repeated COD reconciliation cannot charge twice');
assert.equal(db.prepare('SELECT COUNT(*) n FROM cod_reconciliations').get().n,1);
const opened=await createReconciliation(post(['S2'],null),env,me,'tenant-1','store-A');
assert.equal((await opened.json()).status,'open');
const outstanding=await codPendingSummary(env,'tenant-1','store-A',{from:'2026-10-01',to:'2026-10-31'});
assert.equal(outstanding.totalExpected,500,'open batch without actual funds must still appear in uncollected COD');
assert.equal(outstanding.inExistingReconciliation,1,'open COD batch must have an explicit review signal');
assert.equal((await codCandidates(env,'tenant-1','store-A',{from:'2026-10-01',to:'2026-10-31'})).length,0,'open batch already owns its linked order; candidate list should not offer double selection');
console.log('COD reconciliation real SQL PASS: canonical settlement, actual amount, multi-tenant, store, dates, idempotency');
db.close();
