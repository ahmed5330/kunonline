const BUILD='preview-sync-v2.4-2026-10-26-easyorders-cron-observable';
const ALLOWED_CRONS=new Set(['*/15 * * * *','*/5 * * * *','0 */2 * * *']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Sync-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});

async function invokeAppSync(env,cron,scheduledTime){
  if(!ALLOWED_CRONS.has(cron))throw Object.assign(new Error(`Unexpected sync cron: ${cron||'(empty)'}`),{code:'SYNC_CRON_NOT_ALLOWED'});
  if(!env.APP_SYNC||typeof env.APP_SYNC.runCron!=='function')throw Object.assign(new Error('APP_SYNC RPC binding is unavailable'),{code:'SYNC_RPC_BINDING_MISSING'});
  const rpcCron=cron==='*/15 * * * *'?'* * * * *':cron;
  return env.APP_SYNC.runCron(rpcCron,scheduledTime);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/healthz'){
      try{
        const upstream=await env.APP_SYNC.health();
        return json({ok:true,service:'kunonline-sync-preview',build:BUILD,policy:{minuteMeta:'native-every-15-minutes',easyOrdersRecovery:'every-5-minutes',deepSync:'every-2-hours'},upstream});
      }catch(error){return json({ok:false,service:'kunonline-sync-preview',build:BUILD,error:error?.message||String(error),code:error?.code||'SYNC_UPSTREAM_UNAVAILABLE'},503);}
    }
    return json({error:'Not found',code:'SYNC_WORKER_NOT_PUBLIC'},404);
  },
  scheduled(controller,env,ctx){
    const cron=String(controller?.cron||''),scheduledTime=controller?.scheduledTime||Date.now();
    // This log is emitted only for a REAL Cloudflare scheduled event, not for
    // a public /healthz probe. It contains no tenant, order or credential data.
    const kind=cron==='*/5 * * * *'?'EASYORDERS':cron==='*/15 * * * *'?'META':'GRANULAR';
    console.info('KUN_SYNC_CRON_STARTED',BUILD,kind);
    const task=Promise.resolve().then(()=>invokeAppSync(env,cron,scheduledTime)).then(
      result=>{
        console.info('KUN_SYNC_CRON_COMPLETED',BUILD,kind);
        return result;
      },
      error=>{
        // Never log error.message/stack: downstream provider errors can
        // contain keys, URLs, customer data or third-party response bodies.
        const safeCode=typeof error?.code==='string'&&
          /^(?:SYNC_|EASYORDERS_CRON_)[A-Z0-9_]{1,64}$/.test(error.code)
          ?error.code:'SYNC_TASK_FAILED';
        console.error('KUN_SYNC_CRON_FAILED',BUILD,kind,safeCode);
        throw error;
      }
    );
    ctx?.waitUntil?.(task);
    return task;
  }
};