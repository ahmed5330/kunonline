const BUILD='preview-sync-v2.2-2026-09-06-free-tier-gate';
const ALLOWED_CRONS=new Set(['* * * * *','*/5 * * * *','0 */2 * * *']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Sync-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});

function minuteOf(scheduledTime){const d=new Date(Number(scheduledTime)||Date.now());return d.getUTCMinutes();}
function shouldInvoke(cron,scheduledTime){
  if(cron==='* * * * *')return minuteOf(scheduledTime)%15===0;
  return true;
}
async function invokeAppSync(env,cron,scheduledTime){
  if(!ALLOWED_CRONS.has(cron))throw Object.assign(new Error(`Unexpected sync cron: ${cron||'(empty)'}`),{code:'SYNC_CRON_NOT_ALLOWED'});
  if(!shouldInvoke(cron,scheduledTime))return {ok:true,skipped:true,reason:'free-tier-minute-gate',cron};
  if(!env.APP_SYNC||typeof env.APP_SYNC.runCron!=='function')throw Object.assign(new Error('APP_SYNC RPC binding is unavailable'),{code:'SYNC_RPC_BINDING_MISSING'});
  return env.APP_SYNC.runCron(cron,scheduledTime);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/healthz'){
      try{
        const upstream=await env.APP_SYNC.health();
        return json({ok:true,service:'kunonline-sync-preview',build:BUILD,policy:{minuteMeta:'every-15-minutes',easyOrdersRecovery:'every-5-minutes',deepSync:'every-2-hours'},upstream});
      }catch(error){return json({ok:false,service:'kunonline-sync-preview',build:BUILD,error:error?.message||String(error),code:error?.code||'SYNC_UPSTREAM_UNAVAILABLE'},503);}
    }
    return json({error:'Not found',code:'SYNC_WORKER_NOT_PUBLIC'},404);
  },
  scheduled(controller,env,ctx){
    const cron=String(controller?.cron||''),scheduledTime=controller?.scheduledTime||Date.now();
    const task=invokeAppSync(env,cron,scheduledTime);
    ctx?.waitUntil?.(task);
    return task;
  }
};