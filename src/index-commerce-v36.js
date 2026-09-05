import commerceV35,{SyncEntrypoint as SyncEntrypointV35} from './index-commerce-v35.js';
import {recordCarrierFinancials} from './carrier-financials.js';
import {applyCurrentInventoryCosts} from './dashboard-live-product-cost.js';
import {metaAdsExpertAnalysisV2} from './meta-ads-expert.js';
import {metaAdsDailyComparison,metaAdsBreakdown,META_BREAKDOWN_CATALOG} from './meta-ads-campaign-detail-v3.js';
import {includeInactiveExpertEntities,includeInactiveComparisonEntities} from './meta-ads-campaign-all.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {requireAdmin} from './admin-control.js';
import {adminClientCommandCenter,adminClientCommandBrief,resolveAdminBriefRange} from './admin-client-command-center.js';
import {resolveStoreScope} from './store-scope.js';
import {gateShippingSheetInventory,markShippingSheetInventoryResolved,pendingShippingSheetInventoryBlock,decorateShippingSheetInventoryBlocks,sanitizeShippingSheetPending} from './shipping-sheet-inventory-gate.js';
import {matchShippingSheetRows} from './shipping-sheet-order-match.js';

const BUILD='preview-v36-2026-09-05-admin-client-command-center';
const clean=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const parseArr=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
const CAMPAIGN_READ_PATHS=new Set(['/api/integrations/meta-ads/campaign-hub','/api/integrations/meta-ads/daily-comparison','/api/integrations/meta-ads/breakdowns']);
const ADMIN_COMMAND_PATH=/^\/api\/admin\/(?:client-command-center|clients\/[^/]+\/command-brief)$/;
const hasAuthEnvelope=request=>Boolean(clean(request.headers.get('Cookie'))||clean(request.headers.get('Authorization')));

