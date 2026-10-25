import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SCHEMA_SQL,extractSchemaRows,buildMigrationFiles} from './preview-live-schema-rehearsal.mjs';
export const declarations=['migrations/0092_inventory_unit_qr_tracking.sql','migrations/0093_inventory_scan_fulfillment_returns.sql','migrations/0094_warehouse_unit_operations.sql'];
const signature=sql=>String(sql||'').replace(/\s+/g,'').replace(/ifnotexists/ig,'').toLowerCase();
export function checkExistingInventorySchema(schemaRows,files){
 const actual=new DatabaseSync(':memory:'),expected=new DatabaseSync(':memory:');
 try{
  actual.exec('PRAGMA foreign_keys=OFF');expected.exec('PRAGMA foreign_keys=OFF');
  const rows=extractSchemaRows([{success:true,results:schemaRows}]);
  for(const type of ['table','index','view','trigger'])for(const row of rows.filter(x=>x.type===type))actual.exec(row.sql);
  for(const file of files)expected.exec(file.sql);
  const objects=expected.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const columns=(db,name)=>db.prepare('SELECT name,type,"notnull" AS required,pk FROM pragma_table_info(?)').all(name);
  let tables=0;
  for(const object of objects){
   if(!/^[A-Za-z0-9_]+$/.test(object.name))throw Error('INVENTORY_SCHEMA_NAME_INVALID');
   const found=actual.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(object.type,object.name);
   if(!found)throw Error('INVENTORY_SCHEMA_OBJECT_MISSING_'+object.name);
   if(object.type==='table'){
    tables++;const live=new Map(columns(actual,object.name).map(x=>[x.name,x]));
    for(const col of columns(expected,object.name)){
     const item=live.get(col.name);
     if(!item||item.type.toUpperCase()!==col.type.toUpperCase()||item.pk!==col.pk||item.required<col.required)throw Error('INVENTORY_SCHEMA_COLUMN_MISMATCH_'+object.name+'_'+col.name);
    }
   }else if(signature(found.sql)!==signature(object.sql))throw Error('INVENTORY_SCHEMA_DEFINITION_MISMATCH_'+object.name);
  }
  const before=JSON.stringify(actual.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all());
  for(const file of files)actual.exec(file.sql);
  if(before!==JSON.stringify(actual.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()))throw Error('INVENTORY_SCHEMA_CHANGE_REQUIRED');
  return {ok:true,requiredTables:tables,requiredDeclarations:objects.length,existingSchemaAlreadyCompatible:true,schemaChangesRequired:false};
 }finally{actual.close();expected.close();}
}
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('INVENTORY_SCHEMA_RUNTIME_UNAVAILABLE');
 const config=readFileSync('wrangler.preview.toml','utf8');
 if(!/^name\s*=\s*"kunonline-preview"/m.test(config)||!config.includes('31cd5cdf-fc01-42d7-ba1e-571f3dd58495'))throw Error('INVENTORY_SCHEMA_SOURCE_CHANGED');
 async function api(method,path,body){
  if(method!=='GET'&&!(method==='POST'&&body?.sql===SCHEMA_SQL))throw Error('INVENTORY_SCHEMA_WRITE_FORBIDDEN');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const d=await r.json().catch(()=>({}));if(!r.ok||d.success!==true)throw Error('INVENTORY_SCHEMA_READ_FAILED');return d.result;
 }
 const settings=await api('GET','workers/scripts/kunonline-preview/settings');
 if(!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id==='31cd5cdf-fc01-42d7-ba1e-571f3dd58495'))throw Error('INVENTORY_SCHEMA_BINDING_CHANGED');
 const rows=extractSchemaRows(await api('POST','d1/database/31cd5cdf-fc01-42d7-ba1e-571f3dd58495/query',{sql:SCHEMA_SQL}));
 const result=checkExistingInventorySchema(rows,buildMigrationFiles(declarations));
 console.log(JSON.stringify({kind:'EXISTING_INVENTORY_SCHEMA_PROVEN',...result,customerRowsRead:false,customerRowsModified:false,remoteMigrationsApplied:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({ok:false,code:/^[A-Za-z0-9_]+$/.test(e?.message||'')?e.message:'INVENTORY_SCHEMA_CHECK_FAILED',customerRowsRead:false,customerRowsModified:false}));process.exitCode=1;});
