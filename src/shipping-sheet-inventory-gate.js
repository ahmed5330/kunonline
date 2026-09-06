import {requirePermission} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {prepareOrderStockTransition,resetOrderStockAllocationForRepair,finalizeHistoricalReturnedInventoryBackfill} from './inventory-fifo.js';

const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const num=value=>Number(value)||0;
const stamp=()=>new Date().toISOString();
const parseArray=value=>{try{const data=typeof value==='string'?JSON.parse(value||'[]'):value;return Array.isArray(data)?data:[];}catch{return [];}};
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});
const fail=(message,status=409,code='SHIPPING_SHEET_INVENTORY_BLOCKED')=>{throw Object.assign(new Error(message),{status,code});};
const BLOCK='shipping_sheet_inventory_blocked',RESOLVED='shipping_sheet_inventory_resolved';
const SHEET_TARGETS=new Set(['shipped','delivered','returned']);
const PREALLOCATION_STATES={
  shipped:new Set(['confirmed','preparing','shipped']),
  delivered:new Set(['confirmed','preparing','shipped','signed','collected']),
  returned:new Set(['confirmed','preparing','shipped','signed','returned'])
};

function safeFinancials(value={}){
  if(!value||typeof value!=='object')return null;
  const out={};for(const key of ['provider','carrierName','sheetType','awb','status','codAmount','shippingCost','codServiceFee','insuranceFee','fuelSurcharge','boxPrice','eventTime','returnReason','sourceFile'])if(value[key]!==undefined&&value[key]!==null&&value[key]!=='')out[key]=typeof value[key]==='string'?clean(value[key],500):value[key];
  return Object.keys(out).length?out:null;
}
export function sanitizeShippingSheetPending(value={}){
  const target=clean(value.target,20).toLowerCase(),flow=clean(value.flow,40)||'shipping-sheet';
  const pending={target:SHEET_TARGETS.has(target)?target:'',flow,shippingCost:value.shippingCost===undefined||value.shippingCost===null||value.shippingCost===''?null:Number(value.shippingCost),reason:clean(value.reason,1000)||null,sourceFile:clean(value.sourceFile,180)||null,carrierName:clean(value.carrierName,100)||null,carrierFinancials:safeFinancials(value.carrierFinancials)};
  if(value.returnBody&&typeof value.returnBody==='object')pending.returnBody={returnType:clean(value.returnBody.returnType||value.returnBody.return_type,30)||'full',reason:clean(value.returnBody.reason||value.returnBody.outcomeReason,1000)||pending.reason||'مرتجع حسب شيت شركة الشحن',outcomeReason:clean(value.returnBody.outcomeReason||value.returnBody.reason,1000)||pending.reason||'مرتجع حسب شيت شركة الشحن',sourceSection:'post-shipping-sheet'};
  return pending;
}
function pendingSignature(value){const p=sanitizeShippingSheetPending(value);return JSON.stringify(p);}
export function latestShippingSheetInventoryBlock(historyValue){
  const history=parseArray(historyValue);for(let i=history.length-1;i>=0;i--){const item=history[i];if(item?.type===RESOLVED)return null;if(item?.type===BLOCK)return item;}return null;
}
export function latestCarrierFinancials(historyValue){const history=parseArray(historyValue);for(let i=history.length-1;i>=0;i--)if(history[i]?.type==='carrier_financials')return history[i];return null;}