async function currentUser(request,env,ctx){
  try{
    const url=new URL(request.url);url.pathname='/api/me';url.search='';
    const response=await commerceV35.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
    if(!response?.ok)return null;
    const me=await response.json().catch(()=>null);
    return me?.role?me:null;
  }catch{
    return null;
  }
}
function resolvedClient(me,request,body={}){
  const requested=clean(body.clientId||body.client_id||new URL(request.url).searchParams.get('clientId'));
  if(me?.clientId){if(requested&&requested!==clean(me.clientId))return null;return clean(me.clientId);}
  return requested||null;
}
function childRequest(request,path,method,body={},clientId='',storeId=''){
  const url=new URL(request.url);url.pathname=path;url.search='';if(clientId)url.searchParams.set('clientId',clientId);if(storeId)url.searchParams.set('storeId',storeId);
  const headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('content-length');
  return new Request(url,{method,headers,body:method==='GET'||method==='HEAD'?undefined:JSON.stringify({...body,...(clientId?{clientId}:{}),...(storeId?{storeId}:{})})});
}
async function responseData(response){const data=await response.clone().json().catch(()=>({error:`HTTP ${response.status}`}));return {data,status:response.status};}
async function requireOk(response){if(response.ok)return response;const {data}=await responseData(response);throw Object.assign(new Error(data?.error||`HTTP ${response.status}`),{status:response.status,code:data?.code||'DELEGATED_REQUEST_FAILED',data});}
async function orderRow(env,{clientId,orderId}){return env.DB.prepare('SELECT id,client_id,store_id,state,shipping_cost,history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();}

async function campaignReadScope(request,env,ctx){
  const url=new URL(request.url),me=await currentUser(request,env,ctx);if(!me)throw Object.assign(new Error('محتاج تسجّل دخول'),{status:401,code:'AUTH_REQUIRED'});
  requirePermission(me,'campaigns','read');
  const clientId=resolveTenant(me,url.searchParams.get('clientId'));
  const scope=await resolveStoreScope(env,me,clientId,clean(url.searchParams.get('storeId'))||null,{write:false});
  return {url,me,clientId,storeId:scope.storeId||null};
}
async function campaignHubRoute(request,env,ctx){
  const {url,clientId,storeId}=await campaignReadScope(request,env,ctx);
  const base=await metaAdsExpertAnalysisV2(env,{clientId,storeId,from:url.searchParams.get('from'),to:url.searchParams.get('to')});
  const analysis=await includeInactiveExpertEntities(env,{clientId,storeId,analysis:base});
  return json({...analysis,breakdownCatalog:META_BREAKDOWN_CATALOG});
}
async function campaignComparisonRoute(request,env,ctx){
  const {url,clientId,storeId}=await campaignReadScope(request,env,ctx),status=url.searchParams.get('status')||'active';
  const base=await metaAdsDailyComparison(env,{clientId,storeId,level:url.searchParams.get('level')||'campaign',from:url.searchParams.get('from'),to:url.searchParams.get('to'),days:url.searchParams.get('days')||7,status});
  return json(await includeInactiveComparisonEntities(env,{clientId,storeId,level:base.level,result:base}));
}
async function campaignBreakdownRoute(request,env,ctx){const {url,clientId,storeId}=await campaignReadScope(request,env,ctx);return json(await metaAdsBreakdown(env,{clientId,storeId,from:url.searchParams.get('from'),to:url.searchParams.get('to'),days:url.searchParams.get('days')||7,status:url.searchParams.get('status')||'active',dimension:url.searchParams.get('dimension')||'image_asset'}));}
async function adminCommandScope(request,env,ctx){const me=await currentUser(request,env,ctx);if(!me)throw Object.assign(new Error('محتاج تسجّل دخول'),{status:401,code:'AUTH_REQUIRED'});requireAdmin(me);const url=new URL(request.url),range=resolveAdminBriefRange({preset:url.searchParams.get('preset')||'today',from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||''});return {me,url,range};}
async function adminCommandCenterRoute(request,env,ctx){const {me,range}=await adminCommandScope(request,env,ctx);return json(await adminClientCommandCenter(env,{me,range}));}
async function adminClientBriefRoute(request,env,ctx,match){const {me,range}=await adminCommandScope(request,env,ctx);return json(await adminClientCommandBrief(env,{me,clientId:decodeURIComponent(match[1]),range}));}
async function explicitInventoryLinks(env,{clientId,orderId,productId}){
  const row=await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN product_id IS NOT NULL AND trim(product_id)<>'' THEN 1 ELSE 0 END) linked FROM order_items WHERE order_id=? AND client_id=? AND qty>0").bind(orderId,clientId).first().catch(()=>({total:0,linked:0}));
  return num(row?.total)>0?num(row?.linked)===num(row?.total):Boolean(clean(productId));
}
async function restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId}){
  const fresh=await env.DB.prepare('SELECT state,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(fresh?.state==='returned'&&Number(fresh?.restocked)!==1)await env.DB.prepare('UPDATE orders SET restocked=1 WHERE id=? AND client_id=?').bind(orderId,clientId).run().catch(()=>{});
}

async function guardedReturnedReconfirmation(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({}));
  if(clean(body.state)!=='confirmed')return commerceV35.fetch(request,env,ctx);
  const me=await currentUser(request,env,ctx);if(!me)return commerceV35.fetch(request,env,ctx);
  const clientId=resolvedClient(me,request,body);if(!clientId)return commerceV35.fetch(request,env,ctx);
  const orderId=decodeURIComponent(match[1]),row=await env.DB.prepare('SELECT id,state,restocked,product_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(!row||row.state!=='returned'||Number(row.restocked)!==1)return commerceV35.fetch(request,env,ctx);
  if(!await explicitInventoryLinks(env,{clientId,orderId,productId:row.product_id}))return commerceV35.fetch(request,env,ctx);

  await env.DB.prepare("UPDATE orders SET restocked=0 WHERE id=? AND client_id=? AND state='returned' AND restocked=1").bind(orderId,clientId).run();
  let response;
  try{response=await commerceV35.fetch(request,env,ctx);}catch(error){await restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId});throw error;}
  if(!response.ok)await restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId});
  else{
    const fresh=await env.DB.prepare('SELECT state FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
    if(fresh?.state==='returned')await restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId});
  }
  return response;
}

