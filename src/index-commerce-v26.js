import commerceV25 from './index-commerce-v25.js';
import commerceV3 from './index-commerce-v3.js';
import commerceV10 from './index-commerce-v10.js';
import {isStoreScopedPath,listMyStores,scopeRequest as enforceStoreScope} from './store-scope.js';

const BUILD='preview-v26-2026-08-24';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD}});
function hardenApi(response){
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store');headers.set('X-Kun-Build',BUILD);headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('Cross-Origin-Resource-Policy','same-origin');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function currentUser(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceV25.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d?.role)throw Object.assign(new Error(d?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});
  return d;
}

async function tenantFromRequest(request,me){
  const u=new URL(request.url);
  if(me.clientId)return me.clientId;
  if(['POST','PUT','PATCH','DELETE'].includes(request.method.toUpperCase())){
    const b=await request.clone().json().catch(()=>({}));
    if(b.clientId||b.client_id)return b.clientId||b.client_id;
  }
  return u.searchParams.get('clientId');
}

async function fetchV26(request,env,ctx){
  const u=new URL(request.url);
  try{
    if(u.pathname==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v26.js'});
    if(u.pathname==='/api/my-store-context'&&request.method.toUpperCase()==='GET'){
      const me=await currentUser(request,env,ctx),clientId=await tenantFromRequest(request,me);
      if(!clientId)return json({error:'محتاج clientId',code:'CLIENT_ID_REQUIRED'},400);
      return hardenApi(json({clientId,...await listMyStores(env,me,clientId)}));
    }
    let scopedRequest=request;
    if(isStoreScopedPath(u.pathname)){
      const me=await currentUser(request,env,ctx),clientId=await tenantFromRequest(request,me);
      if(clientId)scopedRequest=(await enforceStoreScope(request,env,me,clientId)).request;
      else if(me.role!=='admin')return json({error:'محتاج clientId',code:'CLIENT_ID_REQUIRED'},400);
    }
    // Keep the operational COD routes at the active entrypoint. This avoids a
    // legacy fallback swallowing them before the v3 commerce router sees them.
    if(u.pathname.startsWith('/api/cod-reconciliation'))return hardenApi(await commerceV3.fetch(scopedRequest,env,ctx));
    // Governance and execution routes must not be swallowed by the legacy
    // fallback chain. V10 owns the runner and delegates the remaining routes
    // to the approval/operations layers below it.
    if(['/api/approvals','/api/execution-jobs','/api/notifications','/api/system-status'].some(path=>u.pathname===path||u.pathname.startsWith(path+'/')))return hardenApi(await commerceV10.fetch(scopedRequest,env,ctx));
    const response=await commerceV25.fetch(scopedRequest,env,ctx);
    if(env.APP_ENV!=='preview'||response.status!==404)return response;
    const body=await response.clone().json().catch(()=>null);
    if(body?.error&&String(body.error).includes('مسار غير معروف')){
      return json({error:`مسار غير معروف: ${u.pathname}`,code:'UNKNOWN_ROUTE',path:u.pathname,method:request.method,build:BUILD},404);
    }
    return response;
  }catch(error){
    if(env.APP_ENV!=='preview')throw error;
    return json({error:error?.message||'Unhandled Preview error',code:error?.code||'UNHANDLED_PREVIEW_ERROR',path:u.pathname,method:request.method,build:BUILD},error?.status||500);
  }
}

export default {fetch:fetchV26,scheduled(controller,env,ctx){return commerceV25.scheduled?.(controller,env,ctx);}};
