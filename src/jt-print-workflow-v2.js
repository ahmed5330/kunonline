import {cancelJtShipment} from './jt-express-eg-cancel.js';
import {requirePermission} from './access-control.js';
import {listMyStores} from './store-scope.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {buildJtCreatePayload,createJtShipment,lookupJtShipmentByReference,jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';
import {claimJtCreate,pendingJtCreateClaim,persistJtClaimAwb,finalizeJtOfficialLabel,repairJtPrintedState} from './jt-shipping-claim.js';

const PRINT_ORDER_PATH='/webopenplatformapi/api/order/printOrder';
const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
const PRINTING_STATES=new Set(['confirmed','preparing','shipped']);
const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const parseArray=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const eventId=()=>`OEV-${crypto.randomUUID()}`;

function clientIdFor(me,request,body={}){
  const url=new URL(request.url),requested=clean(body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId,160);
  if(me?.role==='client'){
    if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});
    return clean(me.clientId,160);
  }
  if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return requested;
}

async function connectionFor(env,clientId){
  const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider='jt' ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'configured' THEN 1 ELSE 2 END,updated_at DESC,created_at DESC LIMIT 1").bind(clientId).first();
  if(!row)throw Object.assign(new Error('اربط J&T Express من مركز التكاملات أولًا'),{status:409,code:'JT_CONNECTION_REQUIRED'});
  const secrets=await readConnectionSecrets(env,clientId,row.id),cred=jtCredentials(secrets);
  if(cred.missing.length)throw Object.assign(new Error('بيانات J&T ناقصة: API Account + Private Key + Source Code مطلوبة'),{status:409,code:'JT_CREDENTIALS_MISSING'});
  return {row,secrets,cred};
}

async function assertOrderAccess(env,me,clientId,orderId,{write=true}={}){
  if(!ALLOWED_ROLES.has(me?.role))throw Object.assign(new Error('إرسال J&T غير متاح لهذا الدور'),{status:403,code:'JT_ROLE_DENIED'});
  requirePermission(me,'orders',write?'update':'read');
  const row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  const access=await listMyStores(env,me,clientId),stores=access.stores||[],ids=stores.map(store=>String(store.id));
  if(!access.allStores&&!ids.includes(String(row.store_id||'')))throw Object.assign(new Error('الأوردر خارج المتاجر المسموح بها'),{status:403,code:'STORE_ISOLATION'});
  if(write&&!access.allStores){const store=stores.find(item=>String(item.id)===String(row.store_id||''));if(!store||store.role==='viewer')throw Object.assign(new Error('صلاحية هذا المتجر للعرض فقط'),{status:403,code:'STORE_READ_ONLY'});}
  return row;
}

async function mirrorJtOrderEvent(env,row,entry,source='jt-print-workflow-v2'){
  try{await env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(eventId(),row.client_id,row.store_id||null,row.id,entry.type,null,null,source,JSON.stringify(entry),entry.at||now()).run();}catch{}
}
async function appendOrderEvent(env,row,type,metadata={},source='jt-print-workflow-v2'){
  const at=now(),entry={type,at,provider:'jt',...metadata},array=`CASE WHEN json_valid(history) AND json_type(history)='array' THEN history ELSE '[]' END`;
  await env.DB.prepare(`UPDATE orders SET history=json_insert(${array},'$[#]',json(?)) WHERE id=? AND client_id=?`).bind(JSON.stringify(entry),row.id,row.client_id).run();
  await mirrorJtOrderEvent(env,row,entry,source);
  return entry;
}


function activePrintHistory(row){
  const history=parseArray(row?.history);
  const lastReset=history.findLastIndex(event=>event?.type==='jt_print_voided');
  return lastReset<0?history:history.slice(lastReset+1);
}
function activeEvent(row,type){return [...activePrintHistory(row)].reverse().find(event=>event?.type===type)||null;}

