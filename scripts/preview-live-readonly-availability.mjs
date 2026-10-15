// Minimal read-only live Cloudflare D1 connectivity and recovery-capability audit.
// Deliberately excludes all customer row data, changes and backup restores.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {pendingMigrationsReadonly,localMigrationFiles,queryMigrationHistory} from './preview-pending-migrations.mjs';

export function verifyD1Info(json){
  const obj=Array.isArray(json)?json[0]:json;
  if(!obj||typeof obj!=='object'||obj.version!=='production')
    throw Error('D1 production storage and Time Travel support not verified');
  return {storage:'production',supportsTimeTravel:true};
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
  const base=['node_modules/wrangler/bin/wrangler.js','d1'];
  const envOpts=['--config','wrangler.preview.toml'];
  const infoRaw=execFileSync(process.execPath,[...base,'info','kunonline-preview','--json',...envOpts],
    {encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  const info=verifyD1Info(JSON.parse(infoRaw));
  const pending=await pendingMigrationsReadonly(queryMigrationHistory,localMigrationFiles());
  console.log('Read-only shared D1 connectivity PASS: production storage and Time Travel capability; pending migration count = '+pending.length);
  console.log('Time Travel availability does not verify any independent offsite backup or a tested restore.');
}
