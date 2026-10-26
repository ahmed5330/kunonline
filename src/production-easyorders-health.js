import {easyOrdersRecoveryStatus} from './easyorders-order-reconciliation.js';

const BUILD='preview-easyorders-health-v2-scheduler-freshness';
const STALE_AFTER_MS=20*60*1000; // Four missed five-minute recovery cycles.
// This is read-only metadata from the canonical Preview D1, NOT a trigger.
export function assessEasyOrdersRecoveryFreshness(results=[],nowMs=Date.now()){
  let staleConnections=0,neverRanConnections=0,mostRecentRunAt=null;
  for(const row of results){
    const value=String(row.lastRunAt||'');
    const at=value?Date.parse(value):NaN;
    if(!Number.isFinite(at))neverRanConnections++;
    if(!Number.isFinite(at)||at>nowMs+60_000||nowMs-at>STALE_AFTER_MS)
      staleConnections++;
    if(Number.isFinite(at)&&at<=nowMs+60_000&&(!mostRecentRunAt||at>Date.parse(mostRecentRunAt)))
      mostRecentRunAt=new Date(at).toISOString();
  }
  return {staleConnections,neverRanConnections,mostRecentRunAt,staleAfterMinutes:STALE_AFTER_MS/60000};
}
function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Data-Source':'preview'}});
}

// Read the same canonical database used by PREVIEW_APP. Never decrypt Preview
// secrets with Production keys, run recovery, or fall back to legacy state here.
export async function handleProductionEasyOrdersHealth(request,env){
  if(request.method!=='GET'||new URL(request.url).pathname!=='/health/easyorders-sync')return null;
  if(!env.PREVIEW_DB&&!env.PREVIEW_APP)return null;
  const base={build:BUILD,mode:'preview-canonical',source:'preview',supportsProviderWaitingState:true,legacyFallback:{active:false}};
  if(!env.PREVIEW_DB||!env.PREVIEW_APP?.fetch)return json({...base,ok:false,status:'unavailable',runtimeDiagnostics:{failureCode:'EASYORDERS_HEALTH_UNAVAILABLE'}},503);
  try{
    const health=await easyOrdersRecoveryStatus({DB:env.PREVIEW_DB});
    const failed=health.results.filter(r=>r.status==='error');
    const invalid=failed.filter(r=>/api-key\s+not\s+valid|invalid\s+api.?key|HTTP\s+(401|403)/i.test(r.lastError||'')).length;
    const unreadable=failed.filter(r=>/cannot be decrypted|decrypt|missing.*key|key.*missing/i.test(r.lastError||'')).length;
    const freshness=assessEasyOrdersRecoveryFreshness(health.results);
    const observed=health.connections?health.status:'no_connections';
    const status=!health.connections?observed
      :['error','rate_limited'].includes(observed)?observed
      :freshness.staleConnections===health.connections?'scheduler_stale'
      :freshness.staleConnections?'degraded':observed;
    const failureCode=invalid?'EASYORDERS_API_KEY_INVALID':unreadable?'EASYORDERS_API_KEY_UNREADABLE'
      :failed.length?'EASYORDERS_SYNC_ERROR':observed==='rate_limited'?'EASYORDERS_RATE_LIMITED'
      :!health.connections?'EASYORDERS_NOT_CONNECTED'
      :freshness.staleConnections?'EASYORDERS_RECOVERY_STALE':null;
    const canonical={ok:true,status,connections:health.connections,healthyConnections:health.healthyConnections,catchingUpConnections:health.catchingUpConnections,waitingConnections:health.waitingConnections,errorConnections:health.errorConnections};
    // Only aggregate health is public: no IDs, configuration, errors or secrets.
    return json({...base,ok:true,status,canonical,runtimeDiagnostics:{
      failureCode,invalidApiKeyClients:invalid,unreadableKeyClients:unreadable,
      staleRecoveryConnections:freshness.staleConnections,
      neverRanRecoveryConnections:freshness.neverRanConnections,
      lastRecoveryRunAt:freshness.mostRecentRunAt,
      staleAfterMinutes:freshness.staleAfterMinutes
    }});
  }catch{
    return json({...base,ok:false,status:'unavailable',runtimeDiagnostics:{failureCode:'EASYORDERS_HEALTH_UNAVAILABLE'}},503);
  }
}
