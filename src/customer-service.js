import {requirePermission,resolveTenant} from './access-control.js';
import {listMyStores} from './store-scope.js';

const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
const BOARD_STATES=['pending','confirmed','preparing','shipped'];
const BOARD_AND_DEFERRED=[...BOARD_STATES,'deferred'];
const STATE_LABELS={
  pending:'في انتظار التأكيد',
  confirmed:'تم التأكيد',
  preparing:'التجهيز والتغليف',
  shipped:'جاري الشحن',
  signed:'تم التسليم — تحصيل منتظر',
  collected:'تم التحصيل',
  returned:'مرتجع',
  cancelled:'تم إلغاء الطلب',
  deferred:'مؤجل'
};
const ALL_STATES=Object.keys(STATE_LABELS);
const clean=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const parseArr=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return [];}};
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});
const fail=(message,status=400,code='CUSTOMER_SERVICE_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
function cairoDate(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function scopedClient(me,request,body={}){
  const u=new URL(request.url),requested=body.clientId||body.client_id||u.searchParams.get('clientId')||me?.clientId||null;
  return resolveTenant(me,requested);
}
function assertRole(me,write=false){
  if(!ALLOWED_ROLES.has(me?.role))fail('قسم خدمة العملاء غير متاح لهذا الدور',403,'CUSTOMER_SERVICE_ROLE_DENIED');
  requirePermission(me,'orders',write?'update':'read');
}
async function accessContext(env,me,clientId){
  const context=await listMyStores(env,me,clientId),stores=context.stores||[];
  if(!context.allStores&&!stores.length)fail('لا توجد متاجر مخصصة لهذا المستخدم',403,'CUSTOMER_SERVICE_STORE_ACCESS_REQUIRED');
  return {allStores:Boolean(context.allStores),stores,ids:stores.map(s=>String(s.id))};
}
function storeCanWrite(access,storeId){
  if(access.allStores)return true;
  const row=access.stores.find(s=>String(s.id)===String(storeId||''));
  return Boolean(row&&row.role!=='viewer');
}
async function orderForAccess(env,me,clientId,orderId,{write=false}={}){
  const access=await accessContext(env,me,clientId);
  const row=await env.DB.prepare(`SELECT o.*,s.name store_name,s.code store_code FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE o.id=? AND o.client_id=?`).bind(orderId,clientId).first();
  if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(!access.allStores&&!access.ids.includes(String(row.store_id||'')))fail('الأوردر خارج المتاجر المسموح بها',403,'STORE_ISOLATION');
  if(write&&!storeCanWrite(access,row.store_id))fail('صلاحية هذا المتجر للعرض فقط',403,'STORE_READ_ONLY');
  return {row,access};
}
async function processDueDeferred(env,clientId,access){
  const today=cairoDate(),binds=[clientId,today];let where=`client_id=? AND state='deferred' AND defer_until IS NOT NULL AND defer_until<=?`;
  if(!access.allStores){where+=` AND store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);}
  const {results=[]}=await env.DB.prepare(`SELECT id,history,defer_until FROM orders WHERE ${where}`).bind(...binds).all();
  for(const row of results){
    const history=parseArr(row.history),stamp=now();
    history.push({type:'defer_return',state:'pending',at:stamp,note:'رجع تلقائي من التأجيل',deferUntil:row.defer_until,by:'النظام',byName:'النظام',byUserId:null,system:true});
    await env.DB.prepare('UPDATE orders SET state=?,checkpoint=?,history=? WHERE id=? AND client_id=?').bind('pending',STATE_LABELS.pending,JSON.stringify(history),row.id,clientId).run();
  }
  return results.length;
}
function historyMeta(history=[]){
  const notes=history.filter(x=>x?.type==='internal_note'&&clean(x.note));
  const returned=[...history].reverse().find(x=>x?.type==='defer_return'||x?.note==='رجع تلقائي من التأجيل');
  return {internalNotes:notes,latestInternalNote:notes.at(-1)?.note||'',returnedAt:returned?.at||null};
}
function mapOrder(row,today){
  const history=parseArr(row.history),contactLog=parseArr(row.contact_log),meta=historyMeta(history),returnedToday=Boolean(meta.returnedAt&&cairoDate(new Date(meta.returnedAt))===today&&row.state==='pending');
  return {
    id:row.id,clientId:row.client_id,storeId:row.store_id||null,storeName:row.store_name||'بدون متجر محدد',storeCode:row.store_code||null,
    ref:row.ref||null,date:row.date||row.created_at||null,createdAt:row.created_at||null,name:row.name||'',phone:row.phone||'',gov:row.gov||'',address:row.address||'',
    product:row.product||'',productId:row.product_id||null,productNote:row.product_note||'',qty:Number(row.qty||1),unitPrice:Number(row.unit_price||0),total:Number(row.total||0),
    source:row.source||'',customerNote:row.note||'',awb:row.awb||'',state:row.state||'pending',checkpoint:row.checkpoint||'',deferUntil:row.defer_until||null,
    contactLog,contactCount:contactLog.length,history,internalNotes:meta.internalNotes,latestInternalNote:meta.latestInternalNote,returnedFromDeferredToday:returnedToday
  };
}
export async function board(request,env,me){
  assertRole(me,false);const clientId=scopedClient(me,request),access=await accessContext(env,me,clientId),url=new URL(request.url),selected=clean(url.searchParams.get('storeId'));
  if(selected&&!access.allStores&&!access.ids.includes(selected))fail('المتجر غير مسموح لهذا المستخدم',403,'STORE_ISOLATION');
  if(selected&&access.allStores&&!access.ids.includes(selected))fail('المتجر غير موجود أو غير نشط',404,'STORE_NOT_FOUND');
  const dueReturned=await processDueDeferred(env,clientId,access),states=BOARD_AND_DEFERRED,binds=[clientId,...states];
  let where=`o.client_id=? AND o.state IN (${states.map(()=>'?').join(',')})`;
  if(selected){where+=' AND o.store_id=?';binds.push(selected);}else if(!access.allStores){where+=` AND o.store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);}
  const {results=[]}=await env.DB.prepare(`SELECT o.*,s.name store_name,s.code store_code FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE ${where} ORDER BY COALESCE(o.date,o.created_at) DESC,o.created_at DESC`).bind(...binds).all();
  const today=cairoDate(),orders=results.map(r=>mapOrder(r,today));
  return {ok:true,clientId,role:me.role,allStores:access.allStores,stores:access.stores.map(s=>({id:s.id,name:s.name,code:s.code||'',role:s.role||'owner'})),selectedStoreId:selected||null,dueReturned,today,stages:BOARD_STATES.map(id=>({id,label:STATE_LABELS[id]})),stateLabels:STATE_LABELS,orders};
}
async function decorateLatestState(env,clientId,orderId,state,me){
  const row=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)return;
  const history=parseArr(row.history),a=actor(me);let found=false;
  for(let i=history.length-1;i>=0;i--){const h=history[i];if(h?.state===state&&!h.by){history[i]={...h,...a,type:h.type||'state'};found=true;break;}if(h?.state&&h.state!==state)break;}
  if(!found)history.push({type:'state',state,at:now(),...a});
  await env.DB.prepare('UPDATE orders SET history=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),orderId,clientId).run();
}
async function appendContactMirror(env,clientId,orderId,me,channel='phone'){
  const row=await env.DB.prepare('SELECT history,contact_log FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)return {contactCount:0};
  const stamp=now(),a=actor(me),history=parseArr(row.history),contactLog=parseArr(row.contact_log),entry={type:'contact',channel,at:stamp,...a};
  history.push(entry);contactLog.push({channel,at:stamp,by:a.by,byName:a.byName,byUserId:a.byUserId});
  await env.DB.prepare('UPDATE orders SET history=?,contact_log=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),JSON.stringify(contactLog),orderId,clientId).run();
  return {contactCount:contactLog.length,entry};
}
async function decorateLatestType(env,clientId,orderId,type,me,metadata={}){
  const row=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)return;
  const history=parseArr(row.history),a=actor(me);let found=false;
  for(let i=history.length-1;i>=0;i--){if(history[i]?.type===type){history[i]={...history[i],...a,...metadata};found=true;break;}}
  if(!found)history.push({type,at:now(),...a,...metadata});
  await env.DB.prepare('UPDATE orders SET history=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),orderId,clientId).run();
}
function canonicalRequest(request,path,body,clientId,storeId){
  const u=new URL(request.url);u.pathname=path;u.search='';u.searchParams.set('clientId',clientId);if(storeId)u.searchParams.set('storeId',storeId);
  const headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('content-length');
  return new Request(u,{method:'POST',headers,body:JSON.stringify({...body,clientId,...(storeId?{storeId}:{})})});
}
async function proxyJson(response){const data=await response.clone().json().catch(()=>({error:`HTTP ${response.status}`}));return {data,status:response.status};}
export async function handleAction(request,env,me,delegate){
  assertRole(me,true);const path=new URL(request.url).pathname,method=request.method.toUpperCase(),body=await request.clone().json().catch(()=>({})),clientId=scopedClient(me,request,body);
  let m=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/(state|contact|whatsapp-log|notes|awb|history)$/);if(!m)fail('مسار خدمة العملاء غير مدعوم',404,'CUSTOMER_SERVICE_ROUTE_NOT_FOUND');
  const orderId=decodeURIComponent(m[1]),action=m[2],{row}=await orderForAccess(env,me,clientId,orderId,{write:action!=='history'}),storeId=row.store_id||null;
  if(action==='history'&&method==='GET')return {data:{ok:true,order:mapOrder(row,cairoDate())},status:200};
  if(action==='state'&&method==='PATCH'){
    const state=clean(body.state);if(!ALL_STATES.includes(state))fail('حالة الأوردر غير معروفة',400,'ORDER_STATE_INVALID');
    if(state==='deferred'&&!/^\d{4}-\d{2}-\d{2}$/.test(clean(body.deferUntil)))fail('حدد تاريخ التأجيل',400,'DEFER_DATE_REQUIRED');
    const req=canonicalRequest(request,`/api/orders/${encodeURIComponent(orderId)}`,{state,deferUntil:body.deferUntil||undefined,awb:body.awb||undefined},clientId,storeId);
    const legacy=new Request(req.url,{method:'PATCH',headers:req.headers,body:await req.text()});
    const response=await delegate(legacy);if(response.ok)await decorateLatestState(env,clientId,orderId,state,me);return proxyJson(response);
  }
  if(action==='contact'&&method==='POST'){
    const channel=['phone','whatsapp','messenger','instagram','tiktok'].includes(clean(body.channel).toLowerCase())?clean(body.channel).toLowerCase():'phone';
    const response=await delegate(canonicalRequest(request,`/api/orders/${encodeURIComponent(orderId)}/contact`,{channel},clientId,storeId));
    if(!response.ok)return proxyJson(response);
    const mirrored=await appendContactMirror(env,clientId,orderId,me,channel),proxied=await proxyJson(response);
    return {data:{...proxied.data,contactCount:mirrored.contactCount},status:proxied.status};
  }
  if(action==='whatsapp-log'&&method==='POST'){
    const template=['confirm','shipped','review'].includes(body.template)?body.template:'other';
    const response=await delegate(canonicalRequest(request,`/api/orders/${encodeURIComponent(orderId)}/whatsapp-log`,{template},clientId,storeId));if(response.ok)await decorateLatestType(env,clientId,orderId,'whatsapp',me,{template});return proxyJson(response);
  }
  if(action==='notes'&&method==='POST'){
    const note=clean(body.note);if(!note)fail('اكتب الملاحظة أولًا',400,'NOTE_REQUIRED');if(note.length>2000)fail('الملاحظة طويلة جدًا',400,'NOTE_TOO_LONG');
    const current=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first(),history=parseArr(current?.history),a=actor(me),entry={type:'internal_note',note,at:now(),...a};history.push(entry);
    await env.DB.prepare('UPDATE orders SET history=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),orderId,clientId).run();return {data:{ok:true,note:entry,history},status:201};
  }
  if(action==='awb'&&method==='PATCH'){
    const awb=clean(body.awb);if(awb.length>120)fail('رقم البوليصة غير صحيح',400,'AWB_INVALID');
    const current=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first(),history=parseArr(current?.history),a=actor(me);history.push({type:'awb',awb,at:now(),...a});
    await env.DB.prepare('UPDATE orders SET awb=?,history=? WHERE id=? AND client_id=?').bind(awb||null,JSON.stringify(history),orderId,clientId).run();return {data:{ok:true,awb,history},status:200};
  }
  fail('الطريقة غير مدعومة',405,'METHOD_NOT_ALLOWED');
}
export function canSeeCustomerService(me={}){return ALLOWED_ROLES.has(me.role);}
export const customerServiceStates={board:BOARD_STATES,all:ALL_STATES,labels:STATE_LABELS};