async function customerServiceShippingFallback(request,env,ctx,match,response,body){
  if(response.status!==403||clean(body.state)!=='shipped')return response;
  const denied=await response.clone().json().catch(()=>({}));
  if(!clean(denied?.error).includes('الحالة دي برّه الصلاحية المتاحة ليك'))return response;

  const me=await currentUser(request,env,ctx);if(me?.role!=='client')return response;
  const clientId=resolvedClient(me,request,body);if(!clientId)return response;
  const orderId=decodeURIComponent(match[1]),row=await env.DB.prepare('SELECT id,state,store_id,history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(!row||!['confirmed','preparing','shipped'].includes(clean(row.state)))return response;

  const url=new URL(request.url),requestedStore=clean(body.storeId||body.store_id||url.searchParams.get('storeId'));
  if(requestedStore&&requestedStore!==clean(row.store_id))return response;

  const stateRow=await env.DB.prepare('SELECT json FROM state WHERE id=1').first().catch(()=>null);let tenant=null;
  try{tenant=(JSON.parse(stateRow?.json||'{}').clients||[]).find(item=>clean(item?.id)===clientId)||null;}catch{}
  if(!tenant?.customerServiceEnabled)return response;

  if(row.state==='shipped')return json({ok:true,state:'shipped',history:parseArr(row.history),customerServiceShippingHandoff:true},200);
  const history=parseArr(row.history),at=new Date().toISOString();
  history.push({type:'state',state:'shipped',at,by:me?.email||me?.name||me?.role||'client',byName:me?.name||me?.email||me?.role||'client',byUserId:me?.uid||me?.id||null,note:'تم التسليم إلى مرحلة جاري الشحن من خدمة العملاء'});
  await env.DB.prepare("UPDATE orders SET state='shipped',checkpoint='جاري الشحن',history=? WHERE id=? AND client_id=? AND state IN ('confirmed','preparing')").bind(JSON.stringify(history),orderId,clientId).run();
  const fresh=await env.DB.prepare('SELECT state FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(fresh?.state!=='shipped')return response;
  return json({ok:true,state:'shipped',history,customerServiceShippingHandoff:true,inventoryChanged:false},200);
}

async function customerServiceStateTransition(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({}));
  if(clean(body.state)==='confirmed')return guardedReturnedReconfirmation(request,env,ctx,match);
  if(clean(body.state)==='returned'&&clean(body.sourceSection)==='post-shipping-sheet'){
    const me=await currentUser(request,env,ctx);if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);const clientId=resolvedClient(me,request,body);if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);const orderId=decodeURIComponent(match[1]);
    await gateShippingSheetInventory(env,{clientId,orderId,me,pending:{target:'returned',flow:'post-shipping-sheet-return',reason:body.reason||body.outcomeReason,returnBody:body}});
    const response=await commerceV35.fetch(request,env,ctx);if(response.ok)await markShippingSheetInventoryResolved(env,{clientId,orderId,me,note:'تمت مزامنة المخزون وتسجيل المرتجع من شيت شركة الشحن'});return response;
  }
  const response=await commerceV35.fetch(request,env,ctx);
  return customerServiceShippingFallback(request,env,ctx,match,response,body);
}

async function decoratedOperationalBoard(request,env,ctx){
  const response=await commerceV35.fetch(request,env,ctx);if(!response.ok)return response;const data=await response.clone().json().catch(()=>null);if(!data?.ok||!Array.isArray(data.orders))return response;return json(decorateShippingSheetInventoryBlocks(data),response.status);
}

async function shippingSheetMatchRoute(request,env,ctx){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);const clientId=resolvedClient(me,request,body);if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);
  return json(await matchShippingSheetRows(env,{clientId,storeId:clean(body.storeId||body.store_id),rows:body.rows,me}));
}

async function carrierFinancialsRoute(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);
  if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
  const clientId=resolvedClient(me,request,body);
  if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);
  const orderId=decodeURIComponent(match[1]),target=clean(body.sheetType)==='returned'?'returned':'delivered';
  await gateShippingSheetInventory(env,{clientId,orderId,me,pending:{target,flow:'carrier-financials-only',carrierName:body.carrierName,sourceFile:body.sourceFile,carrierFinancials:body}});
  const result=await recordCarrierFinancials(env,{clientId,orderId,me,body});await markShippingSheetInventoryResolved(env,{clientId,orderId,me,note:'تمت مزامنة المخزون وتسجيل بيانات شركة الشحن المالية'});return json(result);
}

