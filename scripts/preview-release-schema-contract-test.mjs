import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  REQUIRED_RELEASE_SCHEMA,READONLY_SCHEMA_SQL,READONLY_SCHEMA_BATCHES,verifyReleaseSchemaReadonly,validateReleaseSchema,checkReleaseSchema
} from './preview-release-schema-contract.mjs';

const workflow=readFileSync('.github/workflows/preview.yml','utf8');
const step=workflow.indexOf('node scripts/preview-release-schema-contract.mjs');
const deploy=workflow.indexOf('name: Create fresh verified rollback baseline from stable Git source');
assert(step>0 && deploy>step,'Live schema check must run before any Worker deployment');
assert(READONLY_SCHEMA_SQL.includes("pragma_table_info('inventory_units')"));
assert(!/\b(UPDATE|INSERT|DELETE|DROP|ALTER)\b/i.test(READONLY_SCHEMA_SQL),'Schema check must remain read-only');
const rows=Object.entries(REQUIRED_RELEASE_SCHEMA).flatMap(([table,columns])=>
  columns.map(column=>({table_name:table,column_name:column})));
assert.equal(checkReleaseSchema([{success:true,results:rows}]).ok,true);
assert.equal(validateReleaseSchema([{results:rows}]).missing.length,0);
assert.equal(checkReleaseSchema({result:{results:rows}}).ok,true);
const missing=rows.filter(x=>!(x.table_name==='wallet_accounts'&&x.column_name==='credit_limit'));
assert.deepEqual(validateReleaseSchema([{results:missing}]).missing,['wallet_accounts.credit_limit']);
assert.throws(()=>checkReleaseSchema([{results:missing}]),/deployment blocked/);
assert.throws(()=>checkReleaseSchema([{results:[]}]),/deployment blocked/);
assert.throws(()=>checkReleaseSchema('Invalid response'),/unrecognized/);
const allButOne=rows.filter(x=>x.table_name!=='inventory_shipments');
assert.ok(validateReleaseSchema([{results:allButOne}]).missing.includes('inventory_shipments.id'));
console.log('Preview D1 release schema gate PASS: required columns, read-only SQL, missing-schema fail-closed.');

assert.equal(READONLY_SCHEMA_BATCHES.length,4,'fifteen required tables stay in batches of at most four');
for(const [table,column] of [['audit_log','before_json'],['transactions','amount'],['stores','management_fee_pct']]){
  assert.ok(REQUIRED_RELEASE_SCHEMA[table].includes(column));
  const incomplete=rows.filter(row=>row.table_name!==table||row.column_name!==column);
  assert.throws(()=>checkReleaseSchema([{success:true,results:incomplete}]),/deployment blocked/,'audited writes require the existing accounting schema');
}
let batches=0;
assert.equal((await verifyReleaseSchemaReadonly(async sql=>{
  batches++;assert.ok(sql.split(' UNION ALL ').length<=4,'D1 compound SELECT bound');
  const names=[...sql.matchAll(/pragma_table_info\('([a-z_]+)'\)/g)].map(x=>x[1]);
  return [{success:true,results:rows.filter(row=>names.includes(row.table_name))}];
})).verifiedTables,Object.keys(REQUIRED_RELEASE_SCHEMA).length);
assert.equal(batches,4,'All bounded metadata batches must be checked');
await assert.rejects(()=>verifyReleaseSchemaReadonly(async()=>[{success:true,results:rows.filter(row=>row.table_name!=='wallet_log')}]),/deployment blocked/);
