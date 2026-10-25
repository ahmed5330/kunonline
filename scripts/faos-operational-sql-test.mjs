import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {operationalQuality} from '../src/accounting-faos-api.js';

// Fake Easy Order imports, J&T deliveries, duplicate orders, returns and manual costs.
// Executed against in-memory SQLite; never touches Cloudflare production/preview D1.
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE orders(id TEXT PRIMARY KEY, client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,product_cost REAL,collected_amount REAL);
CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT);
CREATE TABLE transactions(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,type TEXT,category TEXT,amount REAL,date TEXT,created_at TEXT);
CREATE TABLE order_management_fees(order_id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,status TEXT);
`);
const order=db.prepare("INSERT INTO orders(id,client_id,store_id,date,created_at,state,total,product_cost,collected_amount) VALUES(?,?,?,?,?,?,?,?,?)");
function add(id,tenant,store,state,total,cost,collected,date='2026-10-10'){
  order.run(id,tenant,store,date,date+'T00:00:00Z',state,total,cost,collected);
}
add('A1','C1','S1','confirmed',100,null,null);
add('A2','C1','S1','shipped',200,50,null);
add('A3','C1','S1','signed',300,null,null);
add('A4','C1','S1','collected',400,null,null);
add('A5','C1','S1','returned',250,90,null);
add('A6','C1','S1','signed',300,null,null);
add('B1','C1','S2','confirmed',900,null,null);
add('C1','OTHER_CLIENT','S1','signed',900,null,null);
db.prepare("INSERT INTO order_duplicate_links VALUES('A6','A3')").run();
db.prepare("INSERT INTO order_management_fees VALUES('A5','C1','S1','active')").run();
db.prepare("INSERT INTO order_management_fees VALUES('A3','C1','S1','active')").run();
const tx=db.prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?)");
tx.run('E1','C1','S1','expense','مشتريات',250,'2026-10-10','2026-10-10T00:00:00Z');
tx.run('E2','C1','S1','expense','إعلانات Meta',120,'2026-10-10','2026-10-10T00:00:00Z');
tx.run('E3','C1','S1','expense','رواتب',80,'2026-10-10','2026-10-10T00:00:00Z');
tx.run('E4','C1','S2','expense','مشتريات',999,'2026-10-10','2026-10-10T00:00:00Z');
const env={DB:{prepare(sql){const stmt=db.prepare(sql);return {bind(...args){return {first:async()=>stmt.get(...args)||null}}}}}};
const audit=await operationalQuality(env,{clientId:'C1',storeId:'S1',from:'2026-10-01',to:'2026-10-31'});
assert.equal(audit.orders,5,'linked duplicate and other-store orders excluded');
assert.equal(audit.unrecognizedPipelineValue,300,'only confirmed and shipped, not signed');
assert.equal(audit.unverifiedCollectedOrdersByOrderDate,1);
assert.equal(audit.missingSaleCostSnapshots,2);
assert.equal(audit.inventoryPurchasesExpensed,250);
assert.equal(audit.manualAdExpense,120);
assert.equal(audit.unreversedManagementFees,1);
const auditB=await operationalQuality(env,{clientId:'C1',storeId:'S2',from:'2026-10-01',to:'2026-10-31'});
assert.equal(auditB.orders,1,'store isolation');
assert.equal(auditB.unrecognizedPipelineValue,900);
assert.equal(auditB.inventoryPurchasesExpensed,999);
const auditSep=await operationalQuality(env,{clientId:'C1',storeId:'S1',from:'2026-09-01',to:'2026-09-30'});
assert.equal(auditSep.orders,0,'month boundary correctly applied');
assert.equal(auditSep.unreversedManagementFees,0);
console.log('PASS FAOS operational SQL audit: 8 synthetic imported/delivered/returned orders; tenant and store scoped risk flags; duplicate suppression.');
