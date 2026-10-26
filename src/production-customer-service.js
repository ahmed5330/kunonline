import {listMyStores,resolveStoreScope} from './store-scope.js';
import {recoverOrderContacts} from './customer-contact-evidence.js';
import {normalizeOutcomeReason} from './order-outcome-reason.js';
import {attachVisibleGroupOrderNotes} from './collaboration-order-board-notes.js';
const ORDER_COLS='id, client_id, store_id, ref, customer_id, date, name, phone, gov, address, product, product_id, variant_id, product_note, unit_price, qty, total, discount_amount, coupon_code, product_cost, shipping_cost, other_cost, source, note, awb, state, checkpoint, signed_at, collected_at, defer_until, refund_amount, return_type, restocked, contact_log, history, created_at, contact_claim_user_id, contact_claim_name, contact_claimed_at';
const STATES=['pending','no_answer','confirmed','preparing','shipped','signed','collected','returned','cancelled','deferred'];
const BOARD_STATES=['pending','no_answer','confirmed','preparing','shipped','deferred'];
const LABELS={pending:'في انتظار التأكيد',no_answer:'العميل لا يرد',confirmed:'تم التأكيد',preparing:'التجهيز والتغليف',shipped:'جاري الشحن',signed:'تم التسليم — تحصيل منتظر',collected:'تم التحصيل',returned:'مرتجع',cancelled:'تم إلغاء الطلب',deferred:'مؤجل'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=v=>String(v??'').trim();
const arr=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[]}catch{return []}};
const now=()=>new Date().toISOString();
const n=v=>Number(v)||0;
const isRoute=path=>path==='/api/customer-service'||path==='/api/my-client-context'||path==='/api/catalog/products'||/^\/api\/orders\/[^/]+\/details$/.test(path)||/^\/api\/customer-service\/orders\/[^/]+\/(history|state|contact|notes|awb|whatsapp-log|delete|edit)$/.test(path);

function cairoToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validYmd(value){
  const s=clean(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
  const d=new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s?'':s;
}
function shiftYmd(value,days){
  const d=new Date(`${value}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
function firstOfMonth(value){return value.slice(0,7)+'-01';}
function previousMonthRange(today){
  const d=new Date(`${firstOfMonth(today)}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);
  const from=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);
  return {from,to:d.toISOString().slice(0,10)};
}
function previousWeekRange(today){
  const d=new Date(`${today}T00:00:00Z`),day=d.getUTCDay(),daysSinceMonday=(day+6)%7;
  const thisMonday=shiftYmd(today,-daysSinceMonday),to=shiftYmd(thisMonday,-1),from=shiftYmd(to,-6);
  return {from,to};
}
function normalizePeriod(value){
  return clean(value).replace(/([a-z])([A-Z])/g,'$1_$2').replace(/[\s-]+/g,'_').toLowerCase();
}
function boardDateRange(url){
  const first=(...names)=>{for(const name of names){const v=clean(url.searchParams.get(name));if(v)return v;}return '';};
  const rawFrom=first('periodFrom','from','dateFrom','startDate','start');
  const rawTo=first('periodTo','to','dateTo','endDate','end');
  if(rawFrom||rawTo){
    const from=validYmd(rawFrom),to=validYmd(rawTo);
    if(!from||!to)throw Object.assign(new Error('حدد بداية ونهاية الفترة بصيغة صحيحة'),{status:400,code:'CUSTOMER_SERVICE_DATE_RANGE_INVALID'});
    if(from>to)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'CUSTOMER_SERVICE_DATE_RANGE_REVERSED'});
    return {key:'custom',from,to};
  }

  const raw=first('period','range','dateRange');
  if(!raw)return {key:'all',from:'',to:''};
  const period=normalizePeriod(raw),today=cairoToday();
  if(['today','اليوم'].includes(period))return {key:'today',from:today,to:today};
  if(['week','last7','last_7','last_7_days','last_week','آخر_أسبوع','اخر_أسبوع','اخر_اسبوع','آخر_اسبوع'].includes(period))return {key:'last7',from:shiftYmd(today,-6),to:today};
  if(['previous_week','prev_week','prior_week','week_previous','الأسبوع_الماضي','الاسبوع_الماضي'].includes(period))return {key:'previous_week',...previousWeekRange(today)};
  if(['month','current_month','this_month','الشهر_الحالي'].includes(period))return {key:'current_month',from:firstOfMonth(today),to:today};
  if(['previous_month','prev_month','last_month','الشهر_الماضي'].includes(period))return {key:'previous_month',...previousMonthRange(today)};
  if(['custom','مدة_معينة','custom_range'].includes(period))throw Object.assign(new Error('حدد تاريخ البداية والنهاية للفترة المخصصة'),{status:400,code:'CUSTOMER_SERVICE_CUSTOM_RANGE_REQUIRED'});
  return {key:'all',from:'',to:''};
}

async function delegatedJson(delegate,request,env,ctx,path,method='GET',body){
  const u=new URL(request.url);u.pathname=path;u.search='';
  const headers=new Headers(request.headers);headers.delete('content-length');if(body!==undefined)headers.set('Content-Type','application/json; charset=utf-8');
  const r=await delegate.fetch(new Request(u,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
  return {response:r,data:await r.clone().json().catch(()=>({}))};
}
async function currentUser(delegate,request,env,ctx){
  const {response,data}=await delegatedJson(delegate,request,env,ctx,'/api/me');
  if(!response.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:response.status===200?401:response.status||401,code:'AUTH_REQUIRED'});
  if(!['admin','client','ops','support'].includes(data.role))throw Object.assign(new Error('قسم خدمة العملاء غير متاح لهذا الدور'),{status:403,code:'CUSTOMER_SERVICE_ROLE_DENIED'});
  return data;
}
function clientIdFor(me,url,body={}){
  const requested=clean(body.clientId||body.client_id||url.searchParams.get('clientId')||me.clientId);
  if(me.role==='client'){
    if(requested&&requested!==clean(me.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});
    return clean(me.clientId);
  }
  if(!requested)throw Object.assign(new Error('تعذر تحديد حساب المتجر'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return requested;
}
function mapOrder(r){
  const history=arr(r.history),contacts=recoverOrderContacts(r.contact_log,history),contactLog=contacts.contactLog;
  const notes=history.filter(x=>x?.type==='internal_note'&&clean(x.note));
  return {id:r.id,clientId:r.client_id,storeId:r.store_id||'',storeName:'',storeCode:'',ref:r.ref||r.id,date:r.date||r.created_at||'',createdAt:r.created_at||'',name:r.name||'',phone:r.phone||'',gov:r.gov||'',address:r.address||'',product:r.product||'',productId:r.product_id||'',variantId:r.variant_id||'',productNote:r.product_note||'',qty:n(r.qty)||1,unitPrice:n(r.unit_price),total:n(r.total),source:r.source||'',customerNote:r.note||'',awb:r.awb||'',state:r.state||'pending',checkpoint:r.checkpoint||LABELS[r.state]||'',deferUntil:r.defer_until||'',stockBatchId:'',stockBatchName:'',stockAllocationStatus:'',contactLog,contactCount:contacts.contactCount,screenedContactCount:contacts.screenedContactCount,recoveredContactCount:contacts.recoveredContactCount,contactCountSource:contacts.contactCountSource,history,internalNotes:notes,latestInternalNote:notes.at(-1)?.note||'',returnedFromDeferredToday:false};
}
async function getOrder(env,clientId,orderId){
  const row=await env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE id=? AND client_id=? LIMIT 1`).bind(orderId,clientId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  return row;
}
// Atomic JSON appends prevent simultaneous staff writes from losing history.
async function appendEvent(env,row,event,{contact=false}={}){
  const valid=column=>`CASE WHEN json_valid(${column}) THEN (CASE WHEN json_type(${column})='array' THEN ${column} ELSE '[]' END) ELSE '[]' END`;
  const set=contact
    ? `history=json_insert(${valid('history')},'$[#]',json(?)), contact_log=json_insert(${valid('contact_log')},'$[#]',json(?))`
    : `history=json_insert(${valid('history')},'$[#]',json(?))`;
  const query=env.DB.prepare(`UPDATE orders SET ${set} WHERE id=? AND client_id=?`);
  await (contact ? query.bind(JSON.stringify(event),JSON.stringify(event),row.id,row.client_id)
    : query.bind(JSON.stringify(event),row.id,row.client_id)).run();
  const saved=await env.DB.prepare('SELECT history,contact_log FROM orders WHERE id=? AND client_id=?').bind(row.id,row.client_id).first();
  return {history:arr(saved?.history),contactLog:arr(saved?.contact_log)};
}
/**
 * Return the actual saved line items on Android's order card, including
 * model/variant/color. Resolve in batches (not one HTTP request per card).
 * An import without order_items still uses the order's product/product_note.
 * This is read-only and never rewrites original order data.
 */
async function attachOrderProductLines(env,clientId,orders){
  const byId=new Map(orders.map(order=>[String(order.id),order]));
  const ids=[...byId.keys()];
  const size=750;
  for(let start=0;start<ids.length;start+=size){
    const slice=ids.slice(start,start+size);
    try{
      const {results=[]}=await env.DB.prepare(`SELECT order_id,product_name,variant_label,qty
        FROM order_items WHERE client_id=? AND order_id IN (SELECT value FROM json_each(?))
        AND (TRIM(COALESCE(product_name,''))<>'' OR TRIM(COALESCE(variant_label,''))<>'')
        ORDER BY created_at,id`).bind(clientId,JSON.stringify(slice)).all();
      for(const item of results){
        const o=byId.get(String(item.order_id));if(!o)continue;
        if(!o.productLines)o.productLines=[];
        if(o.productLines.length>=30)continue;
        o.productLines.push({name:clean(item.product_name)||o.product||'منتج',variant:clean(item.variant_label),qty:Math.max(1,Math.floor(n(item.qty)||1))});
      }
    }catch(error){
      // Some legacy tenants may lack order_items. A missing optional detail
      // must never block orders, notes, or staff calls from loading.
      console.warn('Optional order-item card enrichment skipped:',error?.message||error);
      break;
    }
  }
  return orders;
}

async function board(env,me,clientId,storeId,dateRange={key:'all',from:'',to:''},requestedState=''){
  // Operational board is intentionally multi-store: a support agent may work
  // in several assigned stores without selecting one before seeing orders.
  const access=await listMyStores(env,me,clientId),stores=access.stores||[],ids=stores.map(x=>String(x.id)),selected=clean(storeId);
  if(!access.allStores&&!ids.length)throw Object.assign(new Error('لا توجد متاجر مخصصة لهذا المستخدم'),{status:403,code:'CUSTOMER_SERVICE_STORE_ACCESS_REQUIRED'});
  if(selected&&!ids.includes(selected))throw Object.assign(new Error('المتجر خارج المتاجر المسموح بها'),{status:403,code:'STORE_ISOLATION'});
  const dateExpr="COALESCE(NULLIF(substr(date,1,10),''),substr(created_at,1,10))";
  const mobileStates=new Set([...STATES,'new','shipping','in_shipping','contacting','all']);
  const state=clean(requestedState);
  if(state&&!mobileStates.has(state))throw Object.assign(new Error('فلتر حالة الطلب غير معروف'),{status:400,code:'CUSTOMER_SERVICE_STATE_FILTER_INVALID'});
  const where=['client_id=?'],binds=[clientId];
  if(state==='contacting'){
    where.push("(contact_claim_user_id IS NOT NULL AND contact_claim_user_id!='')");
    where.push("state IN ('pending','no_answer','confirmed','preparing','deferred')");
  }else if(state==='pending'){
    where.push("state IN ('pending','new')");
    where.push("(contact_claim_user_id IS NULL OR contact_claim_user_id='')");
  }else if(state&&state!=='all'){
    where.push('state=?');binds.push(state);
  }else if(state==='all'){
    // Explicit "all" is opt-in. Keep every lifecycle category available.
  }else{
    where.push(`state IN (${BOARD_STATES.map(()=>'?').join(',')})`);
    binds.push(...BOARD_STATES);
  }
  if(selected){where.push('store_id=?');binds.push(selected);}
  else if(!access.allStores){where.push(`store_id IN (${ids.map(()=>'?').join(',')})`);binds.push(...ids);}
  if(dateRange.from&&dateRange.to){where.push(`${dateExpr} BETWEEN ? AND ?`);binds.push(dateRange.from,dateRange.to);}
  const {results=[]}=await env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE ${where.join(' AND ')}
    ORDER BY CASE state WHEN 'confirmed' THEN 0 WHEN 'preparing' THEN 1 WHEN 'pending' THEN 2 WHEN 'no_answer' THEN 3 WHEN 'deferred' THEN 4 ELSE 5 END,
    ${dateExpr} DESC,created_at DESC LIMIT 5000`).bind(...binds).all();
  const names=new Map(stores.map(x=>[String(x.id),x.name||'']));
  const orders=results.map(row=>({...mapOrder(row),storeName:names.get(String(row.store_id||''))||'بدون متجر محدد',storeCode:stores.find(x=>String(x.id)===String(row.store_id||''))?.code||''}));
  await attachOrderProductLines(env,clientId,orders);
  await attachVisibleGroupOrderNotes(env,clientId,me,orders);
  return {ok:true,clientId,role:me.role,allStores:access.allStores,stores,selectedStoreId:selected||null,today:cairoToday(),period:dateRange.key,periodFrom:dateRange.from||null,periodTo:dateRange.to||null,stages:BOARD_STATES.map(id=>({id,label:LABELS[id]})),stateLabels:LABELS,orders,truncated:results.length>=5000};
}
async function details(env,clientId,orderId){
  const r=await getOrder(env,clientId,orderId),o=mapOrder(r);
  const item={productId:o.productId,variantId:o.variantId,name:o.product,productName:o.product,variantName:o.productNote,note:o.productNote,quantity:o.qty,qty:o.qty,price:o.unitPrice,unitPrice:o.unitPrice,sku:''};
  return {ok:true,order:{id:o.id,ref:o.ref,clientId:o.clientId,storeId:o.storeId,state:o.state,couponCode:r.coupon_code||'',customerNote:o.customerNote,awb:o.awb},customer:{id:r.customer_id||'',name:o.name,phone:o.phone,government:o.gov,address:o.address},address:{government:o.gov,address:o.address},items:[item],summary:{total:o.total,qty:o.qty,discountAmount:n(r.discount_amount)},raw:o};
}
async function catalog(delegate,request,env,ctx,clientId){
  // Keep the detailed catalog route and store scope. The basic products route
  // omits variants, so inventory would silently report zero for variant stock.
  const u=new URL(request.url);u.pathname='/api/catalog/products';u.searchParams.set('clientId',clientId);
  const r=await delegate.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx),d=await r.clone().json().catch(()=>[]);
  if(!r.ok)return r;
  const products=Array.isArray(d)?d:(Array.isArray(d?.products)?d.products:[]);
  return json({ok:true,products});
}
export async function handleProductionCustomerService({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();if(!isRoute(path))return null;
  try{
    // Preview is the authoritative access-control source. The old fallback to
    // unscoped /api/state returns CLIENT_ID_REQUIRED for multi-tenant staff and
    // can incorrectly expose platform clients. Delegate the original request,
    // preserving the session and the server-side user_store_access filtering.
    if(path==='/api/my-client-context'&&method==='GET')return delegate.fetch(request,env,ctx);
    const me=await currentUser(delegate,request,env,ctx);
    const body=['POST','PATCH','PUT'].includes(method)?await request.clone().json().catch(()=>({})):{};
    const clientId=clientIdFor(me,url,body);
    if(path==='/api/customer-service'&&method==='GET')return json(await board(env,me,clientId,url.searchParams.get('storeId'),boardDateRange(url),url.searchParams.get('state')||''));
    if(path==='/api/catalog/products'&&method==='GET')return await catalog(delegate,request,env,ctx,clientId);
    let m=path.match(/^\/api\/orders\/([^/]+)\/details$/);
    if(m&&method==='GET'){
      const row=await getOrder(env,clientId,decodeURIComponent(m[1]));
      const requestedStore=clean(url.searchParams.get('storeId'));
      if(requestedStore&&requestedStore!==clean(row.store_id))return json({error:'الأوردر خارج المتجر المختار',code:'STORE_ISOLATION'},404);
      await resolveStoreScope(env,me,clientId,row.store_id||null,{write:false});
      return json(await details(env,clientId,decodeURIComponent(m[1])));
    }
    m=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/(history|state|contact|notes|awb|whatsapp-log|delete|edit)$/);
    if(!m)return json({error:'مسار خدمة العملاء غير مدعوم',code:'CUSTOMER_SERVICE_ROUTE_NOT_FOUND'},404);
    const orderId=decodeURIComponent(m[1]),action=m[2],row=await getOrder(env,clientId,orderId),actor=me.name||me.email||me.role,stamp=now();
    const selectedStore=clean(url.searchParams.get('storeId')||body.storeId);
    if(selectedStore&&selectedStore!==clean(row.store_id))return json({error:'الأوردر خارج المتجر المختار',code:'STORE_ISOLATION'},404);
    await resolveStoreScope(env,me,clientId,row.store_id||null,{write:method!=='GET'});
    if(action==='history'&&method==='GET')return json({ok:true,order:mapOrder(row)});
    if(action==='state'&&method==='PATCH'){
      const state=clean(body.state);if(!STATES.includes(state))return json({error:'حالة الأوردر غير معروفة',code:'ORDER_STATE_INVALID'},400);
      // A generic status PATCH is not evidence that the carrier accepted a shipment.
      // Use the authenticated J&T queue + official print workflow, which records
      // the AWB and only then commits the shipped state.
      if(state==='shipped')return json({error:'لنقل الأوردر إلى جاري الشحن استخدم إرسال J&T وطباعة البوليصة الرسمية',code:'JT_OFFICIAL_HANDOFF_REQUIRED'},409);
      if(state==='cancelled'&&!['pending','new','contacting','no_answer','confirmed','preparing','deferred'].includes(String(row.state||'')))
        return json({error:'لا يمكن إلغاء الطلب بهذه الطريقة بعد الشحن أو التحصيل؛ استخدم إجراءات الشحن والمرتجعات',code:'ORDER_CANCEL_NOT_ALLOWED'},409);
      const claimOwner=clean(row.contact_claim_user_id),actorId=clean(me.uid||me.id||me.email||`${me.role}:${me.clientId||''}`);
      if(claimOwner&&!['confirmed','no_answer','cancelled'].includes(state))return json({error:'الطلب محجوز في جاري التواصل حتى تم التأكيد أو العميل لا يرد أو العميل لغى',code:'CONTACT_DECISION_REQUIRED'},409);
      if(claimOwner&&claimOwner!==actorId&&me.role!=='admin')return json({error:'الطلب جارٍ التواصل معه بواسطة موظف آخر',code:'CONTACT_OWNED_BY_OTHER'},409);
      const deferUntil=state==='deferred'?clean(body.deferUntil):null;if(state==='deferred'&&!/^\d{4}-\d{2}-\d{2}$/.test(deferUntil))return json({error:'حدد تاريخ التأجيل',code:'DEFER_DATE_REQUIRED'},400);
      const cancelReason=normalizeOutcomeReason(body,state)||clean(body.note);
      if(state==='cancelled'&&!cancelReason)return json({error:'اكتب سبب الإلغاء أولًا',code:'CANCEL_REASON_REQUIRED'},400);
      if(cancelReason.length>2000)return json({error:'سبب الإلغاء طويل جدًا',code:'CANCEL_REASON_TOO_LONG'},400);
      const history=arr(row.history);
      history.push({type:'state',state,previousState:row.state,at:stamp,by:actor,byName:actor,byUserId:me.uid||me.id||null,
        ...(state==='cancelled'?{note:cancelReason,reason:cancelReason}:{} )});
      const entry=history.at(-1);
      await env.DB.batch([
        env.DB.prepare("UPDATE orders SET state=?, checkpoint=?, defer_until=?, history=json_insert(CASE WHEN json_valid(history) THEN (CASE WHEN json_type(history)='array' THEN history ELSE '[]' END) ELSE '[]' END,'$[#]',json(?)), contact_claim_user_id=CASE WHEN ? IN ('confirmed','no_answer','cancelled') THEN NULL ELSE contact_claim_user_id END,contact_claim_name=CASE WHEN ? IN ('confirmed','no_answer','cancelled') THEN NULL ELSE contact_claim_name END,contact_claimed_at=CASE WHEN ? IN ('confirmed','no_answer','cancelled') THEN NULL ELSE contact_claimed_at END WHERE id=? AND client_id=?")
          .bind(state,LABELS[state]||state,deferUntil,JSON.stringify(entry),state,state,state,orderId,clientId),
        env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .bind('OEV-'+crypto.randomUUID(),clientId,row.store_id||null,orderId,'state_changed',me.uid||me.id||null,actor,'android-customer-service',
            JSON.stringify({from:row.state,to:state,reason:state==='cancelled'?cancelReason:null,byName:actor}),stamp)
      ]);
      return json({ok:true,state,checkpoint:LABELS[state]||state,deferUntil,history,contactCount:recoverOrderContacts(row.contact_log,history).contactCount});
    }
    if(action==='contact'&&method==='POST'){
      const channel=['phone','whatsapp','messenger','instagram','tiktok'].includes(clean(body.channel).toLowerCase())?clean(body.channel).toLowerCase():'phone',
        intent=channel==='phone'&&body.intent==='screened'?'screened':body.intent==='call'?'call':'contact',
        event={type:'contact',channel,intent,at:stamp,by:actor,byName:actor,
          byUserId:me.uid||me.id||null,
          direction:intent==='screened'&&['incoming','outgoing'].includes(clean(body.direction))
            ?clean(body.direction):null};
      const saved=await appendEvent(env,row,event,{contact:true});return json({ok:true,entry:event,history:saved.history,log:saved.contactLog,
        contactCount:recoverOrderContacts(saved.contactLog,saved.history).contactCount,
        screenedContactCount:saved.contactLog.filter(e=>e?.channel==='phone'&&e?.intent==='screened').length});
    }
    if(action==='notes'&&method==='POST'){
      const note=clean(body.note);if(!note)return json({error:'اكتب الملاحظة أولًا',code:'NOTE_REQUIRED'},400);if(note.length>2000)return json({error:'الملاحظة طويلة جدًا',code:'NOTE_TOO_LONG'},400);
      const event={type:'internal_note',note,at:stamp,by:actor,byName:actor,byUserId:me.uid||null};const saved=await appendEvent(env,row,event);return json({ok:true,note:event,history:saved.history},201);
    }
    if(action==='awb'&&method==='PATCH'){
      const awb=clean(body.awb);if(awb.length>120)return json({error:'رقم البوليصة غير صحيح',code:'AWB_INVALID'},400);const history=arr(row.history);history.push({type:'awb',awb,at:stamp,by:actor});await env.DB.prepare('UPDATE orders SET awb=?, history=? WHERE id=? AND client_id=?').bind(awb||null,JSON.stringify(history),orderId,clientId).run();return json({ok:true,awb,history});
    }
    if(action==='whatsapp-log'&&method==='POST'){
      const template=clean(body.template)||'other',event={type:'whatsapp',template,at:stamp,by:actor,byName:actor,byUserId:me.uid||null};const saved=await appendEvent(env,row,event);return json({ok:true,event,history:saved.history});
    }
    if(action==='delete'&&method==='DELETE'){
      if(!['admin','client','ops'].includes(me.role))return json({error:'مش مسموح بحذف الأوردر',code:'ORDER_DELETE_DENIED'},403);
      const u=new URL(request.url);u.pathname=`/api/orders/${encodeURIComponent(orderId)}`;u.search='';const r=await delegate.fetch(new Request(u,{method:'DELETE',headers:request.headers}),env,ctx);return r;
    }
    if(action==='edit'&&method==='PATCH'){
      const name=clean(body.name),phone=clean(body.phone);if(!name||!phone)return json({error:'الاسم والهاتف مطلوبان',code:'ORDER_EDIT_REQUIRED_FIELDS'},400);
      const items=Array.isArray(body.items)?body.items:[],first=items[0]||{},product=items.map(x=>clean(x.productName)).filter(Boolean).join(' + ')||row.product||'',qty=items.length?items.reduce((s,x)=>s+Math.max(1,Number(x.qty)||1),0):n(row.qty)||1,unitPrice=items.length===1?n(first.unitPrice):n(row.unit_price),productId=items.length===1?(clean(first.productId)||null):null,variantId=items.length===1?(clean(first.variantId)||null):null,productNote=items.length===1?clean(first.variantLabel):row.product_note||'';
      const history=arr(row.history);history.push({
        type:'order_edit',at:stamp,by:actor,byName:actor,byUserId:me.uid||me.id||null,
        source:'android-customer-service',
        before:{name:row.name,phone:row.phone,gov:row.gov,address:row.address,total:row.total,product:row.product,qty:row.qty},
        after:{name,phone,gov:clean(body.gov),address:clean(body.address),total:Math.max(0,n(body.total)),product,qty}
      });
      const change=history.at(-1);
      await env.DB.batch([
        env.DB.prepare("UPDATE orders SET name=?,phone=?,gov=?,address=?,coupon_code=?,note=?,total=?,product=?,product_id=?,variant_id=?,product_note=?,qty=?,unit_price=?,history=json_insert(CASE WHEN json_valid(history) THEN (CASE WHEN json_type(history)='array' THEN history ELSE '[]' END) ELSE '[]' END,'$[#]',json(?)) WHERE id=? AND client_id=?")
          .bind(name,phone,clean(body.gov),clean(body.address),clean(body.couponCode)||null,clean(body.customerNote),Math.max(0,n(body.total)),product,productId,variantId,productNote,qty,unitPrice,JSON.stringify(change),orderId,clientId),
        env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .bind('OEV-'+crypto.randomUUID(),clientId,row.store_id||null,orderId,'order_edited',me.uid||me.id||null,actor,'android-customer-service',
            JSON.stringify({before:change.before,after:change.after,byName:actor}),stamp)
      ]);
      return json({ok:true,order:mapOrder(await getOrder(env,clientId,orderId))});
    }
    return json({error:'الطريقة غير مدعومة',code:'METHOD_NOT_ALLOWED'},405);
  }catch(error){return json({error:error?.message||'تعذر تنفيذ خدمة العملاء',code:error?.code||'CUSTOMER_SERVICE_ERROR'},Number(error?.status)>=400&&Number(error?.status)<600?Number(error.status):500);}
}