async function voidWaybill(request,env,me,orderId){
  if(!['admin','client','ops'].includes(me?.role))throw Object.assign(new Error('حذف البوليصة متاح للإدارة أو مدير المتجر فقط'),{status:403,code:'JT_WAYBILL_VOID_ROLE_DENIED'});
  const body=await request.clone().json().catch(()=>({}));
  const clientId=clientIdFor(me,request,body);
  const row=await assertOrderAccess(env,me,clientId,orderId,{write:true});
  if(body.storeId&&String(body.storeId)!==String(row.store_id||''))throw Object.assign(new Error('المتجر لا يطابق الأوردر'),{status:409,code:'STORE_MISMATCH'});
  await assertNoPartialShipments(env,clientId,orderId);
  if(['signed','collected','returned','cancelled'].includes(row.state))throw Object.assign(new Error('لا يمكن حذف بوليصة طلب تم تسليمه أو إرجاعه أو إلغاؤه'),{status:409,code:'JT_WAYBILL_VOID_STATE_DENIED'});
  const queued=activeEvent(row,'jt_print_queued'),created=activeEvent(row,'jt_shipment_created');
  const printed=activeEvent(row,'jt_label_printed');
  const awb=clean(row.awb,160);
  if(pendingJtCreateClaim(row.history)&&!awb&&!created?.awb)throw Object.assign(new Error('شحنة J&T قيد الإنشاء أو تحتاج مطابقة مع الشركة. لا يمكن حذف تجهيزها حتى يتم التحقق من النتيجة.'),{status:409,code:'JT_CREATE_RECOVERY_REQUIRED'});
  if(!queued&&!created&&!printed&&!awb)throw Object.assign(new Error('لا توجد بوليصة أو تجهيز شحن نشط للحذف'),{status:409,code:'JT_WAYBILL_NOT_FOUND'});
  const reason=clean(body.reason,500);
  if(reason.length<8)throw Object.assign(new Error('اكتب سبب حذف البوليصة (٨ حروف على الأقل)'),{status:400,code:'JT_WAYBILL_VOID_REASON_REQUIRED'});
  const externalCreated=Boolean(awb||created?.awb);
  const txlogisticId=clean(created?.txlogisticId||queued?.txlogisticId||row.ref||row.id,160);
  if(externalCreated){
    // Never silently erase a live J&T shipment from the system: cancel it with
    // the carrier first, and preserve a full audit trail.
    await jtWarehouseCarrier.cancel(env,clientId,txlogisticId,reason);
  }
  const state=row.state==='shipped'?'confirmed':row.state;
  // CAS guard prevents a concurrent waybill change from being overwritten.
  const result=await env.DB.prepare("UPDATE orders SET awb=NULL,state=?,checkpoint=? WHERE id=? AND client_id=? AND COALESCE(awb,'')=? AND state=?")
    .bind(state,state==='confirmed'?'تم التأكيد':clean(row.checkpoint,200),row.id,clientId,awb,row.state).run();
  if((result.meta?.changes??0)!==1)throw Object.assign(new Error('تم تغيير الشحنة بالتزامن. حدّث القسم قبل المحاولة مرة أخرى، وتحقق من نتيجة إلغاء J&T.'),{status:409,code:'JT_WAYBILL_VOID_CONCURRENT_CHANGE'});
  const by=clean(me.name||me.email||me.role,200),byUserId=me.uid||me.id||null;
  await appendOrderEvent(env,row,'jt_print_voided',{previousAwb:awb,txlogisticId,reason,externalCancelled:externalCreated,previousState:row.state,state,byName:by,byUserId},'printing');
  return json({ok:true,orderId:row.id,state,waybillVoided:true,externalCancelled:externalCreated,previousAwb:awb,message:externalCreated?'تم إلغاء شحنة J&T وحذف البوليصة من قائمة الطباعة مع الحفاظ على سجلها.':'تم حذف تجهيز البوليصة من قسم الطباعة مع الحفاظ على السجل.'});
}

function latestEvent(row,type){return activeEvent(row,type);}
function shipmentEvent(row){return latestEvent(row,'jt_shipment_created');}
function queueEvent(row){return latestEvent(row,'jt_print_queued');}

