// Schema metadata only: never select customer rows or apply a migration.
const sources=[['preview','kunonline-preview','DB','31cd5cdf-fc01-42d7-ba1e-571f3dd58495'],['production','kunonline','DB','c426601d-182f-486e-a5c1-bb1bca0ecb0b']];
const tables=['revoked_sessions','revoked_session_tokens','users','faos_journals','faos_journal_lines','faos_periods','wallet_accounts','wallet_ledger','wallet_topup_requests','order_management_fees','inventory_units','inventory_unit_events','order_unit_allocations','inventory_scan_sessions','inventory_scan_events','inventory_operation_guards','inventory_shipments','inventory_schema_v128_4_ready'];
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('SCHEMA_RUNTIME_UNAVAILABLE');
 async function api(method,path,body){
  if(method!=='GET'&&!(method==='POST'&&path.endsWith('/query')&&/^SELECT\b/.test(body?.sql||'')&&!/;|\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|REPLACE)\b/i.test(body.sql)))throw Error('SCHEMA_WRITE_FORBIDDEN');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});
  const d=await r.json().catch(()=>({}));if(!r.ok||d.success!==true)throw Error('SCHEMA_METADATA_FAILED');return d.result;
 }
 const reports=[];
 for(const [label,worker,binding,id] of sources){
  const settings=await api('GET',`workers/scripts/${worker}/settings`);
  if(!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name===binding&&x.id===id))throw Error('SCHEMA_SOURCE_BINDING_CHANGED');
  const found={};
  for(const table of tables){
   const result=await api('POST',`d1/database/${id}/query`,{sql:`SELECT name,type,pk FROM pragma_table_info('${table}')`});
   if(!Array.isArray(result?.[0]?.results)||result[0].success===false)throw Error('SCHEMA_COLUMNS_UNAVAILABLE');
   found[table]=result[0].results.map(x=>({name:x.name,type:x.type,primaryKey:Number(x.pk)>0}));
  }
  const triggers=await api('POST',`d1/database/${id}/query`,{sql:"SELECT name,tbl_name AS table_name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'faos_%' OR name LIKE 'unit_%' OR name LIKE 'inventory_%')"});
  reports.push({source:label,tables:found,triggers:triggers?.[0]?.results||[]});
 }
 console.log(JSON.stringify({kind:'GENERAL_RELEASE_SCHEMA_METADATA',testedAt:new Date().toISOString(),reports,customerRowsRead:false,customerRowsModified:false,migrationsApplied:false},null,2));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(e?.message||'')?e.message:'SCHEMA_INVENTORY_FAILED',customerRowsRead:false,customerRowsModified:false}));process.exitCode=1;});
