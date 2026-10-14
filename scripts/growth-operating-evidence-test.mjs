import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {growthOperatingEvidence} from '../src/growth-operating-evidence.js';
import {readFile} from 'node:fs/promises';

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,
  collected_at TEXT,collected_amount REAL,total REAL,state TEXT);
CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT);
`);
const insert=(id,client,store,date,state,total,collection=null,collectedAt=null)=>
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,client,store,date,date+'T09:00:00Z',collectedAt,collection,total,state);
insert('A','C','S','2026-10-01','pending',250);
insert('B','C','S','2026-10-01','preparing',450);
insert('C','C','S','2026-10-02','shipped',100);
insert('D','C','S','2026-10-03','signed',400);
insert('E','C','S','2026-10-03','collected',500,460,'2026-10-08T10:00:00Z');
insert('MISSING-AMOUNT','C','S','2026-10-03','collected',300,null,'2026-10-08T10:00:00Z');
insert('E-DUP','C','S','2026-10-03','collected',500,460,'2026-10-08T10:00:00Z');
insert('RETURN','C','S','2026-10-04','returned',250);
insert('OUTSIDE','OTHER','S','2026-10-03','collected',9999,9999,'2026-10-08T10:00:00Z');
insert('STORE','C','OTHER-STORE','2026-10-03','collected',8888,8888,'2026-10-08T10:00:00Z');
db.prepare('INSERT INTO order_duplicate_links VALUES(?,?)').run('E-DUP','E');
class Statement {constructor(sql){this.sql=sql;this.args=[];}bind(...v){this.args=v;return this;}
  async first(){return db.prepare(this.sql).get(...this.args)||null;}}
const env={DB:{prepare:sql=>new Statement(sql)}};
const result=await growthOperatingEvidence(env,{clientId:'C',storeId:'S',from:'2026-10-01',to:'2026-10-12'});
assert.equal(result.orderCohort.entered,7);
assert.equal(result.orderCohort.collected,2);
assert.equal(result.currentBacklog.active,4);
assert.equal(result.currentBacklog.pendingConfirmation,1);
assert.equal(result.currentBacklog.awaitingPacking,1);
assert.equal(result.currentBacklog.awaitingDelivery,1);
assert.equal(result.currentBacklog.deliveredNotMarkedCollected,1);
assert.equal(result.codRecorded.count,2);
assert.equal(result.codRecorded.grossRecorded,460);
assert.equal(result.codRecorded.missingAmountCount,1,'missing COD cannot be inferred from order sale price');
assert.equal(result.codRecorded.meanDaysFromOrderToRecordedCollection,5);
assert.equal(result.verifiedStaffCapacity,false);
assert.equal(result.verifiedCarrierPayoutSchedule,false);
assert.equal(result.merchantBankBalanceKnown,false);
const narrower=await growthOperatingEvidence(env,{clientId:'C',storeId:'S',from:'2026-10-09',to:'2026-10-11'});
assert.equal(narrower.orderCohort.entered,0);
assert.equal(narrower.currentBacklog.active,4,'live backlog is not filtered by the order date selected');
assert.equal(narrower.codRecorded.count,0);
await assert.rejects(()=>growthOperatingEvidence(env,{clientId:'C',storeId:'',from:'2026-10-01',to:'2026-10-11'}),/اختار المتجر/);
const route=await readFile(new URL('../src/index-commerce-v27.js',import.meta.url),'utf8');
assert.match(route,/path==='\/api\/growth\/operating-evidence'/);
assert.match(route,/requirePermission\(me,'orders','read'\);requirePermission\(me,'finance','read'\)/);
assert.doesNotMatch(route,/\/api\/growth\/operating-evidence'&&method==='POST'/);
db.close();
console.log('Growth tenant-scoped order backlog and COD evidence tests PASS');
