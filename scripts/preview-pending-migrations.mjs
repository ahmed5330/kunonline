// Wrangler migrations list initializes d1_migrations, even for an inspection.
// This alternative executes SELECT only and refuses missing migration history.
import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export const HISTORY_TABLE_SQL="SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'";
export const APPLIED_MIGRATIONS_SQL='SELECT name FROM d1_migrations ORDER BY id';
const validName=name=>typeof name==='string'&&/^[0-9]{4}_[A-Za-z0-9._-]+\.sql$/.test(name);
function rowsOf(payload){
  if(!payload||typeof payload!=='object')throw Error('Unrecognized D1 migration history response');
  if(payload.success===false||(Array.isArray(payload.errors)&&payload.errors.length))
    throw Error('D1 migration history query failed');
  if(Array.isArray(payload)){
    if(payload.length!==1)throw Error('Ambiguous D1 migration history response');
    return rowsOf(payload[0]);
  }
  if(Array.isArray(payload.results))return payload.results;
  if(payload.result)return rowsOf(payload.result);
  throw Error('Unrecognized D1 migration history response');
}
export async function pendingMigrationsReadonly(run,files){
  if(!Array.isArray(files)||!files.length||files.some(name=>!validName(name))||new Set(files).size!==files.length)
    throw Error('Invalid local migration inventory');
  const tables=rowsOf(await run(HISTORY_TABLE_SQL));
  if(tables.length!==1||tables[0]?.name!=='d1_migrations')
    throw Error('Existing D1 migration history is missing; refusing to initialize it during read-only inspection');
  const applied=rowsOf(await run(APPLIED_MIGRATIONS_SQL));
  if(applied.some(row=>!validName(row?.name))||new Set(applied.map(row=>row.name)).size!==applied.length)
    throw Error('Malformed or duplicate D1 migration history');
  const names=new Set(applied.map(row=>row.name));
  return files.filter(name=>!names.has(name)).sort();
}
export function localMigrationFiles(){
  return readdirSync('migrations').filter(name=>name.endsWith('.sql'));
}
export function queryMigrationHistory(sql){
  if(![HISTORY_TABLE_SQL,APPLIED_MIGRATIONS_SQL].includes(sql))throw Error('Unregistered migration history query');
  // Invoke the installed JS entry point directly; no shell or npx.cmd on Windows.
  return JSON.parse(execFileSync(process.execPath,[
    'node_modules/wrangler/bin/wrangler.js','d1','execute','kunonline-preview','--remote','--json',
    '--config','wrangler.preview.toml','--command',sql
  ],{encoding:'utf8',timeout:45000,maxBuffer:1024*1024}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const pending=await pendingMigrationsReadonly(queryMigrationHistory,localMigrationFiles());
  console.log(pending.length?pending.join('\n'):'No migrations to apply');
}
