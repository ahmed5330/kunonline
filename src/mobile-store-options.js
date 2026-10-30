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
    // The independently authenticated store ACL remains authoritative for
    // unbound staff when the legacy context endpoint is temporarily unavailable.
    // Owners must not bypass the context check; staff grants are verified from the live store ACL.
    const role=clean(me.role),isOwner=role==='admin'||role==='client';
    const scopedClient=clean(me.clientId||me.client_id);
    if(!context.response.ok&&(isOwner||context.response.status===401))
      return unauthorized('تعذر تحميل الحسابات المسموح بها','CLIENT_CONTEXT_UNAVAILABLE',context.response.status===401?401:503);

    // Clients must originate from this authenticated per-user context. Never
    // accept user-provided client IDs, role overrides or store IDs.
    const allowed=new Map();
    for(const client of (Array.isArray(context.data?.clients)?context.data.clients:[])){
      const id=clientIdOf(client);
      if(!id||(isOwner&&scopedClient&&id!==scopedClient))continue;
      allowed.set(id,clean(client?.name||client?.clientName)||id);
    }
    if(isOwner&&scopedClient&&!allowed.has(scopedClient)){
      return unauthorized('لا توجد صلاحية على الحساب','TENANT_ISOLATION',403);
    }
    // A staff member can have explicit store grants in other client
    // accounts even if the legacy client-context list is incomplete. The
    // user_store_access JOIN below is the authority for those grants. Owners
    // must still be strictly limited by their authenticated client context.
    if(!allowed.size&&isOwner)return json({ok:true,stores:[],clients:0,defaultClientId:scopedClient,role});
    const uid=clean(me.uid||me.id);
    if(!isOwner&&!uid)return unauthorized('تعذر تحديد هوية الموظف','USER_ID_REQUIRED',403);
    // One scoped indexed D1 query instead of many serial HTTP requests.
    const results=[];
    if(isOwner){
      // Bound IDs prevent a global admin query from scanning unrelated stores.
      // Chunk to remain below SQLite bind-variable limits for large estates.
      const ids=[...allowed.keys()];
      for(let i=0;i<ids.length;i+=100){
        const batch=ids.slice(i,i+100);
        const marks=batch.map(()=>'?').join(',');
        const query="SELECT s.id store_id,s.client_id,s.name,s.is_default,'owner' role FROM stores s WHERE s.status='active' AND s.client_id IN ("+marks+") ORDER BY s.client_id,s.is_default DESC,s.name";
        const page=await env.DB.prepare(query).bind(...batch).all();
        results.push(...(page.results||[]));
      }
    }else{
      const page=await env.DB.prepare("SELECT s.id store_id,s.client_id,s.name,s.is_default,a.role role FROM user_store_access a JOIN stores s ON s.id=a.store_id AND s.client_id=a.client_id WHERE a.user_id=? AND s.status='active' ORDER BY s.client_id,s.is_default DESC,s.name").bind(uid).all();
      results.push(...(page.results||[]));
    }
    const seen=new Set(),stores=[];
    for(const item of results){
      const clientId=clean(item.client_id),storeId=clean(item.store_id);
      const key=clientId+':'+storeId;
      if(!storeId||seen.has(key))continue;
      if(isOwner&&!allowed.has(clientId))continue;
      seen.add(key);
      stores.push({clientId,clientName:allowed.get(clientId)||clientId,storeId,storeName:clean(item.name)||'متجر بدون اسم',role:clean(item.role)||'member'});
    }
    // Optional self-only support diagnostics. No user identifier or unrelated
    // tenant records leave this endpoint. Never turn a missing grant into access.
    let diagnostics;
    if(url.searchParams.get('diagnostics')==='1'&&!isOwner){
      try{
        const audit=await env.DB.prepare(`SELECT COUNT(*) total_grants,
          SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END) active_grants,
          SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) missing_stores,
          SUM(CASE WHEN s.id IS NOT NULL AND s.status<>'active' THEN 1 ELSE 0 END) inactive_grants
          FROM user_store_access a LEFT JOIN stores s ON s.id=a.store_id AND s.client_id=a.client_id
          WHERE a.user_id=?`).bind(uid).first();
        diagnostics={available:true,source:'live-user-store-access',
          totalGrants:Number(audit?.total_grants)||0,
          activeGrants:Number(audit?.active_grants)||0,
          inactiveGrants:Number(audit?.inactive_grants)||0,
          missingStores:Number(audit?.missing_stores)||0,
          visibleStores:stores.length};
      }catch{
        diagnostics={available:false,source:'live-user-store-access'};
      }
    }
    return json({ok:true,stores,clients:new Set(stores.map(x=>x.clientId)).size,defaultClientId:(isOwner&&scopedClient)||stores.find(x=>x.clientId===scopedClient)?.clientId||stores[0]?.clientId||[...allowed.keys()][0]||'',role,
      ...(diagnostics?{diagnostics}:{})});
  }catch(e){
    return unauthorized('تعذر تحميل المتاجر المتاحة','MOBILE_STORES_LOAD_FAILED',503);
  }
}
