/* One authenticated discovery call for all of a user's active store assignments.
 * Replaces Android's /api/me -> /api/my-client-context -> N x /api/my-store-context
 * round trips. The Preview identity and client context remain the authority;
 * only ACL-allowed stores are exposed.
 */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
const clean=v=>String(v??'').trim();
const clientIdOf=v=>[v?.clientId,v?.client_id,v?.id].map(clean).find(x=>x&&x!=='null')||'';
const unauthorized=(message,code,status)=>json({ok:false,error:message,code},status);

async function trustedJson(request,delegate,path){
  const u=new URL(request.url);u.pathname=path;u.search='';
  const response=await delegate.fetch(new Request(u,{method:'GET',headers:request.headers}));
  const data=await response.clone().json().catch(()=>({}));
  return {response,data};
}

export async function handleMobileStoreOptions({request,env,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/mobile/store-options'||request.method!=='GET')return null;
  try{
    const identity=await trustedJson(request,delegate,'/api/me');
    if(!identity.response.ok||!identity.data?.role)return unauthorized('محتاج تسجّل دخول','AUTH_REQUIRED',401);
    const me=identity.data;
    const context=await trustedJson(request,delegate,'/api/my-client-context');
    if(!context.response.ok)return unauthorized('تعذر تحميل الحسابات المسموح بها','CLIENT_CONTEXT_UNAVAILABLE',context.response.status===401?401:503);

    // Clients must originate from this authenticated per-user context. Never
    // accept user-provided client IDs, role overrides or store IDs.
    const scopedClient=clean(me.clientId||me.client_id);
    const allowed=new Map();
    for(const client of (Array.isArray(context.data?.clients)?context.data.clients:[])){
      const id=clientIdOf(client);
      if(!id||(scopedClient&&id!==scopedClient))continue;
      allowed.set(id,clean(client?.name||client?.clientName)||id);
    }
    if(scopedClient&&!allowed.has(scopedClient)){
      return unauthorized('لا توجد صلاحية على الحساب','TENANT_ISOLATION',403);
    }
    if(!allowed.size)return json({ok:true,stores:[],clients:0});

    const role=clean(me.role);
    const isOwner=role==='admin'||role==='client';
    const uid=clean(me.uid||me.id);
    if(!isOwner&&!uid)return unauthorized('تعذر تحديد هوية الموظف','USER_ID_REQUIRED',403);
    // One scoped indexed D1 query instead of many serial HTTP requests.
    const statement=isOwner
      ?env.DB.prepare("SELECT s.id store_id,s.client_id,s.name,s.is_default,'owner' role FROM stores s WHERE s.status='active' ORDER BY s.client_id,s.is_default DESC,s.name")
      :env.DB.prepare("SELECT s.id store_id,s.client_id,s.name,s.is_default,a.role role FROM user_store_access a JOIN stores s ON s.id=a.store_id AND s.client_id=a.client_id WHERE a.user_id=? AND s.status='active' ORDER BY s.client_id,s.is_default DESC,s.name").bind(uid);
    const {results=[]}=await statement.all();
    const seen=new Set(),stores=[];
    for(const item of results){
      const clientId=clean(item.client_id),storeId=clean(item.store_id);
      const key=clientId+':'+storeId;
      if(!allowed.has(clientId)||!storeId||seen.has(key))continue;
      seen.add(key);
      stores.push({clientId,clientName:allowed.get(clientId),storeId,storeName:clean(item.name)||'متجر بدون اسم',role:clean(item.role)||'member'});
    }
    return json({ok:true,stores,clients:allowed.size});
  }catch(e){
    return unauthorized('تعذر تحميل المتاجر المتاحة','MOBILE_STORES_LOAD_FAILED',503);
  }
}