async function settleShippingSheetState(request,env,ctx,{clientId,orderId,me,pending}){
  let row=await orderRow(env,{clientId,orderId});if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});const storeId=clean(row.store_id),target=pending.target;
  if(target==='shipped'){
    if(['signed','collected','returned','cancelled'].includes(clean(row.state)))throw Object.assign(new Error('لا يمكن إرجاع الأوردر لحالة جاري الشحن من حالته الحالية'),{status:409,code:'SHIPPING_SHEET_STATE_INVALID'});
    if(!['confirmed','preparing','shipped'].includes(clean(row.state)))throw Object.assign(new Error('الأوردر لازم يكون مؤكد أو قيد التجهيز قبل تسجيل الشحن'),{status:409,code:'SHIPPING_SHEET_STATE_INVALID'});
    if(row.state!=='shipped')await requireOk(await commerceV35.fetch(childRequest(request,`/api/customer-service/orders/${encodeURIComponent(orderId)}/state`,'PATCH',{state:'shipped'},clientId,storeId),env,ctx));
    return {state:'shipped',storeId};
  }
  if(target==='delivered'){
    if(['returned','cancelled'].includes(clean(row.state)))throw Object.assign(new Error('لا يمكن تسجيل تم التوصيل على أوردر مرتجع أو ملغي'),{status:409,code:'SHIPPING_SHEET_STATE_INVALID'});
    if(!['confirmed','preparing','shipped','signed','collected'].includes(clean(row.state)))throw Object.assign(new Error('حالة الأوردر لا تسمح بتسجيل التوصيل من شيت الشحن'),{status:409,code:'SHIPPING_SHEET_STATE_INVALID'});
    if(pending.shippingCost!==null&&Number.isFinite(Number(pending.shippingCost)))await requireOk(await commerceV35.fetch(childRequest(request,`/api/orders/${encodeURIComponent(orderId)}`,'PATCH',{shippingCost:Number(pending.shippingCost)},clientId,storeId),env,ctx));
    if(['confirmed','preparing'].includes(clean(row.state))){await requireOk(await commerceV35.fetch(childRequest(request,`/api/customer-service/orders/${encodeURIComponent(orderId)}/state`,'PATCH',{state:'shipped'},clientId,storeId),env,ctx));row=await orderRow(env,{clientId,orderId});}
    if(clean(row.state)==='shipped')await requireOk(await commerceV35.fetch(childRequest(request,`/api/post-shipping/orders/${encodeURIComponent(orderId)}/delivered`,'PATCH',{},clientId,storeId),env,ctx));
    return {state:(await orderRow(env,{clientId,orderId}))?.state||row.state,storeId};
  }
  if(target==='returned'){
    if(clean(row.state)==='collected')throw Object.assign(new Error('الأوردر تم تحصيله بالفعل ويحتاج مراجعة يدوية قبل تسجيل المرتجع'),{status:409,code:'SHIPPING_SHEET_COLLECTED_RETURN_REVIEW'});
    if(clean(row.state)==='cancelled')throw Object.assign(new Error('الأوردر ملغي بالفعل'),{status:409,code:'SHIPPING_SHEET_STATE_INVALID'});
    if(!['confirmed','preparing','shipped','signed','returned'].includes(clean(row.state)))throw Object.assign(new Error('حالة الأوردر لا تسمح بتسجيل المرتجع من شيت الشحن'),{status:409,code:'SHIPPING_SHEET_STATE_INVALID'});
    if(pending.shippingCost!==null&&Number.isFinite(Number(pending.shippingCost)))await requireOk(await commerceV35.fetch(childRequest(request,`/api/orders/${encodeURIComponent(orderId)}`,'PATCH',{shippingCost:Number(pending.shippingCost)},clientId,storeId),env,ctx));
    if(clean(row.state)!=='returned'){
      const returnBody=pending.returnBody||{},reason=clean(returnBody.reason||returnBody.outcomeReason||pending.reason)||'مرتجع حسب شيت شركة الشحن';
      await requireOk(await commerceV35.fetch(childRequest(request,`/api/customer-service/orders/${encodeURIComponent(orderId)}/state`,'PATCH',{state:'returned',returnType:returnBody.returnType||'full',reason,outcomeReason:reason,sourceSection:'post-shipping-sheet'},clientId,storeId),env,ctx));
    }
    return {state:'returned',storeId};
  }
  throw Object.assign(new Error('نوع نتيجة شيت الشحن غير مدعوم'),{status:400,code:'SHIPPING_SHEET_TARGET_INVALID'});
}

