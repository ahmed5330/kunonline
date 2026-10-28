// Read-only, fail-closed schema check for the production-backed Preview D1.
// Must run AFTER any reviewed schema migration and BEFORE upgrading the Worker.
// No customer rows, balances or orders are queried or included in CI output.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const REQUIRED_RELEASE_SCHEMA=Object.freeze({
  audit_log:['id','client_id','store_id','actor_user_id','actor_email','action','entity_type','entity_id','before_json','after_json','metadata_json','created_at'],
  transactions:['id','type','date','category','amount','currency','method','client_id','store_id','note','created_by','created_at','document_no','counterparty','tax_amount','due_date','reference_type','reference_id','attachment_url','metadata_json'],
  stores:['id','client_id','management_fee_pct','updated_at'],
  wallet_accounts:['client_id','balance','billing_version','credit_limit'],
  wallet_log:['client_id','type','amount','balance_after','reference_type','reference_id'],
  wallet_topup_requests:['id','client_id','status','amount'],
  subscriptions:['id','client_id','status','amount'],
  orders:['id','client_id'],
  inventory_units:['id','unit_code','client_id','store_id','product_id','status'],
  inventory_unit_events:['id','unit_id','unit_code','client_id','event_type'],
  order_unit_allocations:['id','client_id','order_id','unit_id','status'],
  inventory_scan_sessions:['id','client_id','order_id','scan_context'],
  inventory_scan_events:['id','client_id','scan_kind','result'],
  inventory_shipments:['id','client_id','order_id','idempotency_key'],
  inventory_shipment_units:['shipment_id','client_id','unit_id']
});

const safeNames=Object.keys(REQUIRED_RELEASE_SCHEMA);
for(const [table,columns] of Object.entries(REQUIRED_RELEASE_SCHEMA)){
  assert(/^[a-z_]+$/.test(table));
  for(const col of columns)assert(/^[a-z_]+$/.test(col));
}
const schemaSelect=name=>"SELECT '"+name+"' AS table_name, name AS column_name FROM pragma_table_info('"+name+"')";
export const READONLY_SCHEMA_SQL=safeNames.map(schemaSelect).join(' UNION ALL ')+' ORDER BY table_name,column_name';
// Cloudflare D1 limits compound SELECT terms more strictly than local SQLite.
// Read bounded metadata batches, then validate the complete table set together.
export const READONLY_SCHEMA_BATCHES=Object.freeze(Array.from({length:Math.ceil(safeNames.length/4)},(_,i)=>
  safeNames.slice(i*4,i*4+4).map(schemaSelect).join(' UNION ALL ')+' ORDER BY table_name,column_name'));
export async function verifyReleaseSchemaReadonly(run){
  const all=[];
  for(const sql of READONLY_SCHEMA_BATCHES){
    const rows=findRows(await run(sql));
    if(!rows)throw Error('D1 schema batch unrecognized — deployment blocked');
    all.push(...rows);
  }
  return checkReleaseSchema(all);
}

function findRows(response){
  if(Array.isArray(response)){
    if(response.every(x=>x && typeof x==='object' && ('table_name' in x)))return response;
    for(const part of response){const rows=findRows(part);if(rows)return rows;}
  }
  if(response && typeof response==='object'){
    for(const key of ['results','result','data'])if(key in response){
      const rows=findRows(response[key]);
      if(rows)return rows;
    }
  }
  return null;
}
export function validateReleaseSchema(payload){
  const rows=findRows(payload);
  if(!rows)throw Error('D1 schema response is empty or unrecognized — deployment blocked');
  const have=new Map();
  for(const row of rows){
    const table=String(row.table_name||'');
    const column=String(row.column_name||'');
    if(!have.has(table))have.set(table,new Set());
    have.get(table).add(column);
  }
  const missing=[];
  for(const [table,cols] of Object.entries(REQUIRED_RELEASE_SCHEMA)){
    for(const col of cols)if(!have.get(table)?.has(col))missing.push(table+'.'+col);
  }
  return {ok:missing.length===0,missing,verifiedTables:safeNames.length};
}
export function checkReleaseSchema(fetchJson){
  const result=validateReleaseSchema(fetchJson);
  if(!result.ok)throw Error('Preview D1 release schema is incomplete ('+result.missing.join(', ')+') — deployment blocked');
  return result;
}
const direct=process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(direct){
  const checked=await verifyReleaseSchemaReadonly(sql=>{
  const stdout=execFileSync('npx',[
    'wrangler','d1','execute','kunonline-preview','--remote','--json',
    '--config','wrangler.preview.toml','--command',sql
  ],{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  return JSON.parse(stdout);
  });
  console.log('Read-only Preview D1 release schema PASS: '+checked.verifiedTables+' required tables; no customer data queried.');
}
