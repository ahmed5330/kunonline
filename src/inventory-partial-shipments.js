import {isSerializedProduct} from './inventory-tracking-mode.js';
import {assertUnitStore,operationGuard,decodeUnitCode} from './inventory-unit-safety.js';
import {requirePermission} from './access-control.js';
import {jtWarehouseCarrier} from './jt-print-workflow-v2.js';
const time=()=>new Date().toISOString(),uid=()=>crypto.randomUUID();
const fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{status,code});};
const q=(env,sql,...b)=>env.DB.prepare(sql).bind(...b);
async function atomic(env,steps){try{await env.DB.batch([...steps,env.DB.prepare('DELETE FROM inventory_operation_guards')]);}catch(e){if(/CHECK constraint failed|UNIQUE constraint failed/.test(e.message))fail('SHIPMENT_CONFLICT','الشحنة أو القطع تغيرت؛ حدّث العملية');throw e;}}
function audit(env,s,type,actor,metadata={}){return q(env,'INSERT INTO inventory_shipment_events(id,shipment_id,client_id,event_type,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),s.id,s.client_id,type,actor,JSON.stringify(metadata),time());}
function unitAudit(env,s,u,type,actor,to=u.status){return q(env,'INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.id,u.unit_code,s.client_id,s.store_id,s.order_id,type,u.status,to,'partial_shipment',actor,JSON.stringify({shipmentId:s.id,awb:s.awb||null}),time());}
async function load(env,clientId,storeId,id){return assertUnitStore(await q(env,'SELECT * FROM inventory_shipments WHERE client_id=? AND id=?',clientId,id).first(),storeId);}
async function rows(env,s){return (await q(env,"SELECT u.*,x.allocation_id,x.scanned_at,x.product_id planned_product,x.variant_id planned_variant FROM inventory_shipment_units x JOIN inventory_units u ON u.id=x.unit_id AND u.client_id=x.client_id WHERE x.client_id=? AND x.shipment_id=? AND (x.cancelled_at IS NULL OR ?='handed_over')",s.client_id,s.id,s.status||null).all()).results||[];}
async function resolveOrder(env,clientId,storeId,code){
 const list=(await q(env,'SELECT * FROM orders WHERE client_id=? AND (id=? OR ref=?) AND (? IS NULL OR store_id=?) LIMIT 2',clientId,code,code,storeId,storeId).all()).results||[],exact=list.find(o=>o.id===code);
 if(exact)return exact;if(list.length!==1)fail('ORDER_SCAN_AMBIGUOUS','رقم الطلب غير موجود أو يطابق أكثر من طلب؛ استخدم رقم الطلب الداخلي',404);return list[0];
}
export async function shipmentOperation({env,clientId,storeId,me,actor,path,method,body,url,carrier=jtWarehouseCarrier}){
 const base='/api/inventory/unit-tracking/shipments';if(!path.startsWith(base))return null;
 if(method==='GET'){
  requirePermission(me,'orders','read');const id=url.searchParams.get('id');
  if(id){const s=await load(env,clientId,storeId,id);return {ok:true,shipment:s,units:await rows(env,s)};}
  const orderId=url.searchParams.get('orderId')||url.searchParams.get('orderRef');const o=await resolveOrder(env,clientId,storeId,orderId);
  const shipments=(await q(env,'SELECT id,status,awb,cod_minor,printed_at,handed_over_at FROM inventory_shipments WHERE client_id=? AND order_id=? ORDER BY created_at',clientId,o.id).all()).results||[];
  const units=(await q(env,"SELECT u.id,u.unit_code,u.product_name,u.product_id,u.variant_id,u.sku FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id AND u.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? AND a.status='reserved' AND u.status='reserved' AND NOT EXISTS(SELECT 1 FROM inventory_shipment_units x WHERE x.client_id=u.client_id AND x.unit_id=u.id AND x.cancelled_at IS NULL)",clientId,o.id).all()).results||[];
  return {ok:true,order:o,shipments,units};
 }
 requirePermission(me,'orders','update');
 if(path===base&&method==='POST'){
  const o=await resolveOrder(env,clientId,storeId,String(body.orderId||''));
  if(!['confirmed','preparing'].includes(o.state)||o.awb)fail('SHIPMENT_ORDER_STATE','الشحن الجزئي متاح للطلب المؤكد قبل إصدار بوليصة الطلب الكاملة');
  const codes=[...new Set((body.codes||[]).map(decodeUnitCode))],key=String(body.idempotencyKey||'').trim();if(!key||key.length>100||!codes.length||codes.length>100)fail('SHIPMENT_PLAN_REQUIRED','حدد من 1 إلى 100 قطعة ومفتاح محاولة ثابت',400);
  const codMinor=Math.round(Number(body.codAmount)*100),limit=Math.round(Number(o.total)*100);if(!Number.isSafeInteger(codMinor)||codMinor<0||!Number.isSafeInteger(limit))fail('SHIPMENT_COD_INVALID','حدد مبلغ التحصيل للشحنة',400);
  const requestJson=JSON.stringify({codes:[...codes].sort(),codMinor});const prior=await q(env,'SELECT * FROM inventory_shipments WHERE client_id=? AND order_id=? AND idempotency_key=?',clientId,o.id,key).first();if(prior){if(prior.request_json!==requestJson)fail('IDEMPOTENCY_MISMATCH','مفتاح المحاولة مستخدم لخطة مختلفة');return {ok:true,idempotent:true,shipment:prior};}
  const units=[];for(const code of codes){const u=assertUnitStore(await q(env,"SELECT u.*,a.id allocation_id FROM inventory_units u JOIN order_unit_allocations a ON a.unit_id=u.id AND a.client_id=u.client_id WHERE u.client_id=? AND u.unit_code=? AND a.order_id=? AND a.status='reserved'",clientId,code,o.id).first(),storeId);if(!await isSerializedProduct(env,clientId,u.product_id,u.variant_id||null))fail('SERIALIZATION_REQUIRED','فعّل الترقيم لهذا المنتج أو Variant قبل تقسيم الشحنات');if(u.status!=='reserved'||u.current_order_id!==o.id)fail('SHIPMENT_UNIT_UNAVAILABLE','القطعة غير محجوزة لهذا الطلب');units.push(u);}
  const shipmentId=uid(),at=time(),tx='KUN-'+shipmentId.replace(/-/g,''),shipment=await carrier.prepare(env,clientId,o,{...body,quantity:units.length,codAmount:codMinor/100,customerOrderNo:tx});
  const s={id:shipmentId,client_id:clientId,store_id:o.store_id||null,order_id:o.id},steps=[operationGuard(env,"EXISTS(SELECT 1 FROM orders WHERE id=? AND client_id=? AND state IN ('confirmed','preparing') AND COALESCE(awb,'')='') AND COALESCE((SELECT SUM(cod_minor) FROM inventory_shipments WHERE client_id=? AND order_id=? AND status<>'cancelled'),0)+?<=?",[o.id,clientId,clientId,o.id,codMinor,limit]),q(env,'INSERT INTO inventory_shipments(id,client_id,store_id,order_id,idempotency_key,request_json,shipment_json,cod_minor,txlogistic_id,actor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',shipmentId,clientId,s.store_id,o.id,key,requestJson,JSON.stringify(shipment),codMinor,tx,actor,at,at)];
  for(const u of units)steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id=? AND status='reserved' AND updated_at=?)",[u.id,clientId,o.id,u.updated_at]),q(env,'INSERT INTO inventory_shipment_units(shipment_id,client_id,unit_id,allocation_id,product_id,variant_id,unit_code) VALUES(?,?,?,?,?,?,?)',shipmentId,clientId,u.id,u.allocation_id,u.product_id,u.variant_id||null,u.unit_code),unitAudit(env,s,u,'partial_shipment_planned',actor));
  steps.push(audit(env,s,'planned',actor,{count:units.length,codMinor}));await atomic(env,steps);return {ok:true,shipment:await load(env,clientId,storeId,shipmentId)};
 }
 if(path===base+'/pack/open'){
  const code=String(body.code||'').trim(),s=assertUnitStore(await q(env,'SELECT * FROM inventory_shipments WHERE client_id=? AND awb=?',clientId,code).first(),storeId);
  if(!s.printed_at||!['printed','packing','packed'].includes(s.status))fail('SHIPMENT_NOT_PRINTED','اطبع البوليصة الرسمية قبل التجهيز');
  if(s.status==='printed'){const sessionId=uid(),units=await rows(env,s);await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status='printed')",[s.id]),q(env,"UPDATE inventory_shipments SET status='packing',packing_session_id=?,updated_at=? WHERE id=?",sessionId,time(),s.id),q(env,"INSERT INTO inventory_scan_sessions(id,client_id,store_id,order_id,scan_context,status,order_scan_code,expected_units,scanned_units,awb,actor,created_at,updated_at) VALUES(?,?,?,?,'packing','open',?,?,0,?,?,?,?)",sessionId,clientId,s.store_id,s.order_id,code,units.length,s.awb,actor,time(),time()),audit(env,s,'packing_opened_by_waybill',actor,{awb:code,sessionId})]);}
  const units=await rows(env,s);return {ok:true,shipmentId:s.id,orderId:s.order_id,awb:s.awb,expected:units.length,scanned:units.filter(u=>u.scanned_at).length};
 }
 const s=await load(env,clientId,storeId,body.shipmentId);
 if(path===base+'/cancel'){
  requirePermission(me,'shipping','cancel');if(s.status==='cancelled')return {ok:true,idempotent:true};if(!['planned','waybill_pending','waybill_created','printed','packing','packed','cancel_pending'].includes(s.status)||s.handover_batch_id)fail('SHIPPED_UNIT_CANCEL_BLOCKED','الشحنة خرجت أو أضيفت للتسليم؛ استخدم المرتجع');
  const reason=String(body.reason||'').trim();if(!reason)fail('CANCEL_REASON_REQUIRED','سبب الإلغاء مطلوب',400);
  const token=uid(),external=s.status!=='planned';
  await atomic(env,[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status=? AND handover_batch_id IS NULL AND (lock_token IS NULL OR lock_until<?))',[s.id,s.status,time()]),q(env,'UPDATE inventory_shipments SET status=?,lock_token=?,lock_until=?,updated_at=? WHERE id=?',external?'cancel_pending':'planned',token,new Date(Date.now()+120000).toISOString(),time(),s.id)]);
  try{
   if(external&&!await q(env,"SELECT 1 confirmed FROM inventory_shipment_events WHERE shipment_id=? AND client_id=? AND event_type='jt_cancellation_received' LIMIT 1",s.id,clientId).first()){const result=await carrier.cancel(env,clientId,s.txlogistic_id,reason);if(!result?.ok)fail('JT_CANCEL_REJECTED','J&T لم تؤكد إلغاء الشحنة',502);await atomic(env,[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND lock_token=?)',[s.id,token]),audit(env,s,'jt_cancellation_received',actor,{reason,carrierConfirmed:true})]);}
   const units=await rows(env,s),steps=[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND lock_token=? AND handover_batch_id IS NULL)',[s.id,token])];
   for(const u of units){steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id=? AND status IN ('reserved','packed'))",[u.id,clientId,s.order_id]),q(env,"UPDATE inventory_units SET status='reserved',updated_at=? WHERE id=? AND client_id=?",time(),u.id,clientId),q(env,"UPDATE order_unit_allocations SET status='reserved',updated_at=? WHERE id=? AND client_id=?",time(),u.allocation_id,clientId),unitAudit(env,s,u,'partial_shipment_cancelled',actor,'reserved'));}
   if(s.packing_session_id)steps.push(q(env,"UPDATE inventory_scan_sessions SET status='cancelled',updated_at=? WHERE id=?",time(),s.packing_session_id));
   steps.push(q(env,"UPDATE inventory_shipments SET status='cancelled',lock_token=NULL,lock_until=NULL,updated_at=? WHERE id=?",time(),s.id),q(env,'UPDATE inventory_shipment_units SET cancelled_at=? WHERE shipment_id=?',time(),s.id),audit(env,s,external?'jt_cancellation_confirmed':'plan_cancelled',actor,{reason,carrierConfirmed:external}));await atomic(env,steps);return {ok:true,status:'cancelled',orderReservationPreserved:true,carrierConfirmed:external};
  }catch(e){await q(env,'UPDATE inventory_shipments SET lock_token=NULL,lock_until=NULL WHERE id=? AND lock_token=?',s.id,token).run();throw e;}
 }
 if(path===base+'/create-waybill'||path===base+'/print'){
  const create=path.endsWith('create-waybill');requirePermission(me,'shipping',create?'write':'print');
  if(create&&s.awb)return {ok:true,idempotent:true,shipment:s};
  if(create?!['planned','waybill_pending'].includes(s.status):!s.awb||!['waybill_created','printed','packing','packed','handed_over'].includes(s.status))fail('SHIPMENT_STAGE','الشحنة ليست في المرحلة المطلوبة');
  if(!create&&s.printed_at){requirePermission(me,'shipping','reprint');if(!String(body.reason||'').trim())fail('REPRINT_REASON_REQUIRED','سبب إعادة طباعة البوليصة مطلوب',400);}
  const token=uid(),until=new Date(Date.now()+120000).toISOString();await atomic(env,[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status=? AND (lock_token IS NULL OR lock_until<?))',[s.id,s.status,time()]),q(env,"UPDATE inventory_shipments SET status=CASE WHEN ?=1 THEN 'waybill_pending' ELSE status END,lock_token=?,lock_until=?,updated_at=? WHERE id=?",create?1:0,token,until,time(),s.id)]);
  try{
   const result=create?await carrier.create(env,clientId,{...JSON.parse(s.shipment_json),quantity:(await rows(env,s)).length,codAmount:s.cod_minor/100,customerOrderNo:s.txlogistic_id,orderId:s.order_id,orderRef:s.order_id}):await carrier.print(env,clientId,s.awb);
   if(create&&!String(result.awb||'').trim())fail('JT_AWB_MISSING','J&T لم ترجع رقم بوليصة حقيقي',502);
   const steps=[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND lock_token=?)',[s.id,token])];
   if(create)steps.push(q(env,"UPDATE inventory_shipments SET awb=?,sorting_code=?,status='waybill_created',updated_at=?,lock_token=NULL,lock_until=NULL WHERE id=?",result.awb,result.sortingCode||'',time(),s.id));
   else steps.push(q(env,"UPDATE inventory_shipments SET label_url=?,printed_at=COALESCE(printed_at,?),status=CASE WHEN status='waybill_created' THEN 'printed' ELSE status END,updated_at=?,lock_token=NULL,lock_until=NULL WHERE id=?",result.url,time(),time(),s.id));
   steps.push(audit(env,s,create?'jt_waybill_created':s.printed_at?'jt_label_reprinted':'jt_label_printed',actor,{awb:result.awb||s.awb,official:true,reason:body.reason||''}));await atomic(env,steps);return {ok:true,shipment:await load(env,clientId,storeId,s.id),url:result.url||null,official:true};
  }catch(e){await q(env,'UPDATE inventory_shipments SET lock_token=NULL,lock_until=NULL WHERE id=? AND lock_token=?',s.id,token).run();throw e;}
 }
 if(path===base+'/pack/unit'||path===base+'/pack/undo'){
  if(s.status!=='packing')fail('SHIPMENT_PACK_CLOSED','جلسة التجهيز غير مفتوحة');const units=await rows(env,s),u=units.find(x=>x.unit_code===decodeUnitCode(body.code));if(!u)fail('SHIPMENT_WRONG_UNIT','القطعة لا تطابق قطع الشحنة أو SKU/Variant المطلوب');
  const undo=path.endsWith('undo');if(undo?!u.scanned_at:!!u.scanned_at)fail('DUPLICATE_SCAN','المسح مكرر أو غير موجود');if(u.status!=='reserved'||u.current_order_id!==s.order_id||u.product_id!==u.planned_product||(u.variant_id||null)!==(u.planned_variant||null))fail('SHIPMENT_UNIT_CHANGED','القطعة تغيرت بعد خطة الشحن');
  const scanSteps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status='packing') AND EXISTS(SELECT 1 FROM inventory_shipment_units WHERE shipment_id=? AND unit_id=? AND scanned_at IS ? AND cancelled_at IS NULL) AND EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND status='reserved' AND current_order_id=? AND updated_at=?)",[s.id,s.id,u.id,u.scanned_at||null,u.id,s.order_id,u.updated_at]),q(env,'UPDATE inventory_shipment_units SET scanned_at=? WHERE shipment_id=? AND unit_id=?',undo?null:time(),s.id,u.id)];
  if(undo)scanSteps.push(q(env,"UPDATE inventory_scan_events SET result='undone' WHERE session_id=? AND unit_id=? AND scan_kind='unit' AND result='accepted'",s.packing_session_id,u.id));
  else scanSteps.push(q(env,"INSERT INTO inventory_scan_events(id,session_id,client_id,store_id,order_id,unit_id,unit_code,scan_context,scan_kind,result,awb,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,'packing','unit','accepted',?,?,?,?)",uid(),s.packing_session_id,clientId,s.store_id,s.order_id,u.id,u.unit_code,s.awb,actor,JSON.stringify({shipmentId:s.id}),time()));
  scanSteps.push(q(env,"UPDATE inventory_scan_sessions SET scanned_units=(SELECT COUNT(*) FROM inventory_shipment_units WHERE shipment_id=? AND scanned_at IS NOT NULL AND cancelled_at IS NULL),updated_at=? WHERE id=?",s.id,time(),s.packing_session_id),unitAudit(env,s,u,undo?'shipment_scan_undone':'shipment_piece_scanned',actor));await atomic(env,scanSteps);
  return {ok:true,scanned:units.filter(x=>x.scanned_at).length+(undo?-1:1),expected:units.length};
 }
 if(path===base+'/pack/complete'){
  if(s.status==='packed')return {ok:true,idempotent:true};if(s.status!=='packing')fail('SHIPMENT_PACK_CLOSED','افتح جلسة التجهيز بمسح البوليصة أولًا');const units=await rows(env,s);if(!units.length||units.some(u=>!u.scanned_at))fail('PACKING_INCOMPLETE','امسح كل قطع الشحنة أولًا');
  const steps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status='packing') AND NOT EXISTS(SELECT 1 FROM inventory_shipment_units WHERE shipment_id=? AND cancelled_at IS NULL AND scanned_at IS NULL)",[s.id,s.id])];
  for(const u of units)steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND status='reserved' AND current_order_id=? AND updated_at=?)",[u.id,s.order_id,u.updated_at]),q(env,"UPDATE inventory_units SET status='packed',updated_at=? WHERE id=?",time(),u.id),q(env,"UPDATE order_unit_allocations SET status='packed',updated_at=? WHERE id=? AND client_id=?",time(),u.allocation_id,clientId),unitAudit(env,s,u,'partial_shipment_packed',actor,'packed'));
  steps.push(q(env,"UPDATE inventory_scan_sessions SET status='completed',completed_at=?,updated_at=? WHERE id=?",time(),time(),s.packing_session_id),q(env,"UPDATE inventory_shipments SET status='packed',updated_at=? WHERE id=?",time(),s.id),audit(env,s,'packing_completed',actor,{count:units.length}));await atomic(env,steps);return {ok:true,status:'packed',shipmentId:s.id};
 }
 fail('SHIPMENT_ROUTE_UNKNOWN','المسار غير موجود',404);
}
export async function partialHandoverScan(env,{clientId,storeId,batchId,code,actor}){
 const s=await q(env,'SELECT * FROM inventory_shipments WHERE client_id=? AND awb=?',clientId,String(code||'').trim()).first();if(!s)return null;assertUnitStore(s,storeId);
 const b=assertUnitStore(await q(env,'SELECT * FROM inventory_handover_batches WHERE id=? AND client_id=?',batchId,clientId).first(),storeId);
 if(b.status!=='open'||s.status!=='packed'||!s.printed_at||s.handover_batch_id)fail('SHIPMENT_NOT_READY','الشحنة غير جاهزة للتسليم أو سبق إضافتها');
 await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_handover_batches WHERE id=? AND status='open') AND EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status='packed' AND handover_batch_id IS NULL)",[b.id,s.id]),q(env,'UPDATE inventory_shipments SET handover_batch_id=?,updated_at=? WHERE id=?',b.id,time(),s.id),audit(env,s,'handover_waybill_scanned',actor,{batchId:b.id})]);return {ok:true,shipmentId:s.id,awb:s.awb};
}
export async function partialHandoverSteps(env,b,actor){
 const shipments=(await q(env,'SELECT * FROM inventory_shipments WHERE client_id=? AND handover_batch_id=?',b.client_id,b.id).all()).results||[],steps=[];let count=0;
 for(const s of shipments){if(s.status!=='packed')fail('SHIPMENT_NOT_READY','إحدى الشحنات لم تعد جاهزة');const units=await rows(env,s);if(!units.length)fail('SHIPMENT_EMPTY','الشحنة بلا قطع');steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_shipments WHERE id=? AND status='packed' AND handover_batch_id=?)",[s.id,b.id]));
  for(const u of units){steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id=? AND status='packed')",[u.id,b.client_id,s.order_id]),q(env,"UPDATE inventory_units SET status='shipped',shipped_at=?,updated_at=? WHERE id=?",time(),time(),u.id),q(env,"UPDATE order_unit_allocations SET status='shipped',updated_at=? WHERE id=? AND client_id=?",time(),u.allocation_id,b.client_id),unitAudit(env,s,u,'handed_to_shipping',actor,'shipped'));count++;}
  steps.push(q(env,"UPDATE inventory_shipments SET status='handed_over',handed_over_at=?,updated_at=? WHERE id=?",time(),time(),s.id),audit(env,s,'physical_handover',actor,{batchId:b.id,count:units.length}));
 }
 return {steps,count,shipments};
}
export async function partialManifest(env,b){const shipments=(await q(env,'SELECT id shipment_id,order_id,awb,status,cod_minor FROM inventory_shipments WHERE client_id=? AND handover_batch_id=?',b.client_id,b.id).all()).results||[],units=[];for(const s of shipments)for(const u of await rows(env,{id:s.shipment_id,client_id:b.client_id,status:s.status}))units.push({...u,order_id:s.order_id,awb:s.awb,shipment_id:s.shipment_id});return {shipments,units};}
