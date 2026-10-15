// Minimal read-only live Cloudflare D1 connectivity and recovery-capability audit.
// Deliberately excludes all customer row data, changes and backup restores.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {pendingMigrationsReadonly,localMigrationFiles,queryMigrationHistory} from './preview-pending-migrations.mjs';

export function verifyD1Info(json){
  if(json?.success===false||(Array.isArray(json?.errors)&&json.errors.length))
    throw Error('D1 metadata request failed');
  const raw=json?.result??json;
  if(Array.isArray(raw)&&raw.length!==1)throw Error('Ambiguous D1 metadata');
  const obj=Array.isArray(raw)?raw[0]:raw;
  if(!obj||typeof obj!=='object'||obj.version!=='production')
    throw Error('D1 production storage and Time Travel support not verified');
  if(obj.uuid!=='31cd5cdf-fc01-42d7-ba1e-571f3dd58495'||obj.name!=='kunonline-preview')
    throw Error('Unexpected D1 database identity');
  return {storage:'production',supportsTimeTravel:true};
}
export async function fetchD1Storage({fetcher=fetch,env=process.env}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw Error('D1 metadata credentials missing or malformed');
  // Wrangler d1 info intentionally removes version; use the documented GET
  // metadata endpoint rather than weakening the required production check.
  const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+account+
    '/d1/database/31cd5cdf-fc01-42d7-ba1e-571f3dd58495',{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('D1 metadata request HTTP '+response.status);
  return verifyD1Info(await response.json());
}
export function pendingMigrationNames(log){
  if(typeof log!=='string')throw Error('Wrangler migration listing unavailable');
  const matches=[...log.matchAll(/\b[0-9]{4}_[A-Za-z0-9._-]+\.sql\b/g)].map(m=>m[0]);
  const files=[...new Set(matches)].sort();
  if(!files.length && !/no migrations to apply|no migrations found|there are no migrations/i.test(log))
    throw Error('D1 migration-list format unrecognized');
  return files;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await fetchD1Storage();
  if(process.argv.includes('--storage-only')){
    console.log(JSON.stringify({version:'production'}));
  }else{
    const pending=await pendingMigrationsReadonly(queryMigrationHistory,localMigrationFiles());
    console.log('Read-only shared D1 connectivity PASS: production storage and Time Travel capability; pending migration count = '+pending.length);
    console.log('Time Travel availability does not verify any independent offsite backup or a tested restore.');
  }
}
