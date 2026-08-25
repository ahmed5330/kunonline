import commerceV25 from './index-commerce-v25.js';
import commerceV3 from './index-commerce-v3.js';

const BUILD='preview-v26-2026-08-24';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD}});
function hardenApi(response){
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store');headers.set('X-Kun-Build',BUILD);headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('Cross-Origin-Resource-Policy','same-origin');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function fetchV26(request,env,ctx){
  const u=new URL(request.url);
  try{
    if(u.pathname==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v26.js'});
    // Keep the operational COD routes at the active entrypoint. This avoids a
    // legacy fallback swallowing them before the v3 commerce router sees them.
    if(u.pathname.startsWith('/api/cod-reconciliation'))return hardenApi(await commerceV3.fetch(request,env,ctx));
    const response=await commerceV25.fetch(request,env,ctx);
    if(env.APP_ENV!=='preview'||response.status!==404)return response;
    const body=await response.clone().json().catch(()=>null);
    if(body?.error&&String(body.error).includes('مسار غير معروف')){
      return json({error:`مسار غير معروف: ${u.pathname}`,code:'UNKNOWN_ROUTE',path:u.pathname,method:request.method,build:BUILD},404);
    }
    return response;
  }catch(error){
    if(env.APP_ENV!=='preview')throw error;
    return json({error:error?.message||'Unhandled Preview error',code:'UNHANDLED_PREVIEW_ERROR',path:u.pathname,method:request.method,build:BUILD},500);
  }
}

export default {fetch:fetchV26,scheduled(controller,env,ctx){return commerceV25.scheduled?.(controller,env,ctx);}};
