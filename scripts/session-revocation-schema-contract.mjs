// SEC-02 static contract only: never touches cloud databases, sessions or secrets.
// Local proposal 0098 revoked_sessions and PR #209 revoked_session_tokens differ.
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const CANDIDATES=['revoked_session_tokens','revoked_sessions'];
const fail=detail=>{throw new Error('SESSION_REVOCATION_SCHEMA_CONFLICT: '+detail);};
const referenced=source=>[...new Set([...source.matchAll(/\b(?:FROM|INTO)\s+(revoked_session_tokens|revoked_sessions)\b/gi)].map(x=>x[1].toLowerCase()))];
const created=sql=>[...new Set([...sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(revoked_session_tokens|revoked_sessions)\b/gi)].map(x=>x[1].toLowerCase()))];

export function verifyRevocationContract({moduleSource,migrations,productionWorkflow,productionEntry,productionConfig,previewConfig,sessionAuthSource}){
  if(!Array.isArray(migrations)||!migrations.length)fail('No revocation migration found');
  const tables=referenced(moduleSource);
  if(tables.length!==1)fail('Handler must reference exactly one revocation table: '+tables.join(','));
  const table=tables[0];
  const migrationsWithTables=migrations.map(m=>({path:m.path,tables:created(m.content)}));
  if(migrationsWithTables.length!==1)fail('Multiple revocation migrations need deliberate reconciliation');
  if(migrationsWithTables[0].tables.length!==1||migrationsWithTables[0].tables[0]!==table)
    fail('Handler uses '+table+' while '+migrationsWithTables[0].path+' creates '+migrationsWithTables[0].tables.join(','));
  // Check SQL column compatibility too. Matching table names with mismatched
  // fingerprint/expiry columns would still break all authenticated sessions.
  const selectedMigration=migrations[0].content;
  const createPattern=new RegExp('CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'+table+'\\s*\\(([^;]+)\\)','i');
  const definition=selectedMigration.match(createPattern)?.[1]||'';
  const insertPattern=new RegExp('INSERT\\s+(?:OR\\s+IGNORE\\s+)?INTO\\s+'+table+'\\s*\\(([^)]+)\\)','i');
  const writeColumns=moduleSource.match(insertPattern)?.[1]?.split(',').map(x=>x.trim())||[];
  const readPattern=new RegExp('SELECT\\s+([A-Za-z_]+)\\s+FROM\\s+'+table+'\\b','i');
  const readColumn=moduleSource.match(readPattern)?.[1]||'';
  if(!definition||!readColumn||!writeColumns.length)fail('Could not reconcile revocation read/write columns');
  const declaredColumns=new Set([...definition.matchAll(/(?:^|,)\s*([A-Za-z_]+)\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/gi)].map(x=>x[1]));
  for(const column of new Set([readColumn,...writeColumns,'expires_at'])){
    if(!declaredColumns.has(column))fail('Migration '+migrations[0].path+' does not define required column '+column);
  }

  if(!/sessionTokenHash\s*\(/.test(moduleSource)||!/SHA-256/.test(moduleSource))
    fail('Revocation lookup must SHA-256 fingerprint the exact bearer token');
  if(!/jti:\s*crypto\.randomUUID\(\)/.test(sessionAuthSource))
    fail('Independent simultaneous logins require unique jti');
  if(!/isSessionRevoked\s*\(\s*env\s*,\s*token\s*\)/.test(sessionAuthSource))
    fail('Authenticated session lookup must query revocation');
  if(!/revokeSession\s*\(\s*env\s*,\s*sessionTokenFromRequest\(request\)/.test(sessionAuthSource))
    fail('Logout must revoke the exact same token that authentication checked');
  if(!/AUTH_PATHS\.has\(new URL\(request\.url\)\.pathname\)/.test(productionEntry)||
     !/previewFetch\(request,env\)/.test(productionEntry)||
     !/binding\s*=\s*"PREVIEW_APP"/.test(productionConfig)||
     !/binding\s*=\s*"PREVIEW_DB"/.test(productionConfig)||
     !/main\s*=\s*"src\/index-commerce-v38\.js"/.test(previewConfig))
    fail('Effective Preview authentication routing has changed; re-evaluate migration target');
  if(!productionWorkflow.includes('FROM '+table+' LIMIT 0;'))
    fail('Production read-only migration preflight checks wrong schema');
  for(const other of CANDIDATES.filter(x=>x!==table)){
    if(productionWorkflow.includes('FROM '+other+' LIMIT 0;'))
      fail('Production preflight includes incompatible table '+other);
  }
  return {ok:true,staticOnly:true,canonicalTable:table,migration:migrationsWithTables[0].path,
    effectiveAuthBackend:'PREVIEW_APP / kunonline-preview',
    remoteSchemaVerified:false,previewCodeDeployed:false,productionCodeDeployed:false,liveQaSessionReplayVerified:false};
}

if(process.argv[1]&&process.argv[1]===fileURLToPath(import.meta.url)){
  const urls={
    moduleSource:'../src/session-revocation.js',
    sessionAuthSource:'../src/index.js',
    productionWorkflow:'../.github/workflows/production.yml',
    productionEntry:'../src/index-production-mobile-update.js',
    productionConfig:'../wrangler.production.toml',
    previewConfig:'../wrangler.preview.toml'
  };
  const values={};
  for(const [key,relative] of Object.entries(urls))values[key]=await readFile(new URL(relative,import.meta.url),'utf8');
  const fileNames=await readdir(new URL('../migrations/',import.meta.url));
  const names=fileNames.filter(name=>name.endsWith('.sql')&&(/session.revoc|revoked.session|(?:^|[_-])0098[_-]/i.test(name)));
  values.migrations=await Promise.all(names.map(async name=>({
    path:'migrations/'+name,content:await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')
  })));
  const result=verifyRevocationContract(values);
  assert.ok(CANDIDATES.includes(result.canonicalTable),'Unknown revocation schema must not pass');
  console.log('SEC-02 static schema contract PASS: '+result.canonicalTable+' matches '+result.migration+'. Deployed Preview Worker and remote D1 still unverified.');
}