async function applyShippingSheetWorkflow(request,env,ctx,{orderId,body,me,clientId}){
  const target=clean(body.target||body.sheetType).toLowerCase(),pending=sanitizeShippingSheetPending({target,flow:'shipping-sheet-apply',shippingCost:body.shippingCost,reason:body.reason||body.outcomeReason,sourceFile:body.sourceFile,carrierName:body.carrierName,returnBody:body.returnBody||body,carrierFinancials:body.carrierFinancials});
  const inventory=await gateShippingSheetInventory(env,{clientId,orderId,me,pending});const settled=await settleShippingSheetState(request,env,ctx,{clientId,orderId,me,pending});let carrier=null;
  if(pending.carrierFinancials)carrier=await recordCarrierFinancials(env,{clientId,orderId,me,body:{...pending.carrierFinancials,sheetType:target==='returned'?'returned':'delivered'}});
  await markShippingSheetInventoryResolved(env,{clientId,orderId,me,note:target==='returned'?'تمت مزامنة المخزون وتسجيل المرتجع والحسابات من شيت الشحن':target==='delivered'?'تم خصم المخزون وتسجيل التوصيل والمستحقات من شيت الشحن':'تم خصم المخزون وتسجيل جاري الشحن من الشيت'});
  const fresh=await orderRow(env,{clientId,orderId});return {ok:true,id:orderId,target,state:fresh?.state||settled.state,inventorySynced:true,inventoryAlreadySynced:Boolean(inventory?.alreadySynced||(!inventory?.allocatedNow&&inventory?.coverage?.complete)),inventoryAllocatedNow:Boolean(inventory?.allocatedNow),carrierFinancials:carrier?.financials||null,expectedCarrierCollection:carrier?.financials?.expectedNet??null};
}
async function shippingSheetApplyRoute(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);const clientId=resolvedClient(me,request,body);if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);return json(await applyShippingSheetWorkflow(request,env,ctx,{orderId:decodeURIComponent(match[1]),body,me,clientId}));
}
async function shippingSheetRetryRoute(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);const clientId=resolvedClient(me,request,body);if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);const orderId=decodeURIComponent(match[1]),block=await pendingShippingSheetInventoryBlock(env,{clientId,orderId});if(!block)return json({ok:true,id:orderId,noPendingInventoryBlock:true});const pending=sanitizeShippingSheetPending(block.pending||{});
  if(pending.flow==='carrier-financials-only'){
    await gateShippingSheetInventory(env,{clientId,orderId,me,pending});const carrier=await recordCarrierFinancials(env,{clientId,orderId,me,body:pending.carrierFinancials||{sheetType:pending.target==='returned'?'returned':'delivered'}});await markShippingSheetInventoryResolved(env,{clientId,orderId,me,note:'تم حل مشكلة المخزون واستكمال تسوية شركة الشحن المالية'});return json({ok:true,id:orderId,inventorySynced:true,financials:carrier.financials});
  }
  return json(await applyShippingSheetWorkflow(request,env,ctx,{orderId,body:{...pending,target:pending.target,returnBody:pending.returnBody,carrierFinancials:pending.carrierFinancials},me,clientId}));
}

async function guardedDirectDelivered(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);if(!me)return commerceV35.fetch(request,env,ctx);const clientId=resolvedClient(me,request,body);if(!clientId)return commerceV35.fetch(request,env,ctx);const orderId=decodeURIComponent(match[1]),row=await orderRow(env,{clientId,orderId});
  await gateShippingSheetInventory(env,{clientId,orderId,me,pending:{target:'delivered',flow:'post-shipping-delivered',shippingCost:row?.shipping_cost}});const response=await commerceV35.fetch(request,env,ctx);if(response.ok)await markShippingSheetInventoryResolved(env,{clientId,orderId,me,note:'تمت مزامنة المخزون قبل تسجيل التوصيل'});return response;
}

