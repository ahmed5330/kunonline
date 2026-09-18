import {requirePermission} from './access-control.js';
import {listMyStores} from './store-scope.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {buildJtCreatePayload,createJtShipment,jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';

const PRINT_ORDER_PATH='/webopenplatformapi/api/order/printOrder';
const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
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

async function appendOrderEvent(env,row,type,metadata={},source='jt-print-workflow-v2'){
  const at=now(),entry={type,at,provider:'jt',...metadata},array=`CASE WHEN json_valid(history) AND json_type(history)='array' THEN history ELSE '[]' END`;
  await env.DB.prepare(`UPDATE orders SET history=json_insert(${array},'$[#]',json(?)) WHERE id=? AND client_id=?`).bind(JSON.stringify(entry),row.id,row.client_id).run();
  try{await env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(eventId(),row.client_id,row.store_id||null,row.id,type,null,null,source,JSON.stringify(metadata),at).run();}catch{}
  return entry;
}

function latestEvent(row,type){return [...parseArray(row?.history)].reverse().find(event=>event?.type===type)||null;}
function shipmentEvent(row){return latestEvent(row,'jt_shipment_created');}
function queueEvent(row){return latestEvent(row,'jt_print_queued');}

function minimalShipment(shipment,cred){
  return {
    receiverName:clean(shipment.receiverName,220),receiverPhone:clean(shipment.receiverPhone,80),receiverPhone2:clean(shipment.receiverPhone2,80),
    province:clean(shipment.province,160),provinceCode:clean(shipment.provinceCode,80),city:clean(shipment.city,160),cityCode:clean(shipment.cityCode,80),area:clean(shipment.area,220),districtCode:clean(shipment.districtCode,100),street:clean(shipment.street,900),
    itemName:clean(shipment.itemName,500),itemType:clean(shipment.itemType,120),weight:Number(shipment.weight||1),quantity:Number(shipment.quantity||1),codAmount:Number(shipment.codAmount||0),currency:shipment.currency||'EGP',productType:clean(shipment.productType,80),insured:clean(shipment.insured,40),pickupInfo:clean(shipment.pickupInfo,500),notes:clean(shipment.notes,500),
    senderName:clean(cred.fields.senderName,220),senderCompany:clean(cred.fields.senderCompany,220),senderMobile:clean(cred.fields.senderMobile,80),senderPhone:clean(cred.fields.senderPhone||cred.fields.senderMobile,80),senderProv:clean(cred.fields.senderProv,160),senderCity:clean(cred.fields.senderCity,160),senderArea:clean(cred.fields.senderArea,220),senderStreet:clean(cred.fields.senderStreet,900)
  };
}

async function delegateState(request,env,ctx,delegate,{clientId,orderId,storeId,awb=''}){
  const url=new URL(request.url);url.pathname=`/api/customer-service/orders/${encodeURIComponent(orderId)}/state`;url.search='';url.searchParams.set('clientId',clientId);if(storeId)url.searchParams.set('storeId',storeId);
  const headers=new Headers(request.headers);headers.set('Content-Type','application/json');
  const response=await delegate.fetch(new Request(url,{method:'PATCH',headers,body:JSON.stringify({clientId,...(storeId?{storeId}:{}),state:'shipped',...(awb?{awb}:{})})}),env,ctx),data=await response.clone().json().catch(()=>({error:`HTTP ${response.status}`}));
  return {response,data};
}

function buildShipment(row,body={}){
  return {...body,
    orderId:row.id,orderRef:row.ref||row.id,customerOrderNo:clean(body.customerOrderNo||row.ref||row.id,120),
    receiverName:clean(body.receiverName||row.name,220),receiverPhone:clean(body.receiverPhone||row.phone,80),province:clean(body.province||row.gov,160),street:clean(body.street||row.address,900),
    itemName:clean(body.itemName||row.product,500),quantity:body.quantity??row.qty,codAmount:body.codAmount??row.total,currency:clean(body.currency||'EGP',12),storeId:row.store_id||null
  };
}

async function queueForPrint(request,env,ctx,delegate,me,orderId){
  const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body),row=await assertOrderAccess(env,me,clientId,orderId,{write:true});
  if(body.storeId&&String(body.storeId)!==String(row.store_id||''))throw Object.assign(new Error('المتجر لا يطابق متجر الأوردر'),{status:409,code:'STORE_MISMATCH'});
  const existingQueue=queueEvent(row),created=shipmentEvent(row),existingAwb=clean(row.awb||created?.awb,160);
  if(existingQueue||existingAwb){
    if(row.state==='confirmed'){
      const handoff=await delegateState(request,env,ctx,delegate,{clientId,orderId:row.id,storeId:row.store_id||'',awb:existingAwb});
      if(!handoff.response.ok)return json({ok:true,queuedForPrint:true,shipmentCreated:Boolean(existingAwb),stateHandoffPending:true,orderId:row.id,awb:existingAwb,state:row.state,idempotent:true,message:'الطلب محفوظ بالفعل للطباعة، لكن نقل الحالة محليًا يحتاج إعادة المحاولة.'});
    }
    return json({ok:true,queuedForPrint:true,shipmentCreated:Boolean(existingAwb),orderId:row.id,awb:existingAwb,sortingCode:clean(created?.sortingCode,160),txlogisticId:clean(created?.txlogisticId||existingQueue?.txlogisticId||row.ref||row.id,160),state:'shipped',idempotent:true,message:existingAwb?'الشحنة موجودة بالفعل لدى J&T وتم إبقاؤها في طابور الطباعة.':'الطلب موجود بالفعل في «في انتظار الطباعة». لم يتم إنشاء شحنة J&T بعد.'});
  }
  if(row.state!=='confirmed')throw Object.assign(new Error('إرسال الطلب إلى طابور الطباعة متاح بعد تأكيد الطلب فقط'),{status:409,code:'JT_ORDER_NOT_CONFIRMED'});
  const {secrets,cred}=await connectionFor(env,clientId);if(!cred.enterpriseReady)throw Object.assign(new Error('إنشاء بوليصة J&T وقت الطباعة يحتاج Customer Code / Merchant Code + Customer Password / API Password'),{status:409,code:'JT_BUSINESS_CREDENTIALS_MISSING',enterpriseCredentialsRequired:true});
  const shipment=buildShipment(row,body);
  // Validate every field and the saved sender/business credentials without making any J&T network request.
  buildJtCreatePayload(shipment,secrets,{requireBusiness:true});
  const savedShipment=minimalShipment(shipment,cred),txlogisticId=shipment.customerOrderNo;
  await appendOrderEvent(env,row,'jt_print_queued',{txlogisticId,sourceCode:cred.fields.sourceCode,shipment:savedShipment,externalCreated:false,queuedBy:me?.name||me?.email||me?.role||'user'},'jt-print-queue');
  const handoff=await delegateState(request,env,ctx,delegate,{clientId,orderId:row.id,storeId:row.store_id||'',awb:''});
  if(!handoff.response.ok){await appendOrderEvent(env,row,'jt_print_queue_state_pending',{txlogisticId,error:clean(handoff.data?.error||`HTTP ${handoff.response.status}`,700)},'jt-print-queue');return json({ok:true,queuedForPrint:true,shipmentCreated:false,stateHandoffPending:true,orderId:row.id,awb:'',txlogisticId,state:row.state,message:'تم حفظ بيانات J&T محليًا بدون إنشاء شحنة لدى J&T، لكن نقل الطلب إلى «في انتظار الطباعة» يحتاج إعادة المحاولة.'});}
  return json({ok:true,queuedForPrint:true,shipmentCreated:false,orderId:row.id,awb:'',sortingCode:'',txlogisticId,state:'shipped',message:'تم نقل الطلب إلى «في انتظار الطباعة». لم يتم إنشاء الشحنة في J&T بعد؛ سيتم إنشاء AWB وكود الشحنة فقط عند الضغط على الطباعة.'},201);
}

function walkObjects(value,maxDepth=6){const out=[],seen=new Set();function visit(node,depth){if(depth>maxDepth||!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node)){for(const item of node.slice(0,50))visit(item,depth+1);return;}out.push(node);for(const child of Object.values(node))if(child&&typeof child==='object')visit(child,depth+1);}visit(value,0);return out;}
function findPrintUrl(payload){for(const object of walkObjects(payload))for(const key of ['url','pdfUrl','printUrl','fileUrl','downloadUrl']){const value=clean(object?.[key],2000);if(/^https?:\/\//i.test(value))return value;}return '';}

async function createAndPrint(request,env,ctx,me,orderId){
  const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body);let row=await assertOrderAccess(env,me,clientId,orderId,{write:true});
  if(row.state!=='shipped')throw Object.assign(new Error('لا يمكن إصدار أمر الطباعة إلا لأوردر موجود في «في انتظار الطباعة»'),{status:409,code:'JT_PRINT_STATE_REQUIRED'});
  const {row:connection,secrets,cred}=await connectionFor(env,clientId);if(!cred.enterpriseReady)throw Object.assign(new Error('طباعة البوليصة الرسمية تحتاج Business Info الخاصة بحساب J&T'),{status:409,code:'JT_BUSINESS_CREDENTIALS_MISSING',enterpriseCredentialsRequired:true});
  let createdEvent=shipmentEvent(row),awb=clean(row.awb||createdEvent?.awb,160),sortingCode=clean(createdEvent?.sortingCode,160),txlogisticId=clean(createdEvent?.txlogisticId,160),shipmentCreatedNow=false;
  const alreadyPrinted=parseArray(row.history).some(event=>event?.type==='jt_label_printed'&&(!awb||clean(event?.awb,160)===awb));
  if(alreadyPrinted)throw Object.assign(new Error('تمت طباعة هذه البوليصة بالفعل. استخدم إعادة الطباعة فقط عند الحاجة.'),{status:409,code:'JT_LABEL_ALREADY_PRINTED'});
  if(!awb){
    const queued=queueEvent(row);if(!queued?.shipment)throw Object.assign(new Error('بيانات الشحنة المحفوظة لطابور الطباعة غير موجودة. أعد الطلب إلى «تم التأكيد» ثم أرسله للطباعة مرة أخرى.'),{status:409,code:'JT_PRINT_QUEUE_DATA_MISSING'});
    const shipment={...queued.shipment,orderId:row.id,orderRef:row.ref||row.id,customerOrderNo:clean(queued.txlogisticId||row.ref||row.id,120),storeId:row.store_id||null};
    let created;try{created=await createJtShipment({shipment,secrets});}catch(error){await env.DB.prepare('UPDATE store_connections SET last_error=?,updated_at=? WHERE id=? AND client_id=?').bind(clean(error.message,1000),now(),connection.id,clientId).run().catch(()=>{});throw Object.assign(error,{status:error.status||502});}
    awb=created.awb;sortingCode=clean(created.sortingCode,160);txlogisticId=clean(created.txlogisticId||shipment.customerOrderNo,160);shipmentCreatedNow=true;
    await env.DB.prepare('UPDATE orders SET awb=? WHERE id=? AND client_id=?').bind(awb,row.id,clientId).run();
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
  await appendOrderEvent(env,row,'jt_label_printed',{awb,sortingCode,txlogisticId,printedAt,printedBy,confirmed:true,official:true,shipmentCreatedNow},'printing');
  return json({ok:true,official:true,provider:'jt',orderId:row.id,awb,sortingCode,txlogisticId,shipmentCreatedNow,printSize:'100x150mm',status:'printed',printed:true,printedAt,printedBy,url:printUrl});
}

export async function handleJtPrintWorkflowV2({request,env,ctx,delegate,me}){
  const url=new URL(request.url),method=request.method.toUpperCase();
  const print=url.pathname.match(/^\/api\/jt\/shipments\/([^/]+)\/print$/);if(print&&method==='POST')return createAndPrint(request,env,ctx,me,decodeURIComponent(print[1]));
  const shipment=url.pathname.match(/^\/api\/jt\/shipments\/([^/]+)$/);if(shipment&&method==='POST')return queueForPrint(request,env,ctx,delegate,me,decodeURIComponent(shipment[1]));
  return null;
}
