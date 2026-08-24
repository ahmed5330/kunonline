import commerceV9 from './index-commerce-v9.js';
import {requirePermission} from './access-control.js';
import {processExecutionJobs} from './execution-runner.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
async function meFromBase(request,env,ctx){const u=new URL(request.url);u.pathname='/api/me';u.search='';const r=await commerceV9.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);const me=await r.json().catch(()=>({}));if(!r.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});return me;}
async function fetchV10(request,env,ctx){const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();try{if(path==='/api/execution-jobs/run'&&method==='POST'){const me=await meFromBase(request,env,ctx);requirePermission(me,'automation','approve');const outcomes=await processExecutionJobs(env,{limit:20});return json({ok:true,processed:outcomes.length,outcomes});}return commerceV9.fetch(request,env,ctx);}catch(e){return json({error:e.message||'حدث خطأ',code:e.code||null},e.status||500);}}
export default {
  fetch:fetchV10,
  async scheduled(controller,env,ctx){
    if(controller?.cron==='*/5 * * * *'){
      ctx.waitUntil(processExecutionJobs(env,{limit:20}).catch(()=>[]));
      return;
    }
    ctx.waitUntil(processExecutionJobs(env,{limit:20}).catch(()=>[]));
    return commerceV9.scheduled?.(controller,env,ctx);
  }
};
