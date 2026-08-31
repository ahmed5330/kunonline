const BUILD='preview-sync-v2-2026-08-31-minute-meta';
const ALLOWED_CRONS=new Set(['* * * * *','*/5 * * * *','0 */2 * * *']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Sync-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});

async function invokeAppSync(env,cron){
  if(!ALLOWED_CRONS.has(cron))throw Object.assign(new Error(`Unexpected sync cron: ${cron||'(empty)'}`),{code:'SYNC_CRON_NOT_ALLOWED'});
  if(!env.APP_SYNC||typeof env.APP_SYNC.runCron!=='function')throw Object.assign(new Error('APP_SYNC RPC binding is unavailable'),{code:'SYNC_RPC_BINDING_MISSING'});
  return env.APP_SYNC.runCron(cron);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/healthz'){
      try{
        const upstream=await env.APP_SYNC.health();
        return json({ok:true,service:'kunonline-sync-preview',build:BUILD,upstream});
      }catch(error){return json({ok:false,service:'kunonline-sync-preview',build:BUILD,error:error?.message||String(error),code:error?.code||'SYNC_UPSTREAM_UNAVAILABLE'},503);}
    }
    return json({error:'Not found',code:'SYNC_WORKER_NOT_PUBLIC'},404);
  },
  scheduled(controller,env,ctx){
    const cron=String(controller?.cron||'');
    const task=invokeAppSync(env,cron);
    ctx?.waitUntil?.(task);
    return task;
  }
};
