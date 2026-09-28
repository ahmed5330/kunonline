import {easyOrdersRecoveryStatus} from './easyorders-order-reconciliation.js';

const BUILD='preview-easyorders-health-v1';
function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Data-Source':'preview'}});
}

// Read the same canonical database used by PREVIEW_APP. Never decrypt Preview
// secrets with Production keys, run recovery, or fall back to legacy state here.
export async function handleProductionEasyOrdersHealth(request,env){
  if(request.method!=='GET'||new URL(request.url).pathname!=='/health/easyorders-sync')return null;
  if(!env.PREVIEW_DB&&!env.PREVIEW_APP)return null;
  const base={build:BUILD,mode:'preview-canonical',source:'preview',legacyFallback:{active:false}};
  if(!env.PREVIEW_DB||!env.PREVIEW_APP?.fetch)return json({...base,ok:false,status:'unavailable',runtimeDiagnostics:{failureCode:'EASYORDERS_HEALTH_UNAVAILABLE'}},503);
  try{
    const health=await easyOrdersRecoveryStatus({DB:env.PREVIEW_DB});
    const failed=health.results.filter(r=>r.status==='error');
    const invalid=failed.filter(r=>/api-key\s+not\s+valid|invalid\s+api.?key|HTTP\s+(401|403)/i.test(r.lastError||'')).length;
    const unreadable=failed.filter(r=>/cannot be decrypted|decrypt|missing.*key|key.*missing/i.test(r.lastError||'')).length;
    const status=health.connections?health.status:'no_connections';
    const failureCode=invalid?'EASYORDERS_API_KEY_INVALID':unreadable?'EASYORDERS_API_KEY_UNREADABLE':failed.length?'EASYORDERS_SYNC_ERROR':status==='rate_limited'?'EASYORDERS_RATE_LIMITED':!health.connections?'EASYORDERS_NOT_CONNECTED':null;
    const canonical={ok:true,status,connections:health.connections,healthyConnections:health.healthyConnections,catchingUpConnections:health.catchingUpConnections,waitingConnections:health.waitingConnections,errorConnections:health.errorConnections};
    // Only aggregate health is public: no IDs, configuration, errors or secrets.
    return json({...base,ok:true,status,canonical,runtimeDiagnostics:{failureCode,invalidApiKeyClients:invalid,unreadableKeyClients:unreadable}});
  }catch{
    return json({...base,ok:false,status:'unavailable',runtimeDiagnostics:{failureCode:'EASYORDERS_HEALTH_UNAVAILABLE'}},503);
  }
}
