import {requirePermission,resolveTenant} from './access-control.js';
import {listMyStores} from './store-scope.js';
import {prepareOrderStockTransition,rollbackOrderStockTransition,finalizeOrderStockTransition} from './inventory-fifo.js';

const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
const DELETE_ROLES=new Set(['admin','client','ops']);
const BOARD_STATES=['pending','no_answer','confirmed','preparing','shipped'];
const BOARD_AND_DEFERRED=[...BOARD_STATES,'deferred'];
const STATE_LABELS={
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
const ALL_STATES=Object.keys(STATE_LABELS);
const clean=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const parseArr=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return [];}};
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});
const fail=(message,status=400,code='CUSTOMER_SERVICE_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const LATEST_NOTE_SELECT=`ln.id canonical_latest_note_id,ln.body canonical_latest_note,ln.created_at canonical_latest_note_at,ln.created_by canonical_latest_note_by`;
const LATEST_NOTE_JOIN=`LEFT JOIN order_notes ln ON ln.id=(SELECT n.id FROM order_notes n WHERE n.order_id=o.id AND n.client_id=o.client_id ORDER BY n.created_at DESC,n.id DESC LIMIT 1)`;
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
  const row=await env.DB.prepare(`SELECT o.*,s.name store_name,s.code store_code,osa.batch_id stock_batch_id,osa.status stock_allocation_status,ib.name stock_batch_name,${LATEST_NOTE_SELECT}
    FROM orders o
    LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id
    LEFT JOIN order_stock_allocations osa ON osa.order_id=o.id AND osa.client_id=o.client_id
    LEFT JOIN inventory_batches ib ON ib.id=osa.batch_id AND ib.client_id=o.client_id
    ${LATEST_NOTE_JOIN}
    WHERE o.id=? AND o.client_id=?`).bind(orderId,clientId).first();
  if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(!access.allStores&&!access.ids.includes(String(row.store_id||'')))fail('الأوردر خارج المتاجر المسموح بها',403,'STORE_ISOLATION');
  if(write&&!storeCanWrite(access,row.store_id))fail('صلاحية هذا المتجر للعرض فقط',403,'STORE_READ_ONLY');
  return {row,access};
}
async function ensureLegacyCustomerServiceEnabled(env,me,clientId){
  if(me?.role!=='client')return false;
  const moduleRow=await env.DB.prepare("SELECT enabled FROM tenant_modules WHERE client_id=? AND module_key='orders'").bind(clientId).first().catch(()=>null);
  if(!moduleRow||Number(moduleRow.enabled)===0)return false;
  for(let attempt=0;attempt<4;attempt++){
    const row=await env.DB.prepare('SELECT json,updated_at FROM state WHERE id=1').first().catch(()=>null);if(!row?.json)return false;
    let state;try{state=JSON.parse(row.json)}catch{return false;}
    const clients=Array.isArray(state?.clients)?state.clients:[],client=clients.find(x=>String(x?.id)===String(clientId));if(!client)return false;
    if(client.customerServiceEnabled===true)return true;
    client.customerServiceEnabled=true;const ts=now();
    const result=await env.DB.prepare("UPDATE state SET json=?,updated_at=? WHERE id=1 AND COALESCE(updated_at,'')=?").bind(JSON.stringify(state),ts,row.updated_at||'').run();
    if(Number(result?.meta?.changes||0)>0)return true;
  }
  fail('تعذر مزامنة صلاحية خدمة العملاء، حاول مرة أخرى',409,'CUSTOMER_SERVICE_LEGACY_SYNC_CONFLICT');
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
function canonicalNoteEvent(row){
  const note=clean(row?.canonical_latest_note);if(!note)return null;
  const by=clean(row?.canonical_latest_note_by)||'user';
  return {type:'internal_note',note,at:row?.canonical_latest_note_at||null,by,byName:by,byUserId:null,noteId:row?.canonical_latest_note_id||null,canonical:true};
}
function mapOrder(row,today){
  const history=parseArr(row.history),canonical=canonicalNoteEvent(row);
  if(canonical&&!history.some(x=>(canonical.noteId&&x?.noteId===canonical.noteId)||(x?.type==='internal_note'&&clean(x.note)===canonical.note&&String(x.at||'')===String(canonical.at||''))))history.push(canonical);
  const contactLog=parseArr(row.contact_log),meta=historyMeta(history),returnedToday=Boolean(meta.returnedAt&&cairoDate(new Date(meta.returnedAt))===today&&row.state==='pending');
  return {
    id:row.id,clientId:row.client_id,storeId:row.store_id||null,storeName:row.store_name||'بدون متجر محدد',storeCode:row.store_code||null,
    ref:row.ref||null,date:row.date||row.created_at||null,createdAt:row.created_at||null,name:row.name||'',phone:row.phone||'',gov:row.gov||'',address:row.address||'',
    product:row.product||'',productId:row.product_id||null,variantId:row.variant_id||null,productNote:row.product_note||'',qty:Number(row.qty||1),unitPrice:Number(row.unit_price||0),total:Number(row.total||0),
    source:row.source||'',customerNote:row.note||'',awb:row.awb||'',state:row.state||'pending',checkpoint:row.checkpoint||'',deferUntil:row.defer_until||null,
    stockBatchId:row.stock_batch_id||null,stockBatchName:row.stock_batch_name||null,stockAllocationStatus:row.stock_allocation_status||null,
    contactLog,contactCount:contactLog.length,history,internalNotes:meta.internalNotes,latestInternalNote:canonical?.note||meta.latestInternalNote,returnedFromDeferredToday:returnedToday
  };
}
export async function board(request,env,me){
  assertRole(me,false);const clientId=scopedClient(me,request),access=await accessContext(env,me,clientId),url=new URL(request.url),selected=clean(url.searchParams.get('storeId'));
  if(selected&&!access.allStores&&!access.ids.includes(selected))fail('المتجر غير مسموح لهذا المستخدم',403,'STORE_ISOLATION');
  if(selected&&access.allStores&&!access.ids.includes(selected))fail('المتجر غير موجود أو غير نشط',404,'STORE_NOT_FOUND');
  const dueReturned=await processDueDeferred(env,clientId,access),states=BOARD_AND_DEFERRED,binds=[clientId,...states];
  let where=`o.client_id=? AND o.state IN (${states.map(()=>'?').join(',')})`;
  if(selected){where+=' AND o.store_id=?';binds.push(selected);}else if(!access.allStores){where+=` AND o.store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);}
  const {results=[]}=await env.DB.prepare(`SELECT o.*,s.name store_name,s.code store_code,osa.batch_id stock_batch_id,osa.status stock_allocation_status,ib.name stock_batch_name,${LATEST_NOTE_SELECT}
    FROM orders o
    LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id
    LEFT JOIN order_stock_allocations osa ON osa.order_id=o.id AND osa.client_id=o.client_id
    LEFT JOIN inventory_batches ib ON ib.id=osa.batch_id AND ib.client_id=o.client_id
    ${LATEST_NOTE_JOIN}
    WHERE ${where} ORDER BY COALESCE(o.date,o.created_at) DESC,o.created_at DESC`).bind(...binds).all();
  const today=cairoDate(),orders=results.map(r=>mapOrder(r,today));
  return {ok:true,clientId,role:me.role,allStores:access.allStores,stores:access.stores.map(s=>({id:s.id,name:s.name,code:s.code||'',role:s.role||'owner'})),selectedStoreId:selected||null,dueReturned,today,stages:BOARD_STATES.map(id=>({id,label:STATE_LABELS[id]})),stateLabels:STATE_LABELS,orders};
}
async function decorateLatestState(env,clientId,orderId,state,me,metadata={}){
  const row=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)return [];
  const history=parseArr(row.history),a=actor(me);let found=false;
  for(let i=history.length-1;i>=0;i--){const h=history[i];if(h?.state===state&&!h.by){history[i]={...h,...a,...metadata,type:h.type||'state'};found=true;break;}if(h?.state&&h.state!==state)break;}
  if(!found)history.push({type:'state',state,at:now(),...a,...metadata});
  await env.DB.prepare('UPDATE orders SET history=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),orderId,clientId).run();return history;
}
// Append inside SQLite rather than replacing a previously read JSON array: concurrent staff actions must not erase each other.
async function saveInteraction(env,row,me,{note=null,channel='phone',intent='contact'}){
  const clientId=row.client_id,orderId=row.id,storeId=row.store_id||null,a=actor(me),at=now();
  const eventId=`OEV-${crypto.randomUUID()}`,noteId=note!==null?`ON-${crypto.randomUUID()}`:null;
  const entry=note!==null?{type:'internal_note',note,at,...a,eventId,noteId}:{type:'contact',channel,intent,at,...a,eventId};
  const array=column=>`CASE WHEN json_valid(${column}) AND json_type(${column})='array' THEN ${column} ELSE '[]' END`;
  const statements=[];
  if(note!==null){
    statements.push(env.DB.prepare(`UPDATE orders SET history=json_insert(${array('history')},'$[#]',json(?)) WHERE id=? AND client_id=?`).bind(JSON.stringify(entry),orderId,clientId));
    statements.push(env.DB.prepare('INSERT INTO order_notes (id,client_id,store_id,order_id,body,created_by,created_at) VALUES (?,?,?,?,?,?,?)').bind(noteId,clientId,storeId,orderId,note,a.by,at));
  }else{
    statements.push(env.DB.prepare(`UPDATE orders SET history=json_insert(${array('history')},'$[#]',json(?)),contact_log=json_insert(${array('contact_log')},'$[#]',json(?)) WHERE id=? AND client_id=?`).bind(JSON.stringify(entry),JSON.stringify(entry),orderId,clientId));
  }
  const metadata=note!==null?{noteId,body:note,byName:a.byName}:{kind:channel,intent,message:intent==='call'?'إجراء مكالمة — تم الضغط على زر الاتصال':'محاولة تواصل مع العميل',byName:a.byName};
  statements.push(env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(eventId,clientId,storeId,orderId,note!==null?'note_added':`contact_${channel}`,a.byUserId,a.by,'customer-service',JSON.stringify(metadata),at));
  await env.DB.batch(statements);
  const saved=await env.DB.prepare('SELECT history,contact_log FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!saved)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  const history=parseArr(saved.history),log=parseArr(saved.contact_log);
  return {ok:true,entry,note:note!==null?entry:undefined,history,log,contactCount:log.length,todayCount:log.filter(x=>x.at&&cairoDate(new Date(x.at))===cairoDate()).length};
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
  let m=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/(state|contact|whatsapp-log|notes|awb|history|delete)$/);if(!m)fail('مسار خدمة العملاء غير مدعوم',404,'CUSTOMER_SERVICE_ROUTE_NOT_FOUND');
  const orderId=decodeURIComponent(m[1]),action=m[2],{row}=await orderForAccess(env,me,clientId,orderId,{write:action!=='history'}),storeId=row.store_id||null;
  if(action==='history'&&method==='GET')return {data:{ok:true,order:mapOrder(row,cairoDate())},status:200};
  if(action==='delete'&&method==='DELETE'){
    if(!DELETE_ROLES.has(me?.role))fail('مش مسموح — حذف الأوردر متاح للإدارة أو مالك الحساب أو مدير التشغيل فقط',403,'ORDER_DELETE_DENIED');
    const a=actor(me),stamp=now(),snapshot={id:row.id,state:row.state,name:row.name,phone:row.phone,total:Number(row.total||0),source:row.source||'',storeId};
    await env.DB.batch([
      env.DB.prepare('DELETE FROM order_notes WHERE order_id=? AND client_id=?').bind(orderId,clientId),
      env.DB.prepare('DELETE FROM order_events WHERE order_id=? AND client_id=?').bind(orderId,clientId),
      env.DB.prepare('DELETE FROM order_attribution WHERE order_id=? AND client_id=?').bind(orderId,clientId),
      env.DB.prepare('DELETE FROM whatsapp_outbox WHERE order_id=? AND client_id=?').bind(orderId,clientId),
      env.DB.prepare('DELETE FROM order_stock_allocations WHERE order_id=? AND client_id=?').bind(orderId,clientId),
      env.DB.prepare('DELETE FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId)
    ]);
    try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,storeId,a.byUserId,a.by,'order.delete','order',orderId,JSON.stringify(snapshot),JSON.stringify({source:'orders_ui'}),stamp).run();}catch{}
    return {data:{ok:true,id:orderId,deleted:true},status:200};
  }
  if(['state','whatsapp-log'].includes(action))await ensureLegacyCustomerServiceEnabled(env,me,clientId);
  if(action==='state'&&method==='PATCH'){
    const state=clean(body.state);if(!ALL_STATES.includes(state))fail('حالة الأوردر غير معروفة',400,'ORDER_STATE_INVALID');
    if(state==='no_answer'&&!['pending','deferred','no_answer'].includes(clean(row.state)))fail('حالة «العميل لا يرد» متاحة قبل تأكيد الطلب فقط',409,'NO_ANSWER_STATE_INVALID_FROM_CONFIRMED');
    if(state==='deferred'&&!/^\d{4}-\d{2}-\d{2}$/.test(clean(body.deferUntil)))fail('حدد تاريخ التأجيل',400,'DEFER_DATE_REQUIRED');
    if(state==='no_answer'){
      await env.DB.prepare('UPDATE orders SET state=?,checkpoint=?,defer_until=NULL WHERE id=? AND client_id=?').bind(state,STATE_LABELS.no_answer,orderId,clientId).run();
      const history=await decorateLatestState(env,clientId,orderId,state,me,{contactCount:parseArr(row.contact_log).length});
      return {data:{ok:true,state,checkpoint:STATE_LABELS.no_answer,deferUntil:null,history,contactCount:parseArr(row.contact_log).length},status:200};
    }
    let stockTransition={kind:'none'};
    try{
      stockTransition=await prepareOrderStockTransition(env,{clientId,storeId,orderId,fromState:row.state,toState:state,stockBatchId:body.stockBatchId||body.stock_batch_id,actor:me});
      const req=canonicalRequest(request,`/api/orders/${encodeURIComponent(orderId)}`,{state,deferUntil:body.deferUntil||undefined,awb:body.awb||undefined},clientId,storeId),legacy=new Request(req.url,{method:'PATCH',headers:req.headers,body:await req.text()}),response=await delegate(legacy);
      if(!response.ok){await rollbackOrderStockTransition(env,stockTransition);return proxyJson(response);}
      const finalized=await finalizeOrderStockTransition(env,{clientId,orderId,fromState:row.state,toState:state});
      const metadata=stockTransition.kind==='allocated'?{stockBatchId:stockTransition.batchId,stockBatchName:stockTransition.batchName,stockQty:stockTransition.qty}:finalized.kind==='returned'?{stockBatchId:finalized.batchId,stockRestoredQty:finalized.qty}:{};
      await decorateLatestState(env,clientId,orderId,state,me,metadata);return proxyJson(response);
    }catch(error){await rollbackOrderStockTransition(env,stockTransition).catch(()=>{});throw error;}
  }
  if(action==='contact'&&method==='POST'){
    const channel=['phone','whatsapp','messenger','instagram','tiktok'].includes(clean(body.channel).toLowerCase())?clean(body.channel).toLowerCase():'phone';
    const intent=body.intent==='call'?'call':'contact';
    if(intent==='call'&&channel!=='phone')fail('المكالمة تتطلب قناة الهاتف',400,'CONTACT_CHANNEL_INVALID');
    return {data:await saveInteraction(env,row,me,{channel,intent}),status:200};
  }
  if(action==='whatsapp-log'&&method==='POST'){
    const template=['confirm','shipped','review'].includes(body.template)?body.template:'other';
    const response=await delegate(canonicalRequest(request,`/api/orders/${encodeURIComponent(orderId)}/whatsapp-log`,{template},clientId,storeId));if(response.ok)await decorateLatestType(env,clientId,orderId,'whatsapp',me,{template});return proxyJson(response);
  }
  if(action==='notes'&&method==='POST'){
    const note=clean(body.note);if(!note)fail('اكتب الملاحظة أولًا',400,'NOTE_REQUIRED');if(note.length>2000)fail('الملاحظة طويلة جدًا',400,'NOTE_TOO_LONG');
    return {data:await saveInteraction(env,row,me,{note}),status:201};
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
