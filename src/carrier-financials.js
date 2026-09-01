import {listMyStores} from './store-scope.js';

const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const parseArray=value=>{try{const data=JSON.parse(value||'[]');return Array.isArray(data)?data:[];}catch{return [];}};
const n=value=>Number(value)||0;
const r2=value=>Math.round(n(value)*100)/100;
const fail=(message,status=400,code='CARRIER_FINANCIALS_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});

function nonNegative(value,label){
  if(value===undefined||value===null||value==='')return 0;
  const number=Number(value);
  if(!Number.isFinite(number)||number<0)fail(`${label} غير صحيح`,400,'CARRIER_FEE_INVALID');
  return r2(number);
}
function latestProviderEvent(history,provider){
  for(let i=history.length-1;i>=0;i--){const item=history[i];if(item?.type==='carrier_financials'&&clean(item.provider,40)===provider)return item;}
  return null;
}
function ancillaryOf(event={}){
  if(Number.isFinite(Number(event.ancillaryFee)))return r2(event.ancillaryFee);
  return r2(n(event.codServiceFee)+n(event.insuranceFee)+n(event.fuelSurcharge)+n(event.boxPrice));
}

export function carrierFinancialMath({sheetType='delivered',codAmount=0,shippingCost=0,codServiceFee=0,insuranceFee=0,fuelSurcharge=0,boxPrice=0}={}){
  const shipping=r2(shippingCost),codFee=r2(codServiceFee),insurance=r2(insuranceFee),fuel=r2(fuelSurcharge),box=r2(boxPrice),ancillaryFee=r2(codFee+insurance+fuel+box),totalCarrierFees=r2(shipping+ancillaryFee),cod=r2(codAmount),expectedNet=sheetType==='returned'?r2(-totalCarrierFees):r2(cod-totalCarrierFees);
  return {codAmount:cod,shippingCost:shipping,codServiceFee:codFee,insuranceFee:insurance,fuelSurcharge:fuel,boxPrice:box,ancillaryFee,totalCarrierFees,expectedNet};
}

async function writableOrder(env,{clientId,orderId,me}){
  if(!ALLOWED_ROLES.has(me?.role))fail('غير مسموح بتحديث تكاليف شركة الشحن',403,'CARRIER_FINANCIALS_ROLE_DENIED');
  const context=await listMyStores(env,me,clientId),stores=context.stores||[],row=await env.DB.prepare('SELECT id,client_id,store_id,state,awb,shipping_cost,other_cost,history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(!context.allStores){const store=stores.find(item=>String(item.id)===String(row.store_id||''));if(!store)fail('الأوردر خارج المتاجر المسموح بها',403,'STORE_ISOLATION');if(store.role==='viewer')fail('صلاحية هذا المتجر للعرض فقط',403,'STORE_READ_ONLY');}
  return row;
}

export async function recordCarrierFinancials(env,{clientId,orderId,me,body={}}){
  const row=await writableOrder(env,{clientId,orderId,me}),provider=clean(body.provider||'carrier',40).toLowerCase(),carrierName=clean(body.carrierName||body.provider||'شركة الشحن',100),sheetType=clean(body.sheetType,20);
  if(!['delivered','returned'].includes(sheetType))fail('نوع شيت شركة الشحن غير صحيح',400,'CARRIER_SHEET_TYPE_INVALID');
  const values={
    sheetType,
    codAmount:nonNegative(body.codAmount,'قيمة COD'),
    shippingCost:nonNegative(body.shippingCost,'تكلفة الشحن'),
    codServiceFee:nonNegative(body.codServiceFee,'عمولة التحصيل'),
    insuranceFee:nonNegative(body.insuranceFee,'رسوم التأمين'),
    fuelSurcharge:nonNegative(body.fuelSurcharge,'رسوم الوقود'),
    boxPrice:nonNegative(body.boxPrice,'رسوم العبوة')
  },financials=carrierFinancialMath(values),history=parseArray(row.history),previous=latestProviderEvent(history,provider),previousAncillary=ancillaryOf(previous),baseOther=r2(n(row.other_cost)-previousAncillary),nextOther=r2(baseOther+financials.ancillaryFee),at=new Date().toISOString(),entry={
    type:'carrier_financials',provider,carrierName,sheetType,
    awb:clean(body.awb||row.awb,120)||null,status:clean(body.status,100)||null,
    ...financials,
    eventTime:clean(body.eventTime,80)||null,returnReason:clean(body.returnReason,500)||null,sourceFile:clean(body.sourceFile,180)||null,
    note:sheetType==='returned'?`${carrierName}: مرتجع — تكلفة شركة الشحن ${financials.totalCarrierFees}`:`${carrierName}: تم التسليم — شحن ${financials.shippingCost} + عمولة تحصيل ${financials.codServiceFee}`,
    at,...actor(me)
  };
  history.push(entry);
  const awb=clean(body.awb,120)||row.awb||null;
  await env.DB.prepare('UPDATE orders SET awb=?,shipping_cost=?,other_cost=?,history=? WHERE id=? AND client_id=?').bind(awb,financials.shippingCost,nextOther,JSON.stringify(history),orderId,clientId).run();
  try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,row.store_id||null,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user','order.carrier_financials','order',orderId,JSON.stringify({shippingCost:row.shipping_cost,otherCost:row.other_cost,previousCarrierAncillary:previousAncillary}),JSON.stringify({shippingCost:financials.shippingCost,otherCost:nextOther,carrierFinancials:financials}),JSON.stringify({provider,carrierName,sheetType,sourceFile:entry.sourceFile}),at).run();}catch{}
  return {ok:true,id:orderId,provider,carrierName,sheetType,shippingCost:financials.shippingCost,otherCost:nextOther,manualOtherCost:baseOther,financials,history};
}
