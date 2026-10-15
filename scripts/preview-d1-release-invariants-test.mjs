import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  INVARIANT_CHECKS,EXISTING_TABLES_SQL,verifySqlIsReadonly,
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
const workflow=readFileSync('.github/workflows/preview.yml','utf8');
const mutation=workflow.indexOf('run: npm run db:migrate:preview');
const invariant=workflow.indexOf('node scripts/preview-d1-release-invariants.mjs');
assert.ok(invariant>0 && invariant<mutation,'Read-only invariant preflight must happen before DB mutation');
console.log('Read-only D1 live inventory data invariants PASS: no PII, duplicate guards, safe missing tables, fail closed.');
