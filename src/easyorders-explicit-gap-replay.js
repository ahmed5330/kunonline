/* Feature-gated, targeted historical Easy Orders recovery.
 *
 * Unlike the scheduled cursor-based recovery, this operation never rewrites
 * a shared cursor or high-water mark. It only imports provider orders missing
 * from the exact verified Kun tenant/store. It is DISABLED until an operator
 * explicitly enables EASYORDERS_TARGETED_RECOVERY_ENABLED after a real D1 backup
 * and deployment inventory. No client input can enable this feature flag.
 */
import {readConnectionSecrets} from './integration-provider-validation.js';
import {easyOrdersWebhookPath,handleEasyOrdersWebhook} from './commerce-order-sync.js';
import {reconcileManagementFeeForOrder} from './accounting.js';

const clean=x=>String(x??'').trim();
function failure(code,message,status=400){return Object.assign(new Error(message),{code,status});}
function validatedIds(raw){
  if(!Array.isArray(raw)||raw.length<1||raw.length>10)
    throw failure('EASYORDERS_REPLAY_SHORT_IDS_INVALID','حدد من 1 إلى 10 أرقام Short ID صريحة');
  const ids=raw.map(x=>Number(x));
  if(ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)
    throw failure('EASYORDERS_REPLAY_SHORT_IDS_INVALID','أرقام Short ID يجب أن تكون موجبة وغير مكررة');
  return ids;
}
async function importCanonical(env,connection,secrets,order){
  const path=await easyOrdersWebhookPath(env,connection);
  const routeToken=decodeURIComponent(path.split('/').filter(Boolean).at(-1)||'');
  const headers={'Content-Type':'application/json'};
  const webhookSecret=clean(secrets.webhook_secret||env.EASYORDERS_WEBHOOK_SECRET);
  if(webhookSecret)headers.secret=webhookSecret;
  return handleEasyOrdersWebhook(new Request('https://kun-gap-recovery.internal'+path,{
    method:'POST',headers,body:JSON.stringify(order)
  }),env,{connectionId:connection.id,routeToken,createOnly:true});
}
export async function replayExplicitEasyOrdersStoreGaps(env,{
  clientId,storeId,connectionId,confirmStoreId,confirmBackup,
  shortIds,fetcher=fetch,readSecrets=readConnectionSecrets,
  ingest=importCanonical,reconcileFee=reconcileManagementFeeForOrder
}={}){
  if(env.EASYORDERS_TARGETED_RECOVERY_ENABLED!=='true')
    throw failure('EASYORDERS_REPLAY_DISABLED','استرجاع الفجوات التاريخية معطّل لحماية بيانات العملاء',409);
  const tenant=clean(clientId),store=clean(storeId),connection=clean(connectionId);
  if(!tenant||!store||!connection||clean(confirmStoreId)!==store||confirmBackup!==true)
    throw failure('EASYORDERS_REPLAY_CONFIRMATION_REQUIRED','حدد متجرًا واتصالًا واعتمد النسخة الاحتياطية قبل الاسترجاع');
  const ids=validatedIds(shortIds);
  const row=await env.DB.prepare(
    "SELECT * FROM store_connections WHERE id=? AND client_id=? AND provider='easyorders' AND status='connected'"
  ).bind(connection,tenant).first();
  if(!row)throw failure('EASYORDERS_REPLAY_CONNECTION_NOT_FOUND','اتصال Easy Orders غير موجود',404);
  let config={};try{config=JSON.parse(row.config_json||'{}');}catch{
    throw failure('EASYORDERS_REPLAY_CONFIG_INVALID','إعداد الاتصال غير قابل للقراءة',409);
  }
  if(clean(config.kunStoreId||config.storeId)!==store)
    throw failure('EASYORDERS_REPLAY_STORE_MISMATCH','المتجر لا يطابق الاتصال',403);
  const external=clean(row.external_store_id);
  if(!external||external===connection||/^CON-/i.test(external))
    throw failure('EASYORDERS_REPLAY_EXTERNAL_STORE_UNVERIFIED','ربط المتجر الخارجي لم يتم التحقق منه',409);
  const secrets=await readSecrets(env,tenant,connection);
  const apiKey=clean(secrets?.api_key);
  if(!apiKey)throw failure('EASYORDERS_REPLAY_KEY_MISSING','مفتاح Easy Orders غير متاح',409);
  const result={
    ok:true,mode:'selective_recovery',storeId:store,connectionId:connection,
    requested:ids.length,attempted:0,recovered:0,alreadyInKun:0,
    missingAtProvider:0,foreignStoreSkipped:0,ambiguousLegacyOrders:0,
    feeFailures:0,recoveredOrderIds:[],status:'complete',retryShortId:null
  };
  for(const shortId of ids){
    let response;
    result.attempted++;
    try{response=await fetcher('https://api.easy-orders.net/api/v1/external-apps/orders/short/'+shortId,{
      method:'GET',headers:{Accept:'application/json','Api-Key':apiKey},redirect:'error'
    });}catch{
      result.ok=false;result.status='provider_network_error';result.retryShortId=shortId;break;
    }
    if(response.status===429){
      result.ok=false;result.status='rate_limited';result.retryShortId=shortId;break;
    }
    if(response.status===404){result.missingAtProvider++;continue;}
    if(!response.ok){
      result.ok=false;result.status=response.status===401||response.status===403?'provider_forbidden':'provider_error';
      result.retryShortId=shortId;break;
    }
    let payload;
    try{payload=await response.json();}catch{
      result.ok=false;result.status='provider_payload_invalid';result.retryShortId=shortId;break;
    }
    const order=payload?.data?.id?payload.data:payload;
    const sourceOrderId=clean(order?.id),sourceStore=clean(order?.store_id||order?.storeId);
    const returnedShort=order?.short_id??order?.shortId;
    // A misrouted short lookup must never import a DIFFERENT customer order.
    if(returnedShort!==undefined&&returnedShort!==null&&
        (!Number.isSafeInteger(Number(returnedShort))||Number(returnedShort)!==shortId)){
      result.ok=false;result.status='provider_short_id_mismatch';
      result.retryShortId=shortId;break;
    }
    if(!sourceOrderId||!sourceStore){
      result.ok=false;result.status='provider_payload_invalid';result.retryShortId=shortId;break;
    }
    if(sourceStore!==external){result.foreignStoreSkipped++;continue;}
    // Race-safe recheck for every ID: import only absent orders in this store,
    // never apply an old provider status to a confirmed/shipped existing order.
    const matches=await env.DB.prepare(
      'SELECT id,store_id FROM orders WHERE client_id=? AND (id=? OR ref=?) LIMIT 10'
    ).bind(tenant,sourceOrderId,`easyorders:${sourceOrderId}`).all();
    const rows=matches?.results||[];
    if(rows.some(x=>clean(x.store_id)===store)){result.alreadyInKun++;continue;}
    if(rows.some(x=>!clean(x.store_id))){result.ambiguousLegacyOrders++;continue;}
    try{
      const imported=await ingest(env,row,secrets,order);
      if(!imported?.ok||!clean(imported.id)||clean(imported.clientId)!==tenant||clean(imported.storeId)!==store)
        throw failure('EASYORDERS_REPLAY_IMPORT_MISMATCH','لم يتم تأكيد استيراد الطلب في المتجر الصحيح',409);
      if(imported.skippedExisting===true){result.alreadyInKun++;continue;}
      result.recovered++;
      result.recoveredOrderIds.push(clean(imported.id));
      try{
        const fee=await reconcileFee(env,clean(imported.id));
        if(fee?.ok===false)result.feeFailures++;
      }catch{result.feeFailures++;}
    }catch{
      result.ok=false;result.status='import_failed';result.retryShortId=shortId;break;
    }
  }
  if(result.feeFailures){result.ok=false;if(result.status==='complete')result.status='fee_reconciliation_failed';}
  return result;
}
