import {requirePermission,resolveTenant} from './access-control.js';
import {listMyStores} from './store-scope.js';

const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
const BOARD_STATES=['pending','no_answer','confirmed','preparing','shipped'];
const QUERY_STATES=[...BOARD_STATES,'deferred'];
const LABELS={
  pending:'في انتظار التأكيد',
  no_answer:'العميل لا يرد',
  confirmed:'تم التأكيد',
  preparing:'التجهيز والتغليف',
  shipped:'جاري الشحن',
  signed:'تم التسليم — تحصيل منتظر',
  collected:'تم التحصيل',
  returned:'مرتجع',
  cancelled:'تم إلغاء الطلب',
  deferred:'مؤجل'
};
const clean=value=>String(value??'').trim();
const parseArr=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const LATEST_NOTE_SELECT=`ln.id canonical_latest_note_id,ln.body canonical_latest_note,ln.created_at canonical_latest_note_at,ln.created_by canonical_latest_note_by`;
const LATEST_NOTE_JOIN=`LEFT JOIN order_notes ln ON ln.id=(SELECT n.id FROM order_notes n WHERE n.order_id=o.id AND n.client_id=o.client_id ORDER BY n.created_at DESC,n.id DESC LIMIT 1)`;

function cairoDate(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const get=type=>parts.find(item=>item.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function validYmd(value){
  const raw=clean(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';
  const date=new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===raw?raw:'';
}
async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  if(!response.ok)return {response};
  const me=await response.json().catch(()=>null);
  if(!me?.role)return {response:json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401)};
  if(!ALLOWED_ROLES.has(me.role))return {response:json({error:'قسم خدمة العملاء غير متاح لهذا الدور',code:'CUSTOMER_SERVICE_ROLE_DENIED'},403)};
  try{requirePermission(me,'orders','read');}catch(error){return {response:json({error:error?.message||'غير مسموح',code:error?.code||'PERMISSION_DENIED'},Number(error?.status)||403)};}
  return {me};
}
async function processDueDeferred(env,clientId,access){
  const today=cairoDate(),binds=[clientId,today];
  let where=`client_id=? AND state='deferred' AND defer_until IS NOT NULL AND defer_until<=?`;
  if(!access.allStores){
    if(!access.ids.length)return 0;
    where+=` AND store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);
  }
  const {results=[]}=await env.DB.prepare(`SELECT id,history,defer_until FROM orders WHERE ${where}`).bind(...binds).all();
  for(const row of results){
    const history=parseArr(row.history),stamp=new Date().toISOString();
    history.push({type:'defer_return',state:'pending',at:stamp,note:'رجع تلقائي من التأجيل',deferUntil:row.defer_until,by:'النظام',byName:'النظام',byUserId:null,system:true});
    await env.DB.prepare('UPDATE orders SET state=?,checkpoint=?,history=? WHERE id=? AND client_id=?').bind('pending',LABELS.pending,JSON.stringify(history),row.id,clientId).run();
  }
  return results.length;
}
function mapOrder(row,today){
  const history=parseArr(row.history),contactLog=parseArr(row.contact_log);
  const canonicalNote=clean(row.canonical_latest_note);
  if(canonicalNote&&!history.some(item=>(row.canonical_latest_note_id&&item?.noteId===row.canonical_latest_note_id)||(item?.type==='internal_note'&&clean(item.note)===canonicalNote&&String(item.at||'')===String(row.canonical_latest_note_at||'')))){
    const by=clean(row.canonical_latest_note_by)||'user';
    history.push({type:'internal_note',note:canonicalNote,at:row.canonical_latest_note_at||null,by,byName:by,byUserId:null,noteId:row.canonical_latest_note_id||null,canonical:true});
  }
  const notes=history.filter(item=>item?.type==='internal_note'&&clean(item.note));
  const returned=[...history].reverse().find(item=>item?.type==='defer_return'||item?.note==='رجع تلقائي من التأجيل');
  const returnedToday=Boolean(returned?.at&&cairoDate(new Date(returned.at))===today&&row.state==='pending');
  return {
    id:row.id,clientId:row.client_id,storeId:row.store_id||null,storeName:row.store_name||'بدون متجر محدد',storeCode:row.store_code||null,
    ref:row.ref||null,date:row.date||row.created_at||null,createdAt:row.created_at||null,name:row.name||'',phone:row.phone||'',gov:row.gov||'',address:row.address||'',
    product:row.product||'',productId:row.product_id||null,variantId:row.variant_id||null,productNote:row.product_note||'',qty:Number(row.qty||1),unitPrice:Number(row.unit_price||0),total:Number(row.total||0),
    source:row.source||'',customerNote:row.note||'',awb:row.awb||'',state:row.state||'pending',checkpoint:row.checkpoint||'',deferUntil:row.defer_until||null,
    stockBatchId:row.stock_batch_id||null,stockBatchName:row.stock_batch_name||null,stockAllocationStatus:row.stock_allocation_status||null,
    contactLog,contactCount:contactLog.length,history,internalNotes:notes,latestInternalNote:canonicalNote||notes.at(-1)?.note||'',returnedFromDeferredToday:returnedToday
  };
}

export async function handleCustomerServicePeriodV111({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/api/customer-service')return null;
  const rawFrom=clean(url.searchParams.get('periodFrom')),rawTo=clean(url.searchParams.get('periodTo'));
  if(!rawFrom&&!rawTo)return null;
  const from=validYmd(rawFrom),to=validYmd(rawTo);
  if(!from||!to)return json({error:'حدد بداية ونهاية الفترة بصيغة صحيحة',code:'CUSTOMER_SERVICE_DATE_RANGE_INVALID'},400);
  if(from>to)return json({error:'بداية الفترة يجب أن تكون قبل نهايتها',code:'CUSTOMER_SERVICE_DATE_RANGE_REVERSED'},400);

  try{
    const auth=await currentUser(request,env,ctx,delegate);if(auth.response)return auth.response;
    const me=auth.me,requested=url.searchParams.get('clientId')||me.clientId||null,clientId=resolveTenant(me,requested);
    const context=await listMyStores(env,me,clientId),stores=context.stores||[],access={allStores:Boolean(context.allStores),stores,ids:stores.map(item=>String(item.id))};
    if(!access.allStores&&!access.ids.length)return json({error:'لا توجد متاجر مخصصة لهذا المستخدم',code:'CUSTOMER_SERVICE_STORE_ACCESS_REQUIRED'},403);
    const selected=clean(url.searchParams.get('storeId'));
    if(selected&&!access.allStores&&!access.ids.includes(selected))return json({error:'المتجر غير مسموح لهذا المستخدم',code:'STORE_ISOLATION'},403);
    if(selected&&access.allStores&&!access.ids.includes(selected))return json({error:'المتجر غير موجود أو غير نشط',code:'STORE_NOT_FOUND'},404);

    const dueReturned=await processDueDeferred(env,clientId,access),binds=[clientId,...QUERY_STATES];
    let where=`o.client_id=? AND o.state IN (${QUERY_STATES.map(()=>'?').join(',')})`;
    if(selected){where+=' AND o.store_id=?';binds.push(selected);}
    else if(!access.allStores){where+=` AND o.store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);}
    const dateExpr=`COALESCE(NULLIF(substr(o.date,1,10),''),substr(o.created_at,1,10))`;
    where+=` AND ${dateExpr} BETWEEN ? AND ?`;binds.push(from,to);
    const {results=[]}=await env.DB.prepare(`SELECT o.*,s.name store_name,s.code store_code,osa.batch_id stock_batch_id,osa.status stock_allocation_status,ib.name stock_batch_name,${LATEST_NOTE_SELECT}
      FROM orders o
      LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id
      LEFT JOIN order_stock_allocations osa ON osa.order_id=o.id AND osa.client_id=o.client_id
      LEFT JOIN inventory_batches ib ON ib.id=osa.batch_id AND ib.client_id=o.client_id
      ${LATEST_NOTE_JOIN}
      WHERE ${where}
      ORDER BY ${dateExpr} DESC,o.created_at DESC`).bind(...binds).all();
    const today=cairoDate(),orders=results.map(row=>mapOrder(row,today));
    return json({ok:true,clientId,role:me.role,allStores:access.allStores,stores:stores.map(store=>({id:store.id,name:store.name,code:store.code||'',role:store.role||'owner'})),selectedStoreId:selected||null,dueReturned,today,periodFrom:from,periodTo:to,serverFiltered:true,stages:BOARD_STATES.map(id=>({id,label:LABELS[id]})),stateLabels:LABELS,orders});
  }catch(error){
    return json({error:error?.message||'تعذر تحميل خدمة العملاء',code:error?.code||'CUSTOMER_SERVICE_PERIOD_ERROR'},Number(error?.status)>=400&&Number(error?.status)<600?Number(error.status):500);
  }
}