async function orderSnapshot(env,{clientId,orderId}){
  const order=await env.DB.prepare('SELECT id,client_id,store_id,state,product,product_id,variant_id,qty,ref,awb,history,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!order)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  const [{results:items=[]},{results:allocations=[]},legacy]=await Promise.all([
    env.DB.prepare('SELECT id,product_id,variant_id,product_name,variant_label,qty FROM order_items WHERE order_id=? AND client_id=? AND qty>0 ORDER BY created_at,id').bind(orderId,clientId).all().catch(()=>({results:[]})),
    env.DB.prepare("SELECT order_item_id,product_id,variant_id,qty,status FROM order_item_stock_allocations WHERE order_id=? AND client_id=? AND status IN ('allocated','returned','released') ORDER BY created_at,id").bind(orderId,clientId).all().catch(()=>({results:[]})),
    env.DB.prepare("SELECT product_id,variant_id,qty,status FROM order_stock_allocations WHERE order_id=? AND client_id=? AND status IN ('allocated','returned','released')").bind(orderId,clientId).first().catch(()=>null)
  ]);
  return {order,items,allocations,legacy};
}
function inventoryCoverage(snapshot,{historicalReturned=false}={}){
  const {order,items,allocations,legacy}=snapshot,statuses=historicalReturned?new Set(['returned']):new Set(['allocated']);
  if(items.length){
    const missing=items.find(line=>!clean(line.product_id));if(missing)return {linked:false,complete:false,any:false,reason:`المنتج «${clean(missing.product_name)||'غير معروف'}» غير مربوط بمنتج/متغير في المخزون`};
    let any=false;const shortages=[];
    for(const line of items){const needed=Math.max(1,num(line.qty)||1),covered=allocations.filter(row=>clean(row.order_item_id)===clean(line.id)&&statuses.has(clean(row.status))).reduce((sum,row)=>sum+num(row.qty),0);if(covered>0)any=true;if(covered<needed)shortages.push({item:clean(line.product_name)||line.product_id,needed,covered});}
    if(shortages.length){const first=shortages[0];return {linked:true,complete:false,any,shortages,reason:`الأوردر غير مسمّع بالكامل في المخزون: «${first.item}» المطلوب ${first.needed} والمسمّع ${first.covered}`};}
    return {linked:true,complete:true,any:true,shortages:[]};
  }
  if(!clean(order.product_id))return {linked:false,complete:false,any:false,reason:'الأوردر غير مربوط بمنتج في المخزون'};
  const needed=Math.max(1,num(order.qty)||1),lineRows=allocations.filter(row=>statuses.has(clean(row.status))),covered=lineRows.length?lineRows.reduce((sum,row)=>sum+num(row.qty),0):(legacy&&statuses.has(clean(legacy.status))?num(legacy.qty):0);
  return covered>=needed?{linked:true,complete:true,any:covered>0,shortages:[]}:{linked:true,complete:false,any:covered>0,shortages:[{item:clean(order.product)||order.product_id,needed,covered}],reason:`الأوردر غير مسمّع بالكامل في المخزون: المطلوب ${needed} والمسمّع ${covered}`};
}
async function appendHistory(env,{clientId,orderId,event}){
  const row=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)return null;const history=parseArray(row.history);history.push(event);await env.DB.prepare('UPDATE orders SET history=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),orderId,clientId).run();return event;
}
async function persistBlock(env,{snapshot,clientId,orderId,me,pending,reason,code}){
  const latest=latestShippingSheetInventoryBlock(snapshot.order.history),safePending=sanitizeShippingSheetPending(pending),signature=pendingSignature(safePending),safeReason=clean(reason,1000)||'الأوردر غير مسمّع في المخزون';
  if(latest&&clean(latest.code)===clean(code)&&clean(latest.reason)===safeReason&&clean(latest.pendingSignature)===signature)return latest;
  const event={type:BLOCK,at:stamp(),code:clean(code,80)||'SHIPPING_SHEET_INVENTORY_BLOCKED',reason:safeReason,pending:safePending,pendingSignature:signature,...actor(me)};
  await appendHistory(env,{clientId,orderId,event});return event;
}
async function throwBlocked(env,args){const event=await persistBlock(env,args),error=new Error(event.reason);error.status=409;error.code=clean(event.code,80)||'SHIPPING_SHEET_INVENTORY_BLOCKED';error.inventoryBlocked=true;error.inventoryBlock={code:event.code,reason:event.reason,at:event.at,pending:event.pending};throw error;}

async function accessOrder(env,{clientId,orderId,me}){
  requirePermission(me,'orders','update');const row=await env.DB.prepare('SELECT id,store_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');await resolveStoreScope(env,me,clientId,clean(row.store_id)||null,{write:true});return row;
}
function assertPreallocationState(order,target){
  const state=clean(order?.state,30),allowed=PREALLOCATION_STATES[target];if(allowed?.has(state))return;
  if(target==='returned'&&state==='collected')fail('الأوردر تم تحصيله بالفعل ويحتاج مراجعة يدوية قبل تسجيل المرتجع',409,'SHIPPING_SHEET_COLLECTED_RETURN_REVIEW');
  fail(`حالة الأوردر «${state||'غير معروفة'}» لا تسمح بمزامنة ${target} من شيت الشحن`,409,'SHIPPING_SHEET_STATE_INVALID');
}

