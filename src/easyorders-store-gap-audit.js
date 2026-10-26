/* Tenant- and store-scoped READ-ONLY Easy Orders gap audit.
 * No D1 writes, webhook calls, cursor changes, management fee writes or
 * raw customer/provider error payloads in the response. Never infer that a
 * global "errorIntegrations:1" belongs to any particular named store.
 */
import {readConnectionSecrets} from './integration-provider-validation.js';

const clean=value=>String(value??'').trim();
const numeric=value=>Number.isSafeInteger(Number(value))?Number(value):NaN;
const providerUrl='https://api.easy-orders.net/api/v1/external-apps/orders/short/';

function invalid(code,message,status=400){
  return Object.assign(new Error(message),{code,status});
}
function rangeOf(fromShortId,toShortId){
  const start=numeric(fromShortId),end=numeric(toShortId);
  if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(end)||end<start||end-start>=30)
    throw invalid('EASYORDERS_AUDIT_RANGE_INVALID','حدد نطاق Short ID صحيحًا بحد أقصى 30 رقمًا');
  return {start,end};
}
export async function auditEasyOrdersStoreGapRange(env,{
  clientId,storeId,connectionId,fromShortId,toShortId,
  fetcher=fetch,readSecrets=readConnectionSecrets
}={}){
  const tenant=clean(clientId),store=clean(storeId),connection=clean(connectionId);
  if(!tenant||!store||!connection)
    throw invalid('EASYORDERS_AUDIT_SCOPE_REQUIRED','حدد العميل والمتجر والاتصال بشكل صريح');
  const {start,end}=rangeOf(fromShortId,toShortId);
  const row=await env.DB.prepare(
    "SELECT id,client_id,config_json,external_store_id FROM store_connections WHERE id=? AND client_id=? AND provider='easyorders' AND status='connected'"
  ).bind(connection,tenant).first();
  if(!row)throw invalid('EASYORDERS_AUDIT_CONNECTION_NOT_FOUND','اتصال Easy Orders غير موجود داخل هذا العميل',404);
  let config={};try{config=JSON.parse(row.config_json||'{}');}catch{
    throw invalid('EASYORDERS_AUDIT_CONFIG_INVALID','إعداد الاتصال غير قابل للقراءة',409);
  }
  if(clean(config.kunStoreId||config.storeId)!==store)
    throw invalid('EASYORDERS_AUDIT_STORE_MISMATCH','اتصال Easy Orders ليس مربوطًا بهذا المتجر',403);
  const external=clean(row.external_store_id);
  if(!external||external===connection||/^CON-/i.test(external))
    throw invalid('EASYORDERS_AUDIT_EXTERNAL_STORE_UNVERIFIED','يجب إثبات هوية متجر Easy Orders قبل الفحص',409);
  const secrets=await readSecrets(env,tenant,connection);
  const apiKey=clean(secrets?.api_key);
  if(!apiKey)throw invalid('EASYORDERS_AUDIT_KEY_MISSING','مفتاح قراءة Easy Orders غير متاح',409);
  const result={
    ok:true,mode:'read_only',clientId:tenant,storeId:store,connectionId:connection,
    startShortId:start,endShortId:end,requests:0,alreadyInKun:0,
    missingInKun:0,missingAtProvider:0,foreignStoreSkipped:0,
    ambiguousLegacyOrders:0,gaps:[],status:'complete',nextShortId:end+1,
    providerCreatedDays:{oldest:null,newest:null,datedOrders:0}
  };
  for(let shortId=start;shortId<=end;shortId++){
    let response;
    try{
      result.requests++;
      response=await fetcher(providerUrl+shortId,{
        method:'GET',headers:{Accept:'application/json','Api-Key':apiKey},
        redirect:'manual'
      });
    }catch{
      result.ok=false;result.status='provider_network_error';result.nextShortId=shortId;break;
    }
    if(response.status===429){
      result.ok=false;result.status='rate_limited';result.nextShortId=shortId;break;
    }
    if(response.status===404){result.missingAtProvider++;continue;}
    if(!response.ok){
      result.ok=false;
      result.status=response.status===401||response.status===403?'provider_forbidden':'provider_error';
      result.nextShortId=shortId;break;
    }
    let payload;
    try{payload=await response.json();}catch{
      result.ok=false;result.status='provider_payload_invalid';result.nextShortId=shortId;break;
    }
    const order=payload?.data?.id?payload.data:payload;
    const providerId=clean(order?.id),sourceStore=clean(order?.store_id||order?.storeId);
    // Do not mistake an incorrectly resolved provider Short ID for a genuine
    // missing Kun order. The real provider payload may omit short_id, but
    // when it supplies one it must match the exact requested ID.
    const returnedShort=order?.short_id??order?.shortId;
    if(returnedShort!==undefined&&returnedShort!==null&&
        (!Number.isSafeInteger(Number(returnedShort))||Number(returnedShort)!==shortId)){
      result.ok=false;result.status='provider_short_id_mismatch';
      result.nextShortId=shortId;break;
    }
    if(!providerId||!sourceStore){
      result.ok=false;result.status='provider_payload_invalid';result.nextShortId=shortId;break;
    }
    if(sourceStore!==external){result.foreignStoreSkipped++;continue;}
    // Date-only scope metadata is useful for separating pre-connection history
    // from incident-period gaps. Never return a customer payload or timestamp.
    const created=clean(order.created_at),day=/^\d{4}-\d{2}-\d{2}T/.test(created)&&Number.isFinite(Date.parse(created))?created.slice(0,10):null;
    if(day){
      const dates=result.providerCreatedDays;dates.datedOrders++;
      if(!dates.oldest||day<dates.oldest)dates.oldest=day;
      if(!dates.newest||day>dates.newest)dates.newest=day;
    }
    const {results:matches=[]}=await env.DB.prepare(
      'SELECT id,store_id FROM orders WHERE client_id=? AND (id=? OR ref=?) LIMIT 10'
    ).bind(tenant,providerId,`easyorders:${providerId}`).all();
    if(matches.some(x=>clean(x.store_id)===store)){result.alreadyInKun++;continue;}
    if(matches.some(x=>!clean(x.store_id))){
      // Do not count legacy unscoped records as safe to import.
      result.ambiguousLegacyOrders++;continue;
    }
    result.missingInKun++;
    result.gaps.push({shortId,sourceOrderId:providerId});
  }
  return result;
}
