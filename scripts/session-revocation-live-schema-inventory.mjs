/* Explicit manual audit of D1 revocation TABLE METADATA and aggregate counts ONLY.
 * NO session hashes, bearer cookies, users, credentials, tokens, or customer rows.
 * Does not apply migrations, modify Worker code, or deploy. Never auto-run in CI.
 *
 * To run manually, with an authorized scoped Cloudflare D1 read-only API token:
 * CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/session-revocation-live-schema-inventory.mjs --read-only
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const TABLES=Object.freeze(['revoked_sessions','revoked_session_tokens']);
const LEDGERS=Object.freeze(['d1_migrations','__drizzle_migrations','migrations','schema_migrations']);
const allowed=new Set([...TABLES,...LEDGERS]);
const getField=(txt,key)=>txt.match(new RegExp('^\\s*'+key+'\\s*=\\s*"([^"]+)"','m'))?.[1]||'';
export function configuredDatabases(production,preview){
  const p=getField(production,'database_id'),v=getField(preview,'database_id');
  const valid=id=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
  assert.ok(valid(p)&&valid(v)&&p!==v,'Need two different, explicitly configured Cloudflare D1 databases');
  assert.equal(getField(production,'name'),'kunonline','Production config target mismatch');
  assert.equal(getField(preview,'name'),'kunonline-preview','Preview config target mismatch');
  return [{environment:'production_db',id:p},{environment:'preview_db',id:v}];
}

export function assessReadOnlyInventory(databases){
  const byName=Object.fromEntries(databases.map(x=>[x.environment,x]));
  const p=byName.production_db,v=byName.preview_db;
  if(!p||!v)throw Error('Both configured D1 databases must be audited');
  const outcome=x=>{
    const legacy=x.tables.revoked_sessions,pending=x.tables.revoked_session_tokens;
    // Matching table names with incompatible columns are NOT proof that revocation is safe.
    if((legacy.exists&&legacy.columnsCompatible!==true)||(pending.exists&&pending.columnsCompatible!==true))
      return 'INCOMPATIBLE_REVOCATION_COLUMNS_STOP_RELEASE';
    if(legacy.exists&&pending.exists)return 'DUAL_TABLES_REQUIRE_MANUAL_LEDGER_AND_RECORD_RECONCILIATION';
    if(legacy.exists)return 'LEGACY_SCHEMA_ONLY_VALIDATE_ACTUAL_WORKER';
    if(pending.exists)return 'PR209_SCHEMA_ONLY_VALIDATE_ACTUAL_WORKER';
    return 'NO_REVOCATION_SCHEMA_PRESENT_STOP_RELEASE';
  };
  return {production:outcome(p),preview:outcome(v),
    releaseAuthorized:false,remoteWorkerBindingsVerified:false,recordMigrationAuthorized:false,
    warnings:['Read-only D1 inventory cannot establish the active Worker code, binding, session verification behavior or a migration approval.',
      'Production browser auth can delegate to the Preview Worker; do not deploy based on the Production DB result alone.',
      'If both tables exist, never discard either table or its active hashes; reconcile with a separately reviewed idempotent migration.']};
}

const fixedQuery={
  names:"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('revoked_sessions','revoked_session_tokens','d1_migrations','__drizzle_migrations','migrations','schema_migrations') ORDER BY name"
};
export async function inspectRevocationDatabases({accountId,apiToken,configs,fetchImpl=fetch}){
  assert.match(String(accountId||''),/^[a-f0-9]{32}$/i,'Cloudflare account id is required (not printed)');
  assert.ok(typeof apiToken==='string'&&apiToken.length>=10,'Cloudflare API credential is required (not printed)');
  const targets=configuredDatabases(configs.production,configs.preview);
  async function sql(dbId,statement){
    // This audit's entire query surface is a set of literal SELECT statements.
    // The table names can never be supplied by an external argument or CLI.
    assert.match(statement,/^SELECT\s/i);
    assert.doesNotMatch(statement,/;|\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|PRAGMA)\b/i);
    const response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/d1/database/'+dbId+'/query',{
      method:'POST',headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},
      body:JSON.stringify({sql:statement,params:[]}),redirect:'error'
    });
    if(!response.ok)throw Error('Read-only D1 metadata query rejected (HTTP '+response.status+')');
    const body=await response.json();
    const item=body?.result?.[0];
    if(body?.success!==true||item?.success===false||!Array.isArray(item?.results))
      throw Error('Read-only D1 metadata query returned an invalid response');
    return item.results;
  }
  const reports=[];
  for(const target of targets){
    const names=new Set((await sql(target.id,fixedQuery.names)).map(x=>String(x.name)));
    const tables={};
    for(const table of TABLES){
      assert.ok(allowed.has(table));
      const exists=names.has(table);
      const columns=exists?(await sql(target.id,"SELECT name, type, \"notnull\" AS required, pk FROM pragma_table_info('"+table+"') ORDER BY cid"))
        .map(x=>({name:String(x.name),type:String(x.type||''),required:Number(x.required||0)!==0,primaryKey:Number(x.pk||0)!==0})):[];
      const field=name=>columns.find(col=>col.name===name);
      const hash=field('token_hash'),expiry=field('expires_at'),revoked=field('revoked_at');
      const columnsCompatible=exists&&Boolean(
        hash?.primaryKey&&/^TEXT$/i.test(hash.type)&&
        expiry?.required&&/^INTEGER$/i.test(expiry.type)&&
        (table!=='revoked_session_tokens'||(revoked?.required&&/^TEXT$/i.test(revoked.type)))
      );
      // Incorrect schemas must not be considered healthy or have their
      // column values inspected. A fail-closed assessment blocks the release.
      const count=columnsCompatible?(await sql(target.id,`SELECT COUNT(*) AS total, SUM(CASE WHEN expires_at > CAST(strftime('%s','now') AS INTEGER) THEN 1 ELSE 0 END) AS unexpired FROM ${table}`))[0]:null;
      tables[table]={exists,columns,columnsCompatible,
        counts:count?{total:Number(count.total||0),unexpired:Number(count.unexpired||0)}:null};
    }
    const ledgers={};
    for(const table of LEDGERS.filter(n=>names.has(n))){
      const columns=(await sql(target.id,"SELECT name FROM pragma_table_info('"+table+"') ORDER BY cid")).map(x=>String(x.name));
      const nameColumn=columns.find(x=>['name','filename','migration_name'].includes(x));
      // Return just migration *filenames*, never migration SQL or customer rows.
      const matchingNames=nameColumn?(await sql(target.id,'SELECT "'+nameColumn+'" AS migration_name FROM "'+table+'" WHERE LOWER("'+nameColumn+'") LIKE \'%revok%\' OR LOWER("'+nameColumn+'") LIKE \'0099%\' OR LOWER("'+nameColumn+'") LIKE \'0098%\' ORDER BY "'+nameColumn+'" LIMIT 30'))
        .map(x=>String(x.migration_name)):[];
      ledgers[table]={columns,matchingRevocationMigrationNames:matchingNames};
    }
    reports.push({environment:target.environment,tables,ledgers,
      configuredDatabaseIdVerified:true,deployedBindingVerified:false});
  }
  const assessment=assessReadOnlyInventory(reports);
  return {auditType:'SCHEMA_ONLY_NO_WRITES',reports,assessment};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--read-only'){
    throw Error('Explicit --read-only is required; no environment is inspected automatically');
  }
  const [production,preview]=await Promise.all([
    readFile(new URL('../wrangler.production.toml',import.meta.url),'utf8'),
    readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8')
  ]);
  const result=await inspectRevocationDatabases({
    accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN,
    configs:{production,preview}
  });
  // Contract: only schema, migration filenames and aggregate counts; NEVER hash/identity.
  console.log(JSON.stringify(result,null,2));
  console.error('RELEASE BLOCKED until deployed Worker binding, migration ledger and migration direction are independently reviewed.');
}
