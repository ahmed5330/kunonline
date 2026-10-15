import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {codPeriod,orderEconomics} from '../src/index-commerce-v3.js';
import {resolveStoreScope} from '../src/store-scope.js';
import {can} from '../src/access-control.js';
import fs from 'node:fs';

for(const dates of [
 ['2026-02-30','2026-03-01'],
 ['2026-10-12','2026-10-01'],
 ['2026-10-0x','2026-10-12']
]){
 const u=new URL('https://test.local/api/cod-reconciliation/summary');
 u.searchParams.set('from',dates[0]);u.searchParams.set('to',dates[1]);
 assert.throws(()=>codPeriod(u),/تاريخ/,'invalid COD period must be rejected');
}
const u=new URL('https://test.local/api/cod-reconciliation/summary?from=2026-10-01&to=2026-10-12');
assert.deepEqual(codPeriod(u),{from:'2026-10-01',to:'2026-10-12'});
assert.equal(can({role:'client'},'cod','write'),true,'tenant owners can reconcile own COD');
assert.equal(can({role:'viewer'},'cod','write'),false,'read-only users must not settle money');
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT,name TEXT,status TEXT,is_default INTEGER);
CREATE TABLE user_store_access(id TEXT PRIMARY KEY,user_id TEXT,client_id TEXT,store_id TEXT,role TEXT);
`);
for(const [id,client] of [['A','client'],['B','client'],['C','other']])db.prepare('INSERT INTO stores VALUES(?,?,?,?,?)').run(id,client,'Store '+id,'active',id==='A'?1:0);
db.prepare('INSERT INTO user_store_access VALUES(?,?,?,?,?)').run('grantA','accountant-id','client','A','viewer');
db.prepare('INSERT INTO user_store_access VALUES(?,?,?,?,?)').run('grantB','accountant-id','client','B','member');
class Stmt {constructor(sql){this.sql=sql;this.args=[];}bind(...args){this.args=args;return this;}first(){return Promise.resolve(db.prepare(this.sql).get(...this.args)||null);}all(){return Promise.resolve({results:db.prepare(this.sql).all(...this.args)})}}
const env={DB:{prepare:sql=>new Stmt(sql)}};
const accountant={role:'accountant',clientId:'client',uid:'accountant-id'};
assert.equal((await resolveStoreScope(env,accountant,'client','A',{write:false})).storeId,'A');
await assert.rejects(resolveStoreScope(env,accountant,'client','A',{write:true}),e=>e.status===403&&e.code==='STORE_READ_ONLY');
assert.equal((await resolveStoreScope(env,accountant,'client','B',{write:true})).storeId,'B');
await assert.rejects(resolveStoreScope(env,accountant,'client','C',{write:false}),e=>e.status===403);
await assert.rejects(resolveStoreScope(env,accountant,'client',null,{write:false}),e=>e.status===400&&e.code==='STORE_SELECTION_REQUIRED');
assert.equal((await resolveStoreScope(env,{role:'client',clientId:'client'},'client','A',{write:true})).storeId,'A');
await assert.rejects(resolveStoreScope(env,{role:'client',clientId:'client'},'other','C',{write:true}),e=>e.status===403);
const worker=fs.readFileSync('src/index-commerce-v3.js','utf8');
assert.ok((worker.match(/resolveStoreScope\(env,me,clientId/g)||[]).length>=5,'all COD and profit routes must enforce tenant-store isolation');
assert.ok(worker.includes("requirePermission(me,'cod','write')"),'COD posting requires explicit financial write permission');
const returned=orderEconomics({state:'returned',total:600,product_cost:250,shipping_cost:40,other_cost:5});
assert.equal(returned.netRevenue,0);
assert.equal(returned.cogs,0);
assert.equal(returned.contribution,-45,'returned shipment still incurs real courier and handling costs');
console.log('Finance COD scope/date permission QA PASS: owner, accountant branch viewer, tenant isolation, reversals');
db.close();