function minimalShipment(shipment,cred){
  return {
    receiverName:clean(shipment.receiverName,220),receiverPhone:clean(shipment.receiverPhone,80),receiverPhone2:clean(shipment.receiverPhone2,80),
    countryCode:clean(shipment.countryCode||'EGY',80),addressCountryCode:clean(shipment.addressCountryCode,80),
    province:clean(shipment.province,160),provinceCode:clean(shipment.provinceCode,80),city:clean(shipment.city,160),cityCode:clean(shipment.cityCode,80),area:clean(shipment.area,220),districtCode:clean(shipment.districtCode||shipment.areaCode,100),street:clean(shipment.street,900),
    itemName:clean(shipment.itemName,500),itemType:clean(shipment.itemType,120),weight:Number(shipment.weight||1),quantity:Number(shipment.quantity||1),codAmount:Number(shipment.codAmount||0),currency:shipment.currency||'EGP',productType:clean(shipment.productType,80),insured:clean(shipment.insured,40),pickupInfo:clean(shipment.pickupInfo,500),notes:clean(shipment.notes,500),
    senderName:clean(cred.fields.senderName,220),senderCompany:clean(cred.fields.senderCompany,220),senderMobile:clean(cred.fields.senderMobile,80),senderPhone:clean(cred.fields.senderPhone||cred.fields.senderMobile,80),senderProv:clean(cred.fields.senderProv,160),senderCity:clean(cred.fields.senderCity,160),senderArea:clean(cred.fields.senderArea,220),senderStreet:clean(cred.fields.senderStreet,900)
  };
}

function buildShipment(row,body={}){
  return {...body,
    orderId:row.id,orderRef:row.ref||row.id,customerOrderNo:clean(body.customerOrderNo||row.ref||row.id,120),
    receiverName:clean(body.receiverName||row.name,220),receiverPhone:clean(body.receiverPhone||row.phone,80),receiverPhone2:clean(body.receiverPhone2||row.jnt_phone2,80),
    countryCode:clean(body.countryCode||'EGY',80),addressCountryCode:clean(body.addressCountryCode||row.jnt_country_code||row.jnt_address_country_code||'100000',80),
    province:clean(body.province||row.jnt_province||row.gov,160),provinceCode:clean(body.provinceCode||row.jnt_province_code,80),
    city:clean(body.city||row.jnt_city,160),cityCode:clean(body.cityCode||row.jnt_city_code,80),
    area:clean(body.area||row.jnt_area,220),districtCode:clean(body.districtCode||body.areaCode||row.jnt_district_code||row.jnt_area_code,100),
    street:clean(body.street||row.jnt_street||row.address,900),
    itemName:clean(body.itemName||row.product,500),itemType:clean(body.itemType||'Other',120),quantity:body.quantity??row.qty,weight:body.weight??row.parcel_weight??1,
    codAmount:body.codAmount??row.total,currency:clean(body.currency||'EGP',12),storeId:row.store_id||null,notes:clean(body.notes||row.note,500)
  };
}

async function queueForPrint(request,env,ctx,delegate,me,orderId){
  const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body),row=await assertOrderAccess(env,me,clientId,orderId,{write:true});
  await assertNoPartialShipments(env,clientId,row.id);
  if(body.storeId&&String(body.storeId)!==String(row.store_id||''))throw Object.assign(new Error('المتجر لا يطابق متجر الأوردر'),{status:409,code:'STORE_MISMATCH'});
  const existingQueue=queueEvent(row),created=shipmentEvent(row),existingAwb=clean(row.awb||created?.awb,160);
  if(existingQueue||existingAwb){
    return json({ok:true,queuedForPrint:true,shipmentCreated:Boolean(existingAwb),orderId:row.id,awb:existingAwb,sortingCode:clean(created?.sortingCode,160),txlogisticId:clean(created?.txlogisticId||existingQueue?.txlogisticId||row.ref||row.id,160),state:row.state,idempotent:true,message:existingAwb?'الشحنة موجودة بالفعل لدى J&T وهي متاحة في قسم الطباعة.':'بيانات الشحن محفوظة بالفعل في قسم الطباعة. لم يتم إرسال الأوردر إلى J&T بعد.'});
  }
  if(!['confirmed','preparing'].includes(row.state))throw Object.assign(new Error('إرسال الطلب من قسم الطباعة متاح بعد تأكيد الطلب فقط'),{status:409,code:'JT_ORDER_NOT_CONFIRMED'});
  const {secrets,cred}=await connectionFor(env,clientId);if(!cred.enterpriseReady)throw Object.assign(new Error('إرسال الشحنة من قسم الطباعة يحتاج Customer Code / Merchant Code + Customer Password / API Password'),{status:409,code:'JT_BUSINESS_CREDENTIALS_MISSING',enterpriseCredentialsRequired:true});
  const shipment=buildShipment(row,body);
  buildJtCreatePayload(shipment,secrets,{requireBusiness:true});
  const savedShipment=minimalShipment(shipment,cred),txlogisticId=shipment.customerOrderNo;
  await appendOrderEvent(env,row,'jt_print_queued',{txlogisticId,sourceCode:cred.fields.sourceCode,shipment:savedShipment,externalCreated:false,queuedBy:me?.name||me?.email||me?.role||'user'},'jt-print-queue');
  return json({ok:true,queuedForPrint:true,shipmentCreated:false,orderId:row.id,awb:'',sortingCode:'',txlogisticId,state:row.state,message:'تم تجهيز بيانات الشحن داخل قسم الطباعة. لم يتم إرسال الأوردر إلى J&T بعد.'},201);
}

