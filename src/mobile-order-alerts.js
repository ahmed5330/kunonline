import {handleMobileStoreOptions} from './mobile-store-options.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie, Authorization'}});
const clean=value=>String(value??'').trim();
const timestamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;

/**
 * Cursor-based, authenticated notification feed; no FCM credentials needed.
 * The assignments endpoint is the authorization authority for every request.
 * No caller-provided clientId or storeId is trusted.
 */
export async function handleMobileOrderAlerts({request,env,delegate,clock=()=>new Date()}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/mobile/order-alerts'||request.method!=='GET')return null;
  const allowedUrl=new URL(request.url);
  allowedUrl.pathname='/api/mobile/store-options';
  allowedUrl.search='';
  const authorization=await handleMobileStoreOptions({
    request:new Request(allowedUrl,{method:'GET',headers:request.headers}),
    env,delegate
  });
  if(!authorization)return json({ok:false,error:'تعذر التحقق من صلاحيات المتاجر'},503);
  if(!authorization.ok)return authorization;
  const assignments=(await authorization.json()).stores||[];
  const until=clock().toISOString();
  if(!url.searchParams.has('after')){
    return json({ok:true,orders:[],nextAfter:until,nextId:'',hasMore:false,initialized:true});
  }
  const after=clean(url.searchParams.get('after')),afterId=clean(url.searchParams.get('afterId'));
  if(!timestamp.test(after)||Number.isNaN(Date.parse(after))||after>until||afterId.length>128){
    return json({ok:false,error:'مؤشر الإشعارات غير صحيح',code:'INVALID_CURSOR'},400);
  }
  if(!assignments.length)return json({ok:true,orders:[],nextAfter:until,nextId:'',hasMore:false});
  const rows=[];
  // Chunk assignments to avoid SQLite variable limits; authorization per (client,store) pair.
  for(let i=0;i<assignments.length;i+=80){
    const chunk=assignments.slice(i,i+80);
    const where=chunk.map(()=>'(o.client_id=? AND o.store_id=?)').join(' OR ');
    const bindings=chunk.flatMap(s=>[s.clientId,s.storeId]);
    const query=`SELECT o.id,o.ref,o.store_id storeId,o.client_id clientId,o.created_at createdAt,
        o.name AS customerName,o.phone AS customerPhone,o.product AS productName,
        o.product_note AS productNote,o.qty AS quantity,o.total AS total,o.gov AS governorate
      FROM orders o WHERE (${where})
      AND (o.created_at > ? OR (o.created_at = ? AND o.id > ?))
      AND o.created_at <= ?
      ORDER BY o.created_at ASC,o.id ASC LIMIT 51`;
    const page=await env.DB.prepare(query).bind(...bindings,after,after,afterId,until).all();
    rows.push(...(page.results||[]));
  }
  rows.sort((a,b)=>clean(a.createdAt).localeCompare(clean(b.createdAt))||clean(a.id).localeCompare(clean(b.id)));
  const next=rows.slice(0,50),last=next.at(-1),hasMore=rows.length>50;
  const names=new Map(assignments.map(s=>[`${s.clientId}:${s.storeId}`,s.storeName]));
  return json({
    ok:true,
    orders:next.map(r=>({id:clean(r.id),ref:clean(r.ref),storeId:clean(r.storeId),clientId:clean(r.clientId),
      storeName:clean(names.get(`${r.clientId}:${r.storeId}`))||'متجر',createdAt:clean(r.createdAt),
      customerName:clean(r.customerName).slice(0,80),
      customerPhone:clean(r.customerPhone).slice(0,32),
      productName:clean(r.productName).slice(0,110),
      productNote:clean(r.productNote).slice(0,100),
      quantity:Math.max(1,Math.min(9999,Number(r.quantity)||1)),
      total:Number(r.total)||0,
      governorate:clean(r.governorate).slice(0,70)})),
    nextAfter:last?clean(last.createdAt):until,
    nextId:last?clean(last.id):'',
    hasMore
  });
}
