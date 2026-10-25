// Read-only aggregate diagnostic. No row identifiers or balances are returned.
const id='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';
const queries={
 duplicateUnitClassification:`SELECT COUNT(*) AS duplicate_groups,COALESCE(SUM(CASE WHEN client_id LIKE 'QA-%' THEN 1 ELSE 0 END),0) AS qa_prefixed_groups,COALESCE(SUM(CASE WHEN client_id='PREVIEW-STORE-001' THEN 1 ELSE 0 END),0) AS historical_preview_fixture_groups,COALESCE(SUM(CASE WHEN unit_exists=0 THEN 1 ELSE 0 END),0) AS orphan_unit_groups,COALESCE(SUM(CASE WHEN live_orders=0 THEN 1 ELSE 0 END),0) AS groups_without_live_orders FROM (SELECT a.client_id,a.unit_id,MAX(EXISTS(SELECT 1 FROM inventory_units u WHERE u.id=a.unit_id AND u.client_id=a.client_id)) AS unit_exists,SUM(EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.client_id=a.client_id AND o.state IN ('confirmed','preparing','shipped'))) AS live_orders FROM order_unit_allocations a WHERE a.status IN ('reserved','packed','shipped','delivered','return_pending') GROUP BY a.client_id,a.unit_id HAVING COUNT(*)>1)`,
 duplicateAllocationStateCounts:`SELECT a.status,COUNT(*) AS allocation_count,COALESCE(SUM(EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.client_id=a.client_id)),0) AS existing_orders,COALESCE(SUM(EXISTS(SELECT 1 FROM inventory_units u WHERE u.id=a.unit_id AND u.client_id=a.client_id AND u.current_order_id=a.order_id)),0) AS current_physical_links FROM order_unit_allocations a JOIN (SELECT client_id,unit_id FROM order_unit_allocations WHERE status IN ('reserved','packed','shipped','delivered','return_pending') GROUP BY client_id,unit_id HAVING COUNT(*)>1) d ON d.client_id=a.client_id AND d.unit_id=a.unit_id WHERE a.status IN ('reserved','packed','shipped','delivered','return_pending') GROUP BY a.status`
};
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('DIAGNOSTIC_RUNTIME_UNAVAILABLE');
 async function api(method,path,body){
  if(method!=='GET'&&!(method==='POST'&&path===`d1/database/${id}/query`&&Object.values(queries).includes(body?.sql)))throw Error('DIAGNOSTIC_WRITE_FORBIDDEN');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const d=await r.json();if(!r.ok||d.success!==true)throw Error('DIAGNOSTIC_READ_FAILED');return d.result;
 }
 const settings=await api('GET','workers/scripts/kunonline-preview/settings');if(!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id===id))throw Error('DIAGNOSTIC_BINDING_CHANGED');
 const reports={};for(const [name,sql] of Object.entries(queries)){const r=await api('POST',`d1/database/${id}/query`,{sql});if(!Array.isArray(r?.[0]?.results)||r[0].success===false)throw Error('DIAGNOSTIC_RESULTS_UNAVAILABLE');reports[name]=r[0].results;}
 console.log(JSON.stringify({kind:'GENERAL_RELEASE_READONLY_INVARIANT_DIAGNOSTIC',testedAt:new Date().toISOString(),reports,customerRowsModified:false,identifiersReturned:false,aggregatesOnly:true}));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(e?.message||'')?e.message:'DIAGNOSTIC_FAILED',customerRowsModified:false}));process.exitCode=1;});
