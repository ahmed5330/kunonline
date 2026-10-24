/* No network, secrets or live D1. Prove the manual inventory is read-only
 * and cannot return session token fingerprints. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectRevocationDatabases,configuredDatabases,assessReadOnlyInventory} from './session-revocation-live-schema-inventory.mjs';

const configs={
  production:await readFile(new URL('../wrangler.production.toml',import.meta.url),'utf8'),
  preview:await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8')
};
const targets=configuredDatabases(configs.production,configs.preview);
assert.equal(targets.length,2);assert.notEqual(targets[0].id,targets[1].id);
let count=0;const all=[];
const fake=async(url,options)=>{
  assert.equal(options.method,'POST','D1 read-only metadata endpoint is a POST request');
  assert.equal(options.redirect,'error');
  assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'));
  assert.ok(url.includes('/d1/database/'));
  const id=url.split('/d1/database/')[1].split('/')[0];
  const env=targets.find(x=>x.id===id)?.environment;assert.ok(env);
  const sql=JSON.parse(options.body).sql;
  assert.match(sql,/^SELECT\s/i);
  assert.doesNotMatch(sql,/\b(?:INSERT|DELETE|UPDATE|DROP|ALTER|CREATE|REPLACE|ATTACH)\b|;/i);
  assert.doesNotMatch(sql,/token_hash\s*(?:FROM|=)|SELECT\s+token_hash\b|SELECT\s+\*/i,
    'No individual hashes, credentials, or customer rows may be selected');
  assert.equal(JSON.parse(options.body).params.length,0);
  all.push({env,sql});count++;
  let rows=[];
  if(sql.includes('FROM sqlite_master')){
    rows=env==='production_db'?[{name:'revoked_sessions'},{name:'d1_migrations'}]:
      [{name:'revoked_sessions'},{name:'revoked_session_tokens'},{name:'d1_migrations'}];
  }else if(sql.includes('pragma_table_info')){
    rows=sql.includes('AS required')?[
      {name:'token_hash',type:'TEXT',required:0,pk:1},
      {name:'expires_at',type:'INTEGER',required:1,pk:0},
      ...(sql.includes("'revoked_session_tokens'")?[{name:'revoked_at',type:'TEXT',required:1,pk:0}]:[])
    ]:[{name:'id'},{name:'name'},{name:'applied_at'}];
  }else if(sql.includes('COUNT(*)')){
    rows=[{total:env==='production_db'?4:9,unexpired:env==='production_db'?1:3}];
  }else if(sql.includes('AS migration_name')){
    rows=[{migration_name:'0099_revoked_sessions.sql'}];
  }else throw Error('Unexpected synthetic SQL shape: '+sql);
  return {ok:true,status:200,json:async()=>({success:true,result:[{success:true,results:rows}]})};
};
const secret='SYNTHETIC_DO_NOT_LEAK_API_KEY';
const output=await inspectRevocationDatabases({
  accountId:'0123456789abcdef0123456789abcdef',apiToken:secret,configs,fetchImpl:fake
});
assert.equal(output.auditType,'SCHEMA_ONLY_NO_WRITES');
assert.equal(output.reports.length,2);
assert.equal(output.reports[0].tables.revoked_sessions.counts.unexpired,1);
assert.equal(output.reports[0].tables.revoked_session_tokens.exists,false);
assert.equal(output.assessment.production,'LEGACY_SCHEMA_ONLY_VALIDATE_ACTUAL_WORKER');
assert.equal(output.assessment.preview,'DUAL_TABLES_REQUIRE_MANUAL_LEDGER_AND_RECORD_RECONCILIATION');
assert.equal(output.assessment.releaseAuthorized,false);
assert.equal(output.assessment.remoteWorkerBindingsVerified,false);
assert.ok(count>6);
assert.doesNotMatch(JSON.stringify(output),/SYNTHETIC_DO_NOT_LEAK|0123456789abcdef|sha256-user-cookie/);
assert.ok(output.reports[0].ledgers.d1_migrations.matchingRevocationMigrationNames.includes('0099_revoked_sessions.sql'));
const one=(x,y)=>[{
  environment:'production_db',tables:{revoked_sessions:{exists:x,columnsCompatible:x},revoked_session_tokens:{exists:y,columnsCompatible:y}}
},{
  environment:'preview_db',tables:{revoked_sessions:{exists:x,columnsCompatible:x},revoked_session_tokens:{exists:y,columnsCompatible:y}}
}];
assert.equal(assessReadOnlyInventory(one(false,false)).production,'NO_REVOCATION_SCHEMA_PRESENT_STOP_RELEASE');
assert.equal(assessReadOnlyInventory(one(false,true)).preview,'PR209_SCHEMA_ONLY_VALIDATE_ACTUAL_WORKER');
assert.equal(assessReadOnlyInventory(one(true,true)).preview,'DUAL_TABLES_REQUIRE_MANUAL_LEDGER_AND_RECORD_RECONCILIATION');
const corrupted=one(true,false);corrupted[0].tables.revoked_sessions.columnsCompatible=false;
assert.equal(assessReadOnlyInventory(corrupted).production,'INCOMPATIBLE_REVOCATION_COLUMNS_STOP_RELEASE',
  'Incorrect token_hash/expiry/extra-column contract must fail closed');
await assert.rejects(inspectRevocationDatabases({
  accountId:'0123456789abcdef0123456789abcdef',apiToken:secret,configs,
  fetchImpl:async()=>({ok:false,status:403,json:async()=>({errors:[{message:'NEVER_PRINT_DATABASE_PRIVATE_DETAILS'}]})})
}),error=>!String(error).includes('NEVER_PRINT_DATABASE_PRIVATE_DETAILS'));
await assert.rejects(inspectRevocationDatabases({
  accountId:'0123456789abcdef0123456789abcdef',apiToken:secret,configs,
  fetchImpl:async()=>({ok:true,status:200,json:async()=>({success:false,errors:[{message:'NEVER_PRINT_SECRET'}]})})
}),error=>!String(error).includes('NEVER_PRINT_SECRET'));
assert.ok(all.every(x=>x.sql.includes('sqlite_master')||x.sql.includes('pragma_table_info')||x.sql.includes('COUNT(*)')||x.sql.includes('AS migration_name')));
console.log('Manual Cloudflare revocation inventory fake PASS: both D1 IDs, schema/ledger/count metadata only, dual table stop, bad response confidentiality, no writes or live requests.');