async function dashboardCurrentCostRoute(request,env,ctx){
  const response=await commerceV35.fetch(request,env,ctx);if(!response.ok)return response;
  const snapshot=await response.clone().json().catch(()=>null);if(!snapshot?.ok)return response;
  const me=await currentUser(request,env,ctx);if(!me)return response;
  const clientId=resolvedClient(me,request);if(!clientId)return response;
  const storeId=clean(new URL(request.url).searchParams.get('storeId'))||null;
  return json(await applyCurrentInventoryCosts(env,{snapshot,clientId,storeId}),response.status);
}

async function fetchV36(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v36.js'});
    if(method==='GET'&&CAMPAIGN_READ_PATHS.has(path)&&!hasAuthEnvelope(request))return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
    if(method==='GET'&&ADMIN_COMMAND_PATH.test(path)&&!hasAuthEnvelope(request))return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
    if(path==='/api/admin/client-command-center'&&method==='GET')return adminCommandCenterRoute(request,env,ctx);
    const adminBriefMatch=path.match(/^\/api\/admin\/clients\/([^/]+)\/command-brief$/);if(adminBriefMatch&&method==='GET')return adminClientBriefRoute(request,env,ctx,adminBriefMatch);
    if((path==='/api/customer-service'||path==='/api/post-shipping')&&method==='GET')return decoratedOperationalBoard(request,env,ctx);
    if(path==='/api/post-shipping/shipping-sheet-match'&&method==='POST')return shippingSheetMatchRoute(request,env,ctx);
    if(path==='/api/dashboard'&&method==='GET')return dashboardCurrentCostRoute(request,env,ctx);
    if(path==='/api/integrations/meta-ads/campaign-hub'&&method==='GET')return campaignHubRoute(request,env,ctx);
    if(path==='/api/integrations/meta-ads/daily-comparison'&&method==='GET')return campaignComparisonRoute(request,env,ctx);
    if(path==='/api/integrations/meta-ads/breakdowns'&&method==='GET')return campaignBreakdownRoute(request,env,ctx);
    const applyMatch=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/shipping-sheet-apply$/);if(applyMatch&&method==='PATCH')return shippingSheetApplyRoute(request,env,ctx,applyMatch);
    const retryMatch=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/shipping-sheet-retry$/);if(retryMatch&&method==='PATCH')return shippingSheetRetryRoute(request,env,ctx,retryMatch);
    const financialMatch=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/carrier-financials$/);if(financialMatch&&method==='PATCH')return carrierFinancialsRoute(request,env,ctx,financialMatch);
    const deliveredMatch=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/delivered$/);if(deliveredMatch&&method==='PATCH')return guardedDirectDelivered(request,env,ctx,deliveredMatch);
    const stateMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/state$/);if(stateMatch&&method==='PATCH')return customerServiceStateTransition(request,env,ctx,stateMatch);
    return commerceV35.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V36_ERROR',path,method,inventoryBlocked:Boolean(error?.inventoryBlocked),inventoryBlock:error?.inventoryBlock||null},error?.status||500);}
}

export class SyncEntrypoint extends SyncEntrypointV35{
  async health(){const base=await super.health();return {...base,entrypoint:'index-commerce-v36.js',returnReconfirmStockGuard:true,customerServiceShippingHandoff:true,carrierFinancials:true,shippingSheetInventoryGate:true,shippingSheetInventoryPrivacyBlock:true,shippingSheetFinancialDependency:true,shippingSheetAutomaticRetry:true,shippingSheetSmartMatch:true,shippingSheetIdempotentInventory:true,dashboardCurrentInventoryCosts:true,adminClientCommandCenter:true,adminClientPeriodBrief:true,adminClientPreviousPeriodComparison:true,campaignExpertHub:true,campaignDailyComparison:true,metaBreakdowns:true,campaignAllFilterExhaustive:true,metaBreakdownScopeGuard:true,currentMetaSdkBreakdowns:true,campaignAuthFailClosed:true,campaignAnonymousGate:true,campaignLevelWorkspaces:true,campaignIndependentDateRanges:true,readableCreativeBreakdowns:true};}
}

export default {fetch:fetchV36,scheduled(controller,env,ctx){return commerceV35.scheduled?.(controller,env,ctx);}};