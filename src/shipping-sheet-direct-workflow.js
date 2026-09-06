import {gateShippingSheetInventory,markShippingSheetInventoryResolved,sanitizeShippingSheetPending} from './shipping-sheet-inventory-gate.js';
import {markPostShippingDeliveredV47} from './post-shipping-v47.js';
import {finalizeHistoricalReturnedInventoryBackfill} from './inventory-fifo.js';
import {recordCarrierFinancials} from './carrier-financials.js';
import {reconcileManagementFeeForOrder} from './accounting.js';

const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const num=value=>Number(value)||0;
const parseArray=value=>{try{const parsed=typeof value==='string'?JSON.parse(value||'[]'):value;return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const stamp=()=>new Date().toISOString();
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});
const fail=(message,status=409,code='SHIPPING_SHEET_STATE_INVALID')=>{throw Object.assign(new Error(message),{status,code});};

async function orderRow(env,{clientId,orderId}){
  return env.DB.prepare('SELECT id,client_id,store_id,state,checkpoint,total,shipping_cost,history,return_type,refund_amount,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
}
async function audit(env,{row,me,action,before,after,metadata={}}){
  try{
    await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,row.client_id,row.store_id||null,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user',action,'order',row.id,JSON.stringify(before||{}),JSON.stringify(after||{}),JSON.stringify(metadata),stamp()).run();
  }catch{}
}
async function setShippingCost(env,{clientId,orderId,cost}){
  if(cost===undefined||cost===null||cost==='')return;
  const value=Number(cost);if(!Number.isFinite(value)||value<0)fail('تكلفة الشحن غير صحيحة',400,'SHIPPING_COST_INVALID');
  await env.DB.prepare('UPDATE orders SET shipping_cost=? WHERE id=? AND client_id=?').bind(Math.round(value*100)/100,orderId,clientId).run();
}
async function moveToShipped(env,{clientId,orderId,me}){
  const row=await orderRow(env,{clientId,orderId});if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(['shipped','signed','collected'].includes(clean(row.state)))return {state:row.state,changed:false};
  if(!['confirmed','preparing'].includes(clean(row.state)))fail('الأوردر لازم يكون مؤكد أو قيد التجهيز قبل تسجيل الشحن',409,'SHIPPING_SHEET_STATE_INVALID');
  const at=stamp(),history=parseArray(row.history),entry={type:'state',state:'shipped',at,note:'تم تسجيل جاري الشحن من شيت شركة الشحن',sourceSection:'post-shipping-sheet',...actor(me)};history.push(entry);
  const result=await env.DB.prepare("UPDATE orders SET state='shipped',checkpoint='جاري الشحن',history=? WHERE id=? AND client_id=? AND state IN ('confirmed','preparing')").bind(JSON.stringify(history),orderId,clientId).run();
  if(Number(result?.meta?.changes||0)!==1){const fresh=await orderRow(env,{clientId,orderId});if(!['shipped','signed','collected'].includes(clean(fresh?.state)))fail('حالة الأوردر اتغيرت أثناء مزامنة الشحن. أعد المحاولة.',409,'SHIPPING_SHEET_STATE_CONFLICT');return {state:fresh.state,changed:false};}
  await reconcileManagementFeeForOrder(env,orderId).catch(()=>{});
  await audit(env,{row,me,action:'order.shipping_sheet_shipped',before:{state:row.state,checkpoint:row.checkpoint},after:{state:'shipped',checkpoint:'جاري الشحن'},metadata:{source:'shipping_sheet'}});
  return {state:'shipped',changed:true};
}
async function moveToDelivered(env,{clientId,orderId,me}){
  let row=await orderRow(env,{clientId,orderId});if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(['returned','cancelled'].includes(clean(row.state)))fail('لا يمكن تسجيل تم التوصيل على أوردر مرتجع أو ملغي',409,'SHIPPING_SHEET_STATE_INVALID');
  if(!['confirmed','preparing','shipped','signed','collected'].includes(clean(row.state)))fail('حالة الأوردر لا تسمح بتسجيل التوصيل من شيت الشحن',409,'SHIPPING_SHEET_STATE_INVALID');
  if(['confirmed','preparing'].includes(clean(row.state))){await moveToShipped(env,{clientId,orderId,me});row=await orderRow(env,{clientId,orderId});}
  if(clean(row.state)==='shipped')await markPostShippingDeliveredV47(env,{clientId,orderId,me});
  await reconcileManagementFeeForOrder(env,orderId).catch(()=>{});
  row=await orderRow(env,{clientId,orderId});return {state:row?.state||'signed',changed:true};
}
async function moveToReturned(env,{clientId,orderId,me,pending,rawBody={}}){
  let row=await orderRow(env,{clientId,orderId});if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(clean(row.state)==='returned')return {state:'returned',changed:false};
  if(clean(row.state)==='collected')fail('الأوردر تم تحصيله بالفعل ويحتاج مراجعة يدوية قبل تسجيل المرتجع',409,'SHIPPING_SHEET_COLLECTED_RETURN_REVIEW');
  if(clean(row.state)==='cancelled')fail('الأوردر ملغي بالفعل',409,'SHIPPING_SHEET_STATE_INVALID');
  if(!['confirmed','preparing','shipped','signed'].includes(clean(row.state)))fail('حالة الأوردر لا تسمح بتسجيل المرتجع من شيت الشحن',409,'SHIPPING_SHEET_STATE_INVALID');

  const source=rawBody?.returnBody&&typeof rawBody.returnBody==='object'?rawBody.returnBody:rawBody,returnType=clean(source?.returnType||source?.return_type||pending?.returnBody?.returnType,30)||'full';
  if(!['full','partial','exchange'].includes(returnType))fail('نوع المرتجع غير صحيح',400,'RETURN_TYPE_INVALID');
  const reason=clean(source?.reason||source?.outcomeReason||pending?.reason||pending?.returnBody?.reason,1000)||'مرتجع حسب شيت شركة الشحن';
  let refundAmount=returnType==='full'?num(row.total):returnType==='exchange'?0:Number(source?.refundAmount??source?.refund_amount);
  if(returnType==='partial'&&(!Number.isFinite(refundAmount)||refundAmount<0))fail('اكتب قيمة الاسترداد للمرتجع الجزئي',400,'RETURN_REFUND_REQUIRED');
  if(!Number.isFinite(refundAmount)||refundAmount<0)refundAmount=0;

  // The shipping inventory gate guarantees a complete allocation trail first. Returning it here restores both
  // the FIFO lots and the visible product/variant stock exactly once, including repaired legacy orders.
  await finalizeHistoricalReturnedInventoryBackfill(env,{clientId,orderId,actor:me});
  row=await orderRow(env,{clientId,orderId});
  const at=stamp(),history=parseArray(row.history),classification=returnType==='exchange'?'exchange':'returned';
  history.push({type:'state',state:'returned',returnType,refundAmount:Math.round(refundAmount*100)/100,reason,outcomeReason:reason,sourceSection:'post-shipping-sheet',note:`${classification==='exchange'?'استبدال':'مرتجع'} حسب شيت شركة الشحن: ${reason}`,at,...actor(me)});
  history.push({type:'outcome_reason',state:'returned',outcomeState:'returned',classification,returnType,reason,outcomeReason:reason,sourceSection:'post-shipping-sheet',note:`${classification==='exchange'?'سبب الاستبدال':'سبب المرتجع'}: ${reason}`,at,...actor(me)});
  await env.DB.prepare("UPDATE orders SET state='returned',checkpoint='مرتجع',return_type=?,refund_amount=?,restocked=1,history=? WHERE id=? AND client_id=? AND state IN ('confirmed','preparing','shipped','signed')").bind(returnType,Math.round(refundAmount*100)/100,JSON.stringify(history),orderId,clientId).run();
  const fresh=await orderRow(env,{clientId,orderId});if(clean(fresh?.state)!=='returned')fail('حالة الأوردر اتغيرت أثناء تسجيل المرتجع. راجع الأوردر قبل إعادة المحاولة.',409,'SHIPPING_SHEET_STATE_CONFLICT');
  await reconcileManagementFeeForOrder(env,orderId).catch(()=>{});
  await audit(env,{row,me,action:'order.shipping_sheet_returned',before:{state:row.state,checkpoint:row.checkpoint,returnType:row.return_type,refundAmount:row.refund_amount},after:{state:'returned',checkpoint:'مرتجع',returnType,refundAmount:Math.round(refundAmount*100)/100},metadata:{source:'shipping_sheet',reason}});
  return {state:'returned',changed:true};
}

async function settleState(env,{clientId,orderId,me,pending,rawBody}){
  const row=await orderRow(env,{clientId,orderId});if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');const target=pending.target;
  if(target==='shipped'){
    if(['signed','collected','returned','cancelled'].includes(clean(row.state)))fail('لا يمكن إرجاع الأوردر لحالة جاري الشحن من حالته الحالية',409,'SHIPPING_SHEET_STATE_INVALID');
    return moveToShipped(env,{clientId,orderId,me});
  }
  if(target==='delivered')return moveToDelivered(env,{clientId,orderId,me});
  if(target==='returned')return moveToReturned(env,{clientId,orderId,me,pending,rawBody});
  fail('نوع نتيجة شيت الشحن غير مدعوم',400,'SHIPPING_SHEET_TARGET_INVALID');
}

export async function applyShippingSheetWorkflowDirect(env,{clientId,orderId,me,body={}}={}){
  const target=clean(body.target||body.sheetType,20).toLowerCase(),pending=sanitizeShippingSheetPending({target,flow:'shipping-sheet-apply',shippingCost:body.shippingCost,reason:body.reason||body.outcomeReason,sourceFile:body.sourceFile,carrierName:body.carrierName,returnBody:body.returnBody||body,carrierFinancials:body.carrierFinancials});
  const inventory=await gateShippingSheetInventory(env,{clientId,orderId,me,pending});
  await setShippingCost(env,{clientId,orderId,cost:pending.shippingCost});
  const settled=await settleState(env,{clientId,orderId,me,pending,rawBody:body});
  let carrier=null;
  if(pending.carrierFinancials)carrier=await recordCarrierFinancials(env,{clientId,orderId,me,body:{...pending.carrierFinancials,sheetType:target==='returned'?'returned':'delivered'}});
  await reconcileManagementFeeForOrder(env,orderId).catch(()=>{});
  await markShippingSheetInventoryResolved(env,{clientId,orderId,me,note:target==='returned'?'تمت مزامنة المخزون وتسجيل المرتجع والحسابات من شيت الشحن':target==='delivered'?'تم خصم المخزون وتسجيل التوصيل والمستحقات من شيت الشحن':'تم خصم المخزون وتسجيل جاري الشحن من الشيت'});
  const fresh=await orderRow(env,{clientId,orderId});
  return {ok:true,id:orderId,target,state:fresh?.state||settled.state,inventorySynced:true,inventoryAlreadySynced:Boolean(inventory?.alreadySynced||(!inventory?.allocatedNow&&inventory?.coverage?.complete)),inventoryAllocatedNow:Boolean(inventory?.allocatedNow),carrierFinancials:carrier?.financials||null,expectedCarrierCollection:carrier?.financials?.expectedNet??null,directSettlement:true};
}
