// Read-only release preflight: detect live D1 rows that would violate
// inventory migration 0092-0094 uniqueness constraints or physical-unit guards.
// Queries return only anonymous booleans, never personal/customer/order values.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const checks=Object.freeze([
  ['tracking_code_collision','product_tracking_codes',"client_id,code"],
  ['tracking_entity_collision','product_tracking_codes',"client_id,product_id,COALESCE(variant_id,'')"],
  ['unit_code_collision','inventory_units',"client_id,unit_code"],
  ['order_unit_collision','order_unit_allocations',"order_id,unit_id"],
  ['scan_acceptance_collision','inventory_scan_events',"session_id,unit_id,scan_kind","unit_id IS NOT NULL AND result='accepted'"],
  ['return_cycle_collision','inventory_return_cases',"client_id,unit_id,cycle_token"],
  ['exchange_return_collision','inventory_exchange_cases',"client_id,return_case_id"],
  ['exchange_replacement_collision','inventory_exchange_cases',"client_id,replacement_order_id,replacement_unit_id","replacement_unit_id IS NOT NULL"],
  ['scrap_pending_collision','inventory_scrap_requests',"client_id,unit_id","status='pending'"],
  ['shipment_request_collision','inventory_shipments',"client_id,order_id,idempotency_key"],
  ['shipment_awb_collision','inventory_shipments',"client_id,awb","awb IS NOT NULL AND awb<>''"],
  ['shipment_remote_id_collision','inventory_shipments',"client_id,txlogistic_id"],
  ['shipment_unit_collision','inventory_shipment_units',"client_id,unit_id","cancelled_at IS NULL"],
  ['active_unit_double_allocation','order_unit_allocations',"client_id,unit_id","status IN ('reserved','packed','shipped','delivered','return_pending')"]
]);
const tables=[...new Set(checks.map(c=>c[1]))];
for(const t of tables)assert(/^[a-z_]+$/.test(t));

export const EXISTING_TABLES_SQL="SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+
  tables.map(t=>"'"+t+"'").join(',')+") ORDER BY name";
export function conflictSql(check){
  const [id,table,group,where]=check;
  if(!checks.some(x=>x[0]===id))throw Error('Unregistered read-only invariant');
  const filter=where?' WHERE '+where:'';
  return "SELECT EXISTS (SELECT 1 FROM (SELECT 1 FROM "+table+filter+" GROUP BY "+group+
    " HAVING COUNT(*)>1 LIMIT 1)) AS conflict";
}
function extractRows(response){
  if(Array.isArray(response)){
    for(const entry of response){
      if(entry && typeof entry==='object' && Array.isArray(entry.results))return entry.results;
      if(entry && typeof entry==='object' && 'name' in entry)return response;
    }
  }
  if(response && typeof response==='object'){
    if(Array.isArray(response.results))return response.results;
    if(Array.isArray(response.result))return extractRows(response.result);
  }
  return null;
}
export function evaluateInvariants(existingTables,conflicts){
  const present=new Set(existingTables);
  const bad=[];
  for(const [id,table] of checks){
    if(!present.has(table))continue;
    if(!(id in conflicts))throw Error('Live invariant not verified: '+id);
    const n=Number(conflicts[id]);
    if(!Number.isFinite(n)||(n!==0&&n!==1))throw Error('Invalid live invariant result: '+id);
    if(n===1)bad.push(id);
  }
  return {ok:bad.length===0,conflicts:bad,checked:checks.filter(c=>present.has(c[1])).length};
}
export function verifySqlIsReadonly(){
  for(const query of [EXISTING_TABLES_SQL,...checks.map(conflictSql)]){
    if(!query.startsWith('SELECT '))throw Error('Only read-only SELECT is allowed');
    if(/;|\b(?:INSERT|DELETE|UPDATE|ALTER|DROP|REPLACE|ATTACH|DETACH|PRAGMA)\b/i.test(query))
      throw Error('Mutating SQL forbidden in release invariant checks');
  }
  return true;
}
export const INVARIANT_CHECKS=checks.map(([id,table])=>({id,table}));
export async function verifyLiveInvariants(run){
  verifySqlIsReadonly();
  const tableRows=extractRows(await run(EXISTING_TABLES_SQL));
  if(!tableRows)throw Error('Live D1 table discovery result not recognized');
  const present=new Set(tableRows.map(r=>String(r.name)));
  const outcomes={};
  for(const check of checks){
    const [id,table]=check;
    if(!present.has(table))continue; // 0092-0094 may not have created it yet
    const rows=extractRows(await run(conflictSql(check)));
    if(!rows||rows.length!==1||!Object.hasOwn(rows[0],'conflict'))
      throw Error('Live D1 invariant query returned no verifiable result: '+id);
    outcomes[id]=rows[0].conflict;
  }
  const result=evaluateInvariants(present,outcomes);
  if(!result.ok)throw Error('Preview D1 incompatible existing rows (IDs only): '+result.conflicts.join(','));
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyLiveInvariants(sql=>{
    const raw=execFileSync('npx',['wrangler','d1','execute','kunonline-preview','--remote','--json',
      '--config','wrangler.preview.toml','--command',sql],
      {encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    return JSON.parse(raw);
  });
  console.log('Read-only D1 release invariants PASS: '+result.checked+' checks; no customer rows returned.');
}