export async function gateShippingSheetInventory(env,{clientId,orderId,me,pending={}}={}){
  const safePending=sanitizeShippingSheetPending(pending),target=safePending.target;if(!SHEET_TARGETS.has(target))fail('هدف شيت الشحن غير صحيح',400,'SHIPPING_SHEET_TARGET_INVALID');
  const access=await accessOrder(env,{clientId,orderId,me});let snapshot=await orderSnapshot(env,{clientId,orderId}),order=snapshot.order;
  const historicalReturned=target==='returned'&&clean(order.state)==='returned';let coverage=inventoryCoverage(snapshot,{historicalReturned});
  if(coverage.complete)return {ok:true,orderId,storeId:access.store_id||null,target,inventorySynced:true,historicalReturned,coverage};
  // State/race validation must happen before partial repair or new FIFO allocation. A stale sheet can never consume stock first and fail state settlement second.
  assertPreallocationState(order,target);

  // A partial active allocation is unsafe: restore it first, then perform one clean FIFO allocation for the current order lines.
  const activeCoverage=inventoryCoverage(snapshot,{historicalReturned:false});
  if(activeCoverage.any&&!activeCoverage.complete){await resetOrderStockAllocationForRepair(env,{clientId,orderId,actor:me});snapshot=await orderSnapshot(env,{clientId,orderId});order=snapshot.order;coverage=inventoryCoverage(snapshot,{historicalReturned});if(coverage.complete)return {ok:true,orderId,storeId:access.store_id||null,target,inventorySynced:true,repairedPartial:true,coverage};}

  const linkCheck=inventoryCoverage(snapshot,{historicalReturned:false});
  if(!linkCheck.linked)return throwBlocked(env,{snapshot,clientId,orderId,me,pending:safePending,reason:linkCheck.reason,code:'ORDER_INVENTORY_NOT_LINKED'});
  try{
    const allocation=await prepareOrderStockTransition(env,{clientId,storeId:clean(order.store_id)||clean(access.store_id),orderId,fromState:order.state,toState:'confirmed',actor:me});
    if(allocation?.reason==='inventory-not-reviewed')return throwBlocked(env,{snapshot,clientId,orderId,me,pending:safePending,reason:'راجع ربط منتجات الأوردر بالمخزون أولًا',code:'ORDER_INVENTORY_NOT_REVIEWED'});
    if(historicalReturned)await finalizeHistoricalReturnedInventoryBackfill(env,{clientId,orderId,actor:me});
  }catch(error){
    if(error?.inventoryBlocked)throw error;
    const fresh=await orderSnapshot(env,{clientId,orderId});return throwBlocked(env,{snapshot:fresh,clientId,orderId,me,pending:safePending,reason:error?.message||'تعذر تخصيص المخزون للأوردر',code:error?.code||'ORDER_INVENTORY_ALLOCATION_FAILED'});
  }
  snapshot=await orderSnapshot(env,{clientId,orderId});coverage=inventoryCoverage(snapshot,{historicalReturned});
  if(!coverage.complete)return throwBlocked(env,{snapshot,clientId,orderId,me,pending:safePending,reason:coverage.reason||'تعذر تأكيد تخصيص كل كميات الأوردر من المخزون',code:'ORDER_INVENTORY_COVERAGE_INCOMPLETE'});
  return {ok:true,orderId,storeId:access.store_id||null,target,inventorySynced:true,allocatedNow:true,historicalReturned,coverage};
}

export async function markShippingSheetInventoryResolved(env,{clientId,orderId,me,note='تمت مزامنة المخزون واستكمال نتيجة شيت شركة الشحن'}={}){
  const row=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)return null;const block=latestShippingSheetInventoryBlock(row.history);if(!block)return null;
  const event={type:RESOLVED,at:stamp(),blockedAt:block.at||null,target:block.pending?.target||null,note:clean(note,500),...actor(me)};await appendHistory(env,{clientId,orderId,event});return event;
}
export async function pendingShippingSheetInventoryBlock(env,{clientId,orderId}={}){const row=await env.DB.prepare('SELECT history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();return row?latestShippingSheetInventoryBlock(row.history):null;}

function redactedOrder(order,block){
  const reason=clean(block?.reason,1000)||'الأوردر موقوف لحين تصحيح المخزون';
  return {...order,name:'🔒 بيانات محجوبة — موقوف مخزنيًا',phone:'',gov:'',address:'',product:'بيانات المنتج محجوبة لحين حل مشكلة المخزون',productNote:'',qty:null,unitPrice:null,total:null,collectedAmount:null,customerNote:'',latestInternalNote:'',internalNotes:[],contactLog:[],history:block?[block]:[],inventoryBlocked:true,inventoryBlockReason:reason,inventoryBlockCode:block?.code||'SHIPPING_SHEET_INVENTORY_BLOCKED',inventoryBlockAt:block?.at||null,inventoryPendingTarget:block?.pending?.target||null,inventoryBlock:{reason,code:block?.code||'SHIPPING_SHEET_INVENTORY_BLOCKED',at:block?.at||null,pending:block?.pending||null}};
}
export function decorateShippingSheetInventoryBlocks(payload){
  if(!payload||!Array.isArray(payload.orders))return payload;
  return {...payload,orders:payload.orders.map(order=>{const block=latestShippingSheetInventoryBlock(order.history),carrier=latestCarrierFinancials(order.history),expected=carrier?.sheetType==='delivered'&&Number.isFinite(Number(carrier.expectedNet))?Number(carrier.expectedNet):null;const enriched={...order,expectedCarrierCollection:expected,carrierCodAmount:carrier?.codAmount??null,carrierTotalFees:carrier?.totalCarrierFees??null,carrierName:carrier?.carrierName||null};return block?redactedOrder(enriched,block):enriched;})};
}

export const shippingSheetInventoryEventTypes={blocked:BLOCK,resolved:RESOLVED};