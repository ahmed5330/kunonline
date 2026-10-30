import {listAccessibleClients} from './team-management.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie'}
});

// Production's staff context must use the SAME D1 store grants as the mobile
// picker. Never guess other client memberships from /api/me.clientId.
export async function handleProductionClientContext({request,env,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/my-client-context'||request.method!=='GET')return null;
  try{
    const identityUrl=new URL(request.url);
    identityUrl.pathname='/api/me';identityUrl.search='';
    const identity=await delegate.fetch(new Request(identityUrl,{method:'GET',headers:request.headers}));
    const me=await identity.json().catch(()=>({}));
    if(!identity.ok||!me?.role)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
    const data=await listAccessibleClients(env,me);
    return json(data);
  }catch{
    // Never fall back to an unscoped list when the canonical ACL cannot be read.
    return json({error:'تعذر التحقق من صلاحيات المتاجر',code:'CLIENT_CONTEXT_UNAVAILABLE'},503);
  }
}
