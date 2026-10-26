// Read-only Cloudflare D1 schema rehearsal; never uses D1 export (which can
// pause live D1 queries) and never copies real customer/order/balance rows.
// Replays DDL and reviewed additive migrations against an in-memory SQLite DB.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const SCHEMA_SQL="SELECT type,name,sql FROM sqlite_master "+
  "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "+
  "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END,name";

export function extractSchemaRows(json) {
  const parts=Array.isArray(json)?json:[json];
  const collected=[];
  for(const part of parts) {
    const rows=part?.results??part?.result?.results;
    if(!Array.isArray(rows))throw new Error('D1 schema introspection produced an unrecognized response');
    if(part?.success===false)throw new Error('D1 schema query was not successful');
    collected.push(...rows);
  }
  if(!collected.length)throw new Error('D1 schema is empty; release blocked');
  for(const row of collected) {
    if(!row || !['table','index','trigger','view'].includes(row.type) ||
       typeof row.name!=='string' || typeof row.sql!=='string' ||
       !row.sql.trim())throw new Error('Malformed D1 schema row; release blocked');
  }
  if(!collected.some(row=>row.type==='table' && row.name==='orders'))
    throw new Error('Real production-backed Preview schema missing orders table; release blocked');
  // Protect against truncated/malformed response or records from older Wranglers.
  const names=new Set();
  for(const row of collected){
    const key=row.type+':'+row.name;
    if(names.has(key))throw new Error('Duplicate D1 schema declaration: '+key);
    names.add(key);
  }
  return collected;
}
export function rehearseSchema(schemaRows,migrations){
  if(!Array.isArray(migrations) || !migrations.length)throw new Error('No explicitly reviewed migrations supplied');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=OFF');
    const rows=extractSchemaRows([{success:true,results:schemaRows}]);
    for(const type of ['table','index','view','trigger']){
      for(const row of rows.filter(x=>x.type===type)){
        try{db.exec(row.sql)}catch(error){throw new Error('Existing D1 '+type+' DDL replay failed at '+row.name+': '+error.message)}
      }
    }
    if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
      throw new Error('Local schema integrity failed before migrations');
    for(const migration of migrations){
      if(!/^migrations\/[0-9]{4}_[A-Za-z0-9._-]+\.sql$/.test(migration.name))
        throw new Error('Unreviewed migration name');
      try{db.exec(migration.sql)}catch(error){
        throw new Error('Migration rehearsal failed at '+migration.name+': '+error.message);
      }
    }
    if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
      throw new Error('Local schema integrity failed after migrations');
    return {ok:true,existingDeclarations:rows.length,applied:migrations.map(x=>x.name)};
  } finally {db.close()}
}
export function buildMigrationFiles(paths){
  return paths.map(name=>{
    if(!/^migrations\/[0-9]{4}_[A-Za-z0-9._-]+\.sql$/.test(name))
      throw new Error('Migration path refused');
    let sql;
    try{sql=readFileSync(name,'utf8')}catch(error){
      const inventory=['migrations/0092_inventory_unit_qr_tracking.sql','migrations/0093_inventory_scan_fulfillment_returns.sql','migrations/0094_warehouse_unit_operations.sql'];
      if(error.code!=='ENOENT'||!inventory.includes(name))throw error;
      sql=readFileSync(new URL('./fixtures/inventory/'+name.split('/').at(-1),import.meta.url),'utf8');
    }
    return {name,sql};
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv.slice(2).length)throw Error('Reviewed migration file list is mandatory');
  // JSON-only read query, no D1 export, no backups, no customer content.
  const raw=execFileSync('npx',[
    'wrangler','d1','execute','kunonline-preview','--remote','--json',
    '--config','wrangler.preview.toml','--command',SCHEMA_SQL
  ],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
  const rows=extractSchemaRows(JSON.parse(raw));
  const result=rehearseSchema(rows,buildMigrationFiles(process.argv.slice(2)));
  console.log('Live D1 read-only schema introspection + ephemeral SQLite migration rehearsal PASS: '+result.applied.length+' additive migration(s), '+result.existingDeclarations+' DDL declarations; zero real customer rows copied.');
}
