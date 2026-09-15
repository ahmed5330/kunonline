import {jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';

export const CANCEL_ORDER_PATH='/webopenplatformapi/api/order/cancelOrder';
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);

export async function cancelJtShipment({txlogisticId,reason='Kun Online cancellation',secrets,fetcher=fetch}){
  const id=clean(txlogisticId,160),why=clean(reason,500)||'Kun Online cancellation';
  if(!id)throw Object.assign(new Error('رقم طلب J&T / txlogisticId مطلوب للإلغاء'),{status:400,code:'JT_TXLOGISTIC_ID_REQUIRED'});
  const {fields,missing,enterpriseReady}=jtCredentials(secrets||{});
  if(missing.length)throw Object.assign(new Error('بيانات J&T الأساسية غير مكتملة'),{status:409,code:'JT_CREDENTIALS_MISSING'});
  if(!enterpriseReady)throw Object.assign(new Error('إلغاء شحنة J&T يحتاج Customer Code وCustomer Password / API Password'),{status:409,code:'JT_BUSINESS_CREDENTIALS_MISSING',enterpriseCredentialsRequired:true});
  const payload=__jtApiInternals.withEnterprise({orderType:'1',txlogisticId:id,reason:why},fields);
  const result=await __jtApiInternals.signedPost(CANCEL_ORDER_PATH,payload,secrets,{fetcher});
  if(!__jtApiInternals.success(result))throw Object.assign(new Error(`J&T رفضت إلغاء الشحنة${result.code?` (${result.code})`:''}: ${result.message||`HTTP ${result.response.status}`}`),{status:result.response.status>=500?502:422,code:'JT_CANCEL_REJECTED',jtCode:result.code,jtResponse:result.data});
  return {ok:true,txlogisticId:id,reason:why,data:result.data,path:CANCEL_ORDER_PATH};
}
