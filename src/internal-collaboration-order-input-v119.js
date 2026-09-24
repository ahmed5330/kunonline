import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

export function normalizeCollaborationOrderToken(value){
  return clean(value,180).replace(/^#\s*/,'').trim();
}

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}

async function scopedContext({request,env,ctx,delegate,body={},write=false}){
  const me=await currentUser(request,env,ctx,delegate),url=new URL(request.url);
  const requestedClient=body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId||null;
  const clientId=resolveTenant(me,requestedClient);
  const requestedStore=clean(body.storeId||body.store_id||url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||'',180)||null;
  const scope=await resolveStoreScope(env,me,clientId,requestedStore,{write});
  if(!scope.storeId)throw Object.assign(new Error('اختار فرعًا/متجرًا من أعلى قبل ربط الأوردر'),{status:400,code:'COLLAB_STORE_REQUIRED'});
  return {me,clientId:String(clientId),storeId:String(scope.storeId)};
}

export async function resolveCollaborationOrder(env,{clientId,storeId,token}){
  const key=normalizeCollaborationOrderToken(token);
  if(!key)return null;
  const row=await env.DB.prepare(`
    SELECT id,ref,awb,name,phone,total,state,store_id,date,created_at
    FROM orders
    WHERE client_id=? AND store_id=? AND (id=? OR ref=? OR awb=?)
    ORDER BY CASE WHEN id=? THEN 0 WHEN ref=? THEN 1 ELSE 2 END
    LIMIT 1
  `).bind(clientId,storeId,key,key,key,key,key).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود داخل الفرع الحالي. اكتب رقم الأوردر أو كود Easy Orders أو رقم البوليصة AWB.'),{status:404,code:'COLLAB_ORDER_NOT_FOUND'});
  return {id:String(row.id),ref:clean(row.ref,180),awb:clean(row.awb,180),name:clean(row.name,200),phone:clean(row.phone,80),total:Number(row.total||0),state:clean(row.state,80),storeId:String(row.store_id||storeId)};
}

async function searchOrders({request,env,ctx,delegate}){
  const {clientId,storeId}=await scopedContext({request,env,ctx,delegate,write:false});
  const url=new URL(request.url),q=normalizeCollaborationOrderToken(url.searchParams.get('q')||'');
  const limit=Math.max(1,Math.min(20,Number(url.searchParams.get('limit'))||12));
  let query=`SELECT id,ref,awb,name,phone,total,state,store_id,date,created_at FROM orders WHERE client_id=? AND store_id=?`;
  const binds=[clientId,storeId];
  if(q){
    const like=`%${q}%`;
    query+=` AND (id LIKE ? OR COALESCE(ref,'') LIKE ? OR COALESCE(awb,'') LIKE ? OR COALESCE(phone,'') LIKE ? OR COALESCE(name,'') LIKE ?)`;
    binds.push(like,like,like,like,like);
  }
  query+=` ORDER BY COALESCE(created_at,date,'') DESC LIMIT ?`;
  binds.push(limit);
  const {results=[]}=await env.DB.prepare(query).bind(...binds).all();
  return json({ok:true,orders:results.map(row=>({id:String(row.id),ref:clean(row.ref,180),awb:clean(row.awb,180),name:clean(row.name,200),phone:clean(row.phone,80),total:Number(row.total||0),state:clean(row.state,80),storeId:String(row.store_id||storeId)}))});
}

function requestWithJsonBody(request,body){
  const headers=new Headers(request.headers);headers.set('Content-Type','application/json; charset=utf-8');headers.delete('content-length');
  return new Request(request,{headers,body:JSON.stringify(body)});
}

export async function handleCollaborationOrderInputV119({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  if(!path.startsWith('/api/collaboration/'))return {request};
  try{
    if(method==='GET'&&path==='/api/collaboration/orders/search')return {response:await searchOrders({request,env,ctx,delegate})};

    const assignment=method==='GET'?path.match(/^\/api\/collaboration\/orders\/([^/]+)\/assignment$/):null;
    if(assignment){
      const token=decodeURIComponent(assignment[1]);
      const {clientId,storeId}=await scopedContext({request,env,ctx,delegate,write:false});
      const order=await resolveCollaborationOrder(env,{clientId,storeId,token});
      const next=new URL(request.url);next.pathname=`/api/collaboration/orders/${encodeURIComponent(order.id)}/assignment`;
      return {request:new Request(next,request)};
    }

    if(!['POST','PATCH'].includes(method))return {request};
    const body=await request.clone().json().catch(()=>null);
    if(!body||typeof body!=='object'||!normalizeCollaborationOrderToken(body.orderId))return {request};
    const {clientId,storeId}=await scopedContext({request,env,ctx,delegate,body,write:true});
    const order=await resolveCollaborationOrder(env,{clientId,storeId,token:body.orderId});
    body.orderId=order.id;
    return {request:requestWithJsonBody(request,body),order};
  }catch(error){
    return {response:json({ok:false,error:error?.message||'تعذر ربط الأوردر',code:error?.code||'COLLAB_ORDER_RESOLVE_FAILED'},Number(error?.status)||500)};
  }
}
