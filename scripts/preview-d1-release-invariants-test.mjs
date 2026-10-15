import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
  INVARIANT_CHECKS,INVARIANT_SQL,EXISTING_TABLES_SQL,verifySqlIsReadonly,
  evaluateInvariants,verifyLiveInvariants
} from './preview-d1-release-invariants.mjs';

assert.equal(verifySqlIsReadonly(),true);
assert.ok(EXISTING_TABLES_SQL.startsWith('SELECT name FROM sqlite_master'));
const liveTables=[...new Set(INVARIANT_CHECKS.map(x=>x.table))];
const allOk=Object.fromEntries(INVARIANT_CHECKS.map(x=>[x.id,0]));
assert.equal(evaluateInvariants(liveTables,allOk).ok,true);
const clash={...allOk,unit_code_collision:1};
assert.deepEqual(evaluateInvariants(liveTables,clash).conflicts,['unit_code_collision']);
assert.throws(()=>evaluateInvariants(liveTables,{...allOk,shipment_awb_collision:undefined}),/Invalid live invariant/);
assert.throws(()=>evaluateInvariants(liveTables,{...allOk,shipment_awb_collision:null}),/Invalid live invariant/);
assert.throws(()=>evaluateInvariants(liveTables,{...allOk,shipment_awb_collision:2}),/Invalid live invariant/);
assert.throws(()=>evaluateInvariants(liveTables,{}),/not verified/);

const called=[];
const good=await verifyLiveInvariants(async sql=>{
  called.push(sql);
  if(sql===EXISTING_TABLES_SQL)return [{results:liveTables.map(name=>({name}))}];
  return [{results:[{conflict:0}]}];
});
assert.equal(good.checked,INVARIANT_CHECKS.length);
assert.equal(called.length,INVARIANT_CHECKS.length+1);
for(const sql of called){
  assert.ok(sql.startsWith('SELECT '));
  assert.ok(!/\bclient_id\s*=/.test(sql),'Never select one merchant');
  assert.ok(!/SELECT\s+\*/i.test(sql));
}
await assert.rejects(verifyLiveInvariants(async sql=>{
  if(sql===EXISTING_TABLES_SQL)return [{results:liveTables.map(name=>({name}))}];
  return [{results:[{conflict:sql.includes('FROM inventory_units')?1:0}]}];
}),/unit_code_collision/);
await assert.rejects(verifyLiveInvariants(async sql=>{
  if(sql===EXISTING_TABLES_SQL)return [{results:liveTables.map(name=>({name}))}];
  return [{results:[]}];
}),/no verifiable result/);
const onlyOneTable=await verifyLiveInvariants(async sql=>{
  if(sql===EXISTING_TABLES_SQL)return [{results:[{name:'inventory_units'}]}];
  assert.ok(sql.includes('FROM inventory_units'));
  return [{results:[{conflict:0}]}];
});
assert.equal(onlyOneTable.checked,1,'Absent tables should not be read before migrations create them');
// Execute the exact readonly SQL against real SQLite semantics, not just mocks.
const fixture=new DatabaseSync(':memory:');
fixture.exec(`
CREATE TABLE inventory_units(client_id TEXT,unit_code TEXT);
CREATE TABLE order_unit_allocations(client_id TEXT,unit_id TEXT,order_id TEXT,status TEXT);
CREATE TABLE inventory_scan_events(session_id TEXT,unit_id TEXT,scan_kind TEXT,result TEXT);
CREATE TABLE inventory_shipments(client_id TEXT,order_id TEXT,idempotency_key TEXT,awb TEXT,txlogistic_id TEXT);
`);
const conflict=id=>fixture.prepare(INVARIANT_SQL[id]).get().conflict;
fixture.exec("INSERT INTO inventory_units VALUES ('A','QR1'),('B','QR1');");
assert.equal(conflict('unit_code_collision'),0,'Matching QR in different tenants is allowed');
fixture.exec("INSERT INTO inventory_units VALUES ('A','QR1');");
assert.equal(conflict('unit_code_collision'),1,'Duplicated QR within tenant is rejected');
fixture.exec("INSERT INTO order_unit_allocations VALUES ('A','UNIT1','ORDER1','reserved'),('A','UNIT1','ORDER2','released');");
assert.equal(conflict('active_unit_double_allocation'),0,'Released allocation must not count as active');
fixture.exec("UPDATE order_unit_allocations SET status='reserved' WHERE order_id='ORDER2';");
assert.equal(conflict('active_unit_double_allocation'),1,'Same physical unit allocated to two live orders is rejected');
assert.equal(conflict('order_unit_collision'),0,'Different orders are not duplicate allocation rows');
fixture.exec("INSERT INTO order_unit_allocations VALUES ('A','UNIT1','ORDER1','released');");
assert.equal(conflict('order_unit_collision'),1,'Same order and unit repeated is rejected');
fixture.exec("INSERT INTO inventory_scan_events VALUES ('S','UNIT1','unit','accepted'),('S','UNIT1','unit','rejected');");
assert.equal(conflict('scan_acceptance_collision'),0,'Rejected scan is not an accepted duplicate');
fixture.exec("INSERT INTO inventory_scan_events VALUES ('S','UNIT1','unit','accepted');");
assert.equal(conflict('scan_acceptance_collision'),1,'Repeated accepted unit scan must fail release');
fixture.exec("INSERT INTO inventory_shipments VALUES ('A','O1','K1','AWB1','R1'),('B','O2','K2','AWB1','R2');");
assert.equal(conflict('shipment_awb_collision'),0,'AWB uniqueness is tenant-scoped');
fixture.exec("INSERT INTO inventory_shipments VALUES ('A','O3','K3','AWB1','R3');");
assert.equal(conflict('shipment_awb_collision'),1,'Duplicate AWB within tenant is rejected');
fixture.close();

const workflow=readFileSync('.github/workflows/preview.yml','utf8');
const mutation=workflow.indexOf('run: npm run db:migrate:preview');
const invariant=workflow.indexOf('node scripts/preview-d1-release-invariants.mjs');
assert.ok(invariant>0 && invariant<mutation,'Read-only invariant preflight must happen before DB mutation');
console.log('Read-only D1 live inventory data invariants PASS: no PII, duplicate guards, safe missing tables, fail closed.');
