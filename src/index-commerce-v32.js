import commerceV31 from './index-commerce-v31.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {loadOrderDetails} from './order-details.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV31.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});
  return me;
}

async function fetchV32(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    /* Keep the deployed-build verification contract authoritative in v31 while
       routing Preview through this additive order-details wrapper. */
    if(path==='/api/preview/version'&&method==='GET')return commerceV31.fetch(request,env,ctx);

    const match=path.match(/^\/api\/orders\/([^/]+)\/details$/);
    if(match&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','read');
      const clientId=resolveTenant(me,url.searchParams.get('clientId')),orderId=decodeURIComponent(match[1]);
      const scopeRow=await env.DB.prepare('SELECT store_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
      if(!scopeRow)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
      await resolveStoreScope(env,me,clientId,scopeRow.store_id||null,{write:false});
      return json(await loadOrderDetails(env,{clientId,orderId}));
    }
    return commerceV31.fetch(request,env,ctx);
  }catch(error){
    return json({error:error?.message||'حدث خطأ',code:error?.code||'ORDER_DETAILS_ERROR',path,method},error?.status||500);
  }
}

export default {
  fetch:fetchV32,
  scheduled(controller,env,ctx){return commerceV31.scheduled?.(controller,env,ctx);}
};