function walkObjects(value,maxDepth=6){const out=[],seen=new Set();function visit(node,depth){if(depth>maxDepth||!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node)){for(const item of node.slice(0,50))visit(item,depth+1);return;}out.push(node);for(const child of Object.values(node))if(child&&typeof child==='object')visit(child,depth+1);}visit(value,0);return out;}
function findPrintUrl(payload){for(const object of walkObjects(payload))for(const key of ['url','pdfUrl','printUrl','fileUrl','downloadUrl']){const value=clean(object?.[key],2000);if(/^https?:\/\//i.test(value))return value;}return '';}

async function createAndPrint(request,env,ctx,delegate,me,orderId){
  const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body);let row=await assertOrderAccess(env,me,clientId,orderId,{write:true});
  await assertNoPartialShipments(env,clientId,row.id);
  if(!PRINTING_STATES.has(row.state))throw Object.assign(new Error('لا يمكن إرسال الأوردر إلى J&T إلا من قسم الطباعة بعد التأكيد'),{status:409,code:'JT_PRINT_STATE_REQUIRED'});
  // Official carrier waybill creation/printing precedes packing. Physical unit
  // validation is enforced at packing completion and warehouse handover.
  const {row:connection,secrets,cred}=await connectionFor(env,clientId);if(!cred.enterpriseReady)throw Object.assign(new Error('إصدار البوليصة الرسمية يحتاج Business Info الخاصة بحساب J&T'),{status:409,code:'JT_BUSINESS_CREDENTIALS_MISSING',enterpriseCredentialsRequired:true});
  let createdEvent=shipmentEvent(row),awb=clean(row.awb||createdEvent?.awb,160),sortingCode=clean(createdEvent?.sortingCode,160),txlogisticId=clean(createdEvent?.txlogisticId,160),shipmentCreatedNow=false;
  const alreadyPrinted=activePrintHistory(row).some(event=>event?.type==='jt_label_printed'&&(!awb||clean(event?.awb,160)===awb));
  if(alreadyPrinted){
    // Heal old interrupted flows that wrote label proof before shipped state.
    await repairJtPrintedState(env.DB,row);
    throw Object.assign(new Error('تم إصدار البوليصة بالفعل. حالة الطلب محفوظة؛ استخدم إعادة الطباعة فقط عند الحاجة.'),{status:409,code:'JT_LABEL_ALREADY_PRINTED'});
  }
  if(!awb){
    const queued=queueEvent(row);if(!queued?.shipment)throw Object.assign(new Error('بيانات الشحنة غير مجهزة. جهّز بيانات J&T من قسم الطباعة أولًا.'),{status:409,code:'JT_PRINT_QUEUE_DATA_MISSING'});
    const shipment={...queued.shipment,orderId:row.id,orderRef:row.ref||row.id,customerOrderNo:clean(queued.txlogisticId||row.ref||row.id,120),storeId:row.store_id||null};
    // A durable D1 CAS claim precedes every external addOrder request.
    // On uncertain timeout, ONLY an exact-reference GetOrders lookup may resume.
    const previousClaim=pendingJtCreateClaim(row.history);
    if(previousClaim&&previousClaim.txlogisticId!==shipment.customerOrderNo)
      throw Object.assign(new Error('رقم مرجع J&T اختلف بعد بدء الإنشاء؛ يلزم مراجعة يدوية.'),{status:409,code:'JT_CREATE_REFERENCE_MISMATCH'});
    const claim=previousClaim||await claimJtCreate(env.DB,row,shipment.customerOrderNo);
    let created;
    if(previousClaim){
      created=await lookupJtShipmentByReference({txlogisticId:claim.txlogisticId,secrets});
      if(!created)throw Object.assign(new Error('لم نتأكد بعد هل أنشأت J&T الشحنة. لن نرسل إنشاء جديدًا حتى يتم التحقق من نفس الرقم لدى الشركة.'),{status:409,code:'JT_CREATE_RECOVERY_REQUIRED'});
    }else{
      try{created=await createJtShipment({shipment,secrets});}
      catch(error){
        await env.DB.prepare('UPDATE store_connections SET last_error=?,updated_at=? WHERE id=? AND client_id=?').bind(clean(error.message,1000),now(),connection.id,clientId).run().catch(()=>{});
        // The claim persists even on network failure, since the carrier may
        // have committed the shipment before losing its HTTP response.
        throw Object.assign(error,{status:error.status||502});
      }
    }
    if(created.txlogisticId&&created.txlogisticId!==shipment.customerOrderNo)
      throw Object.assign(new Error('J&T أعادت رقم مرجع لا يطابق الأوردر؛ لن نحفظ بوليصة غير مؤكدة الهوية.'),{status:409,code:'JT_CREATE_REFERENCE_MISMATCH'});
    awb=created.awb;sortingCode=clean(created.sortingCode,160);txlogisticId=clean(created.txlogisticId||shipment.customerOrderNo,160);shipmentCreatedNow=!previousClaim;
    await persistJtClaimAwb(env.DB,row,claim,awb);
    await appendOrderEvent(env,row,'jt_shipment_created',{awb,sortingCode,txlogisticId,lastCenterName:created.lastCenterName||'',sourceCode:cred.fields.sourceCode,shipment:queued.shipment,recovered:Boolean(created.recovered),createdAtPrintTime:true},'jt-print-create');
    await env.DB.prepare("UPDATE store_connections SET status='connected',external_store_id=?,last_sync_at=?,last_error=NULL,updated_at=? WHERE id=? AND client_id=?").bind(cred.fields.sourceCode,now(),now(),connection.id,clientId).run().catch(()=>{});
    row={...row,awb,history:JSON.stringify([...parseArray(row.history),{type:'jt_shipment_created',awb,sortingCode,txlogisticId,shipment:queued.shipment}])};
  }
  const printedAt=now(),printedBy=me?.name||me?.email||me?.role||'user';
  await appendOrderEvent(env,row,'jt_print_requested',{awb,sortingCode,txlogisticId,shipmentCreatedNow,requestedBy:printedBy},'printing');
  const base={billCode:awb,printSize:'2',printCode:1},payload=__jtApiInternals.withEnterprise(base,cred.fields);let result;
  try{result=await __jtApiInternals.signedPost(PRINT_ORDER_PATH,payload,secrets,{fetcher:fetch});}catch(error){await appendOrderEvent(env,row,'jt_print_failed',{awb,error:clean(error?.message,700),shipmentCreatedNow},'printing');throw error;}
  if(!__jtApiInternals.success(result)){await appendOrderEvent(env,row,'jt_print_failed',{awb,jtCode:result.code||null,error:clean(result.message||`HTTP ${result.response.status}`,700),shipmentCreatedNow},'printing');throw Object.assign(new Error(`J&T لم تجهز البوليصة الرسمية للطباعة${result.code?` (${result.code})`:''}: ${result.message||`HTTP ${result.response.status}`}`),{status:result.response.status>=500?502:422,code:'JT_PRINT_REJECTED',jtCode:result.code});}
  const printUrl=findPrintUrl(result.data);if(!printUrl){await appendOrderEvent(env,row,'jt_print_failed',{awb,jtCode:result.code||null,error:'J&T accepted printOrder but returned no label URL',shipmentCreatedNow},'printing');throw Object.assign(new Error('J&T قبلت طلب الطباعة لكن لم ترجع رابط البوليصة بعد. تم حفظ AWB ولن يتم إنشاء شحنة مكررة عند إعادة المحاولة.'),{status:502,code:'JT_PRINT_URL_MISSING'});}
  const {label,handoff}=await finalizeJtOfficialLabel(env.DB,row,{awb,sortingCode,txlogisticId,printedAt,printedBy,shipmentCreatedNow});
  // orders.history + shipped are already committed atomically. Audit mirror is
  // best effort and may never be used as the carrier/state source of truth.
  await mirrorJtOrderEvent(env,row,label,'printing');
  await mirrorJtOrderEvent(env,row,handoff,'printing');
  return json({ok:true,official:true,provider:'jt',orderId:row.id,awb,sortingCode,txlogisticId,shipmentCreatedNow,printSize:'100x150mm',status:'printed',state:'shipped',printed:true,printedAt,printedBy,url:printUrl});
}

export async function handleJtPrintWorkflowV2({request,env,ctx,delegate,me}){
  const url=new URL(request.url),method=request.method.toUpperCase();
  const voidRoute=url.pathname.match(/^\/api\/jt\/shipments\/([^/]+)\/void$/);if(voidRoute&&method==='POST')return voidWaybill(request,env,me,decodeURIComponent(voidRoute[1]));
  const print=url.pathname.match(/^\/api\/jt\/shipments\/([^/]+)\/print$/);if(print&&method==='POST')return createAndPrint(request,env,ctx,delegate,me,decodeURIComponent(print[1]));
  const shipment=url.pathname.match(/^\/api\/jt\/shipments\/([^/]+)$/);if(shipment&&method==='POST')return queueForPrint(request,env,ctx,delegate,me,decodeURIComponent(shipment[1]));
  return null;
}

export const jtWarehouseCarrier={
 async cancel(env,clientId,txlogisticId,reason){const {secrets}=await connectionFor(env,clientId);return cancelJtShipment({txlogisticId,reason,secrets});},
 async prepare(env,clientId,order,body){const {secrets,cred}=await connectionFor(env,clientId);const shipment=buildShipment(order,body);buildJtCreatePayload(shipment,secrets,{requireBusiness:true});return minimalShipment(shipment,cred);},
 async create(env,clientId,shipment){const {secrets}=await connectionFor(env,clientId);return createJtShipment({shipment,secrets});},
 async print(env,clientId,awb){const {secrets,cred}=await connectionFor(env,clientId),payload=__jtApiInternals.withEnterprise({billCode:awb,printSize:'2',printCode:1},cred.fields),r=await __jtApiInternals.signedPost(PRINT_ORDER_PATH,payload,secrets,{fetcher:fetch});if(!__jtApiInternals.success(r))throw Object.assign(new Error('J&T رفضت طباعة البوليصة الرسمية'),{status:502,code:'JT_PRINT_REJECTED'});const url=findPrintUrl(r.data);if(!url)throw Object.assign(new Error('J&T لم ترجع رابط البوليصة بعد؛ أعد المحاولة بنفس الشحنة'),{status:502,code:'JT_PRINT_URL_MISSING'});return {url,official:true};}
};
async function assertNoPartialShipments(env,clientId,orderId){
 let row;try{row=await env.DB.prepare("SELECT 1 n FROM inventory_shipments WHERE client_id=? AND order_id=? AND status<>'cancelled' LIMIT 1").bind(clientId,orderId).first();}catch(e){if(!/no such table.*inventory_shipments/i.test(e.message))throw e;}
 if(row)throw Object.assign(new Error('الطلب له شحنات جزئية؛ أنشئ واطبع بوليصة كل شحنة من تشغيل المخزن'),{status:409,code:'PARTIAL_SHIPMENT_WORKFLOW_REQUIRED'});
}
