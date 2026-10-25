// Observe existing scheduling only. Never invoke reconciliation or modify D1.
import {createHash} from 'node:crypto';
import {fullTrafficVersion} from './cloudflare-full-traffic-version.mjs';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const database='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';
const connectionFingerprint='975a5f7977c84755da82f3b732d6ff9b39bb850ad7e6713484378bb027d2457d';
async function main(){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  const expected=process.env.KUN_EXPECTED_PREVIEW_VERSION;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expected||''))throw Error('OBSERVER_RUNTIME_UNAVAILABLE');
  async function request(method,path,body){
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.success!==true)throw Error('OBSERVER_METADATA_UNAVAILABLE');
    return payload.result;
  }
  async function ownership(){
    const result=await request('GET','workers/scripts/kunonline-preview/deployments');
    if(fullTrafficVersion(result)!==expected)throw Error('OBSERVER_WORKER_VERSION_CHANGED');
  }
  async function select(sql,params=[]){
    if(!/^SELECT\b/.test(sql)||/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i.test(sql))throw Error('OBSERVER_SQL_NOT_READONLY');
    const result=await request('POST',`d1/database/${database}/query`,{sql,params});
    if(result?.some(x=>x.success===false))throw Error('OBSERVER_SELECT_FAILED');
    return result?.[0]?.results||[];
  }
  await ownership();
  const settings=await request('GET','workers/scripts/kunonline-preview/settings');
  if(!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id===database))throw Error('OBSERVER_DB_BINDING_CHANGED');
  const scheduler=await request('GET','workers/scripts/kunonline-sync-preview/settings');
  if(!(scheduler.bindings||[]).some(x=>x.type==='service'&&x.name==='APP_SYNC'&&x.service==='kunonline-preview'&&x.entrypoint==='SyncEntrypoint'))throw Error('OBSERVER_SYNC_BINDING_CHANGED');
  const schedules=await request('GET','workers/scripts/kunonline-sync-preview/schedules');
  if(!schedules.schedules?.some(x=>x.cron==='*/5 * * * *'))throw Error('OBSERVER_FIVE_MINUTE_CRON_MISSING');
  const candidates=await select("SELECT id,client_id,external_store_id,CASE WHEN json_valid(config_json) THEN COALESCE(json_extract(config_json,'$.kunStoreId'),json_extract(config_json,'$.storeId')) END AS store_id FROM store_connections WHERE provider='easyorders'");
  const targets=candidates.filter(x=>hash(x.id)===connectionFingerprint);
  if(targets.length!==1)throw Error('OBSERVER_CONNECTION_SCOPE_CHANGED');
  const target=targets[0];
  if(hash(target.client_id)!=='719318eb4257a238f8dd5e65818122a0da906062f4788b4e70e945e9196b2dc2'||hash(target.store_id)!=='9381d0b26157bd6283d4c526e9d4baac139d103cc1bf5abc3e96cd1bbbec292d'||hash(target.external_store_id)!=='6bb4884d34c51ae38ce86b015c7573d3ce65b7dc4722d8b8819aea9a55befc7d')throw Error('OBSERVER_STORE_SCOPE_CHANGED');
  const start=Date.now(),receipts=new Set();
  while(Date.now()-start<20*60*1000&&receipts.size<2){
    await ownership();
    const rows=await select(`SELECT json_extract(config_json,'$.easyOrdersRecoveryLastCronAt') AS receipt,
      json_extract(config_json,'$.easyOrdersRecoveryLastStatus') AS status,
      CASE WHEN COALESCE(TRIM(json_extract(config_json,'$.easyOrdersRecoveryLastError')),'')<>'' THEN 1 ELSE 0 END AS error_present
      FROM store_connections WHERE id=? AND client_id=? AND external_store_id=? AND provider='easyorders' AND json_valid(config_json) AND COALESCE(json_extract(config_json,'$.kunStoreId'),json_extract(config_json,'$.storeId'))=?`,[target.id,target.client_id,target.external_store_id,target.store_id]);
    if(rows.length!==1)throw Error('OBSERVER_CONNECTION_UNAVAILABLE');
    const row=rows[0],time=Date.parse(row.receipt||'');
    if(Number.isFinite(time)&&time>=start&&!receipts.has(row.receipt)){
      const ok=!Number(row.error_present)&&['healthy','catching_up','waiting_for_short_id'].includes(row.status);
      console.log(JSON.stringify({kind:'WEFAQ_LIVE_CRON_MARKER',receipt:row.receipt,status:row.status,errorPresent:!!Number(row.error_present),successfulMarker:ok,customerRowsModified:false}));
      if(!ok)throw Error('OBSERVER_LIVE_CRON_REPORTED_ERROR');
      const last=[...receipts].at(-1);
      if(!last||time-Date.parse(last)>=240000)receipts.add(row.receipt);
    }
    if(receipts.size<2)await new Promise(resolve=>setTimeout(resolve,20000));
  }
  if(receipts.size!==2)throw Error('OBSERVER_TWO_FRESH_MARKERS_NOT_OBSERVED');
  await ownership();
  console.log(JSON.stringify({kind:'WEFAQ_TWO_LIVE_CRON_MARKERS_OBSERVED',version:expected,receipts:[...receipts],customerRowsModified:false,providerAuditExecuted:false,upstreamIdentityVerified:false,missingOrderCount:null,nativeInvocationLogsExamined:false}));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(e?.message||'')?e.message:'OBSERVER_FAILED',customerRowsModified:false}));process.exitCode=1;});
