import {easyOrdersRecoveryStatus} from './easyorders-order-reconciliation.js';
import {assessEasyOrdersRecoveryFreshness} from './production-easyorders-health.js';

const ROUTE='/api/integrations/easyorders/dashboard-health';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

// Unlike the public, global /health/easyorders-sync endpoint, this route is
// always bound to the authenticated owner's tenant. It never accepts clientId
// from the query string or a user-controllable header.
export async function handleTenantEasyOrdersHealth(request,env,{authorize}={}){
  const url=new URL(request.url);
  if(url.pathname!==ROUTE)return null;
  if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(typeof authorize!=='function')return json({error:'AUTH_REQUIRED'},401);
  let me=null;
  try{me=await authorize(request);}catch{return json({error:'AUTH_REQUIRED'},401);}
  if(!me?.role)return json({error:'AUTH_REQUIRED'},401);
  // Owners alone receive their client-wide summary. Do not assume staff may
  // view arbitrary stores simply because they have the same tenant ID.
  if(me.role!=='client'||!me.clientId)return json({error:'ACCESS_DENIED'},403);
  if(!env?.DB)return json({error:'HEALTH_UNAVAILABLE'},503);

  const clientId=String(me.clientId);
  const requestedStore=url.searchParams.get('storeId')||'';
  if(requestedStore.length>128)return json({error:'STORE_SCOPE_INVALID'},403);
  try{
    if(requestedStore){
      const store=await env.DB.prepare('SELECT id FROM stores WHERE id=? AND client_id=? LIMIT 1')
        .bind(requestedStore,clientId).first();
      if(!store)return json({error:'STORE_SCOPE_INVALID'},403);
    }
    const health=await easyOrdersRecoveryStatus(env,{clientId,storeId:requestedStore||null});
    const failed=(health.results||[]).filter(row=>row.status==='error');
    const invalid=failed.some(row=>/api-key\s+not\s+valid|invalid\s+api.?key|HTTP\s+(401|403)/i.test(row.lastError||''));
    const unreadable=failed.some(row=>/cannot be decrypted|decrypt|missing.*key|key.*missing/i.test(row.lastError||''));
    // A five-minute cron can stop while an old saved result still says
    // "healthy". Only the authenticated user's scoped connections may affect
    // this warning: public platform totals are never tenant health.
    const freshness=assessEasyOrdersRecoveryFreshness(health.results||[]);
    const observed=health.connections?health.status:'no_connections';
    const status=!health.connections?observed
      :['error','rate_limited'].includes(observed)?observed
      :freshness.staleConnections===health.connections?'scheduler_stale'
      :freshness.staleConnections?'degraded':observed;
    const failureCode=invalid?'EASYORDERS_API_KEY_INVALID'
      :unreadable?'EASYORDERS_API_KEY_UNREADABLE'
      :failed.length?'EASYORDERS_SYNC_ERROR'
      :observed==='rate_limited'?'EASYORDERS_RATE_LIMITED'
      :!health.connections?'EASYORDERS_NOT_CONNECTED'
      :freshness.staleConnections?'EASYORDERS_RECOVERY_STALE':null;
    // Never return provider credentials, connection IDs, error text or data
    // from another tenant. Authentication happens before touching the DB.
    return json({ok:true,source:'tenant',scope:requestedStore?'store':'client',
      status,connections:health.connections,
      canonical:{errorConnections:health.errorConnections||0},
      runtimeDiagnostics:{
        failureCode,
        staleRecoveryConnections:freshness.staleConnections,
        neverRanRecoveryConnections:freshness.neverRanConnections,
        staleAfterMinutes:freshness.staleAfterMinutes
      }});
  }catch{
    return json({ok:false,error:'HEALTH_UNAVAILABLE'},503);
  }
}
