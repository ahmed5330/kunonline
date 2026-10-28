import {requirePermission} from './access-control.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie'}
});
const str=(v,max=120)=>String(v??'').trim().slice(0,max);

export function mobileOrderSearchParams(url){
  const q=str(url.searchParams.get('q'),100);
  const limit=Math.max(1,Math.min(40,Number.parseInt(url.searchParams.get('limit')||'25',10)||25));
  const offset=Math.max(0,Math.min(1000,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));
  return {q,limit,offset};
}

/**
 * Search the complete order history on D1, never the date-filtered Android snapshot.
 * All authorisation is server-side, for the current signed-in user on every request.
 * Staff members without a tenant ID see ONLY explicitly assigned active stores.
 * Pagination keeps the Android response small even for high-volume tenants.
 */
export async function handleMobileOrderSearch({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/mobile/orders/search')return null;
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  try{
    const identityUrl=new URL(request.url);
    identityUrl.pathname='/api/me';identityUrl.search='';
    const identity=await delegate.fetch(new Request(identityUrl,{method:'GET',headers:request.headers}),env,ctx);
    const me=await identity.json().catch(()=>({}));
    if(!identity.ok||!me?.role)return json({error:'محتاج تسجّل دخول'},401);
    requirePermission(me,'orders','read');
    if(me.role==='client'&&!me.clientId)
      return json({error:'الحساب غير مربوط بمتجر'},403);

    const {q,limit,offset}=mobileOrderSearchParams(url);
    if(q.length<2)return json({ok:true,query:q,orders:[],hasMore:false,nextOffset:null});
    const clientId=str(url.searchParams.get('clientId'),80);
    const storeId=str(url.searchParams.get('storeId'),80);
    if((me.role==='client'||me.role==='admin')&&me.clientId&&clientId&&String(me.clientId)!==clientId)
      return json({error:'مش مسموح الوصول لبيانات متجر آخر'},403);

    // Bound parameters prevent SQL injection. '%' and '_' are interpreted
    // literally, not as wildcards from user input.
    const term=q.replace(/[%_]/g,'').trim();
    if(term.length<2)return json({ok:true,query:q,orders:[],hasMore:false,nextOffset:null});
    const like='%'+term+'%';
    const where=["(o.id LIKE ? OR COALESCE(o.ref,'') LIKE ? OR COALESCE(o.awb,'') LIKE ? OR COALESCE(o.phone,'') LIKE ? OR COALESCE(o.name,'') LIKE ?)"];
    const binds=[like,like,like,like,like];
    // Staff search every explicitly granted active store, not just their legacy default clientId.
    const tenant=(me.role==='admin'||me.role==='client')?(me.clientId?String(me.clientId):clientId):clientId;
    if(tenant){where.push('o.client_id=?');binds.push(tenant);}
    if(storeId){where.push('o.store_id=?');binds.push(storeId);}
    if(me.role!=='admin'&&me.role!=='client'){
      if(!me.uid)return json({error:'مش مسموح'},403);
      where.push(`EXISTS (SELECT 1 FROM user_store_access a JOIN stores st ON st.id=a.store_id AND st.client_id=a.client_id WHERE a.user_id=? AND a.client_id=o.client_id AND a.store_id=o.store_id AND st.status='active')`);
      binds.push(String(me.uid));
    }
    const result=await env.DB.prepare(`
      SELECT o.id,o.ref,o.client_id AS clientId,o.store_id AS storeId,
        COALESCE(s.name,'') AS storeName,o.name,o.phone,o.state,o.total,
        o.date,o.created_at AS createdAt,o.awb,o.gov,o.product
      FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE WHEN o.id=? OR o.ref=? OR o.awb=? OR o.phone=? THEN 0
                    WHEN o.id LIKE ? OR o.ref LIKE ? THEN 1 ELSE 2 END,
               o.created_at DESC,o.id DESC
      LIMIT ? OFFSET ?
    `).bind(...binds,term,term,term,term,term+'%',term+'%',limit+1,offset).all();
    const rows=result.results||[];
    const hasMore=rows.length>limit;
    return json({ok:true,query:q,orders:rows.slice(0,limit),hasMore,nextOffset:hasMore?offset+limit:null});
  }catch(error){
    const status=Number(error?.status)||500;
    return json({error:status>=500?'تعذر البحث عن الطلبات':error.message||'مش مسموح'},status);
  }
}
