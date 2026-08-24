import commerceV25 from './index-commerce-v25.js';

const BUILD='preview-v26-2026-08-24';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD}});

async function fetchV26(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v26.js'});
  const response=await commerceV25.fetch(request,env,ctx);
  if(env.APP_ENV!=='preview'||response.status!==404)return response;
  const body=await response.clone().json().catch(()=>null);
  if(body?.error&&String(body.error).includes('مسار غير معروف')){
    return json({error:`مسار غير معروف: ${u.pathname}`,code:'UNKNOWN_ROUTE',path:u.pathname,method:request.method,build:BUILD},404);
  }
  return response;
}

export default {fetch:fetchV26,scheduled(controller,env,ctx){return commerceV25.scheduled?.(controller,env,ctx);}};
