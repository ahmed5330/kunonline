import commerceV35,{SyncEntrypoint as SyncEntrypointV35} from './index-commerce-v35.js';
import {recordCarrierFinancials} from './carrier-financials.js';
import {applyCurrentInventoryCosts} from './dashboard-live-product-cost.js';
import {metaAdsExpertAnalysisV2} from './meta-ads-expert.js';
import {metaAdsDailyComparison,metaAdsBreakdown,META_BREAKDOWN_CATALOG} from './meta-ads-campaign-detail-v3.js';
import {includeInactiveExpertEntities,includeInactiveComparisonEntities} from './meta-ads-campaign-all.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const BUILD='preview-v36-2026-09-03-campaign-compact-comparison-ui';
const clean=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const parseArr=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
const CAMPAIGN_READ_PATHS=new Set(['/api/integrations/meta-ads/campaign-hub','/api/integrations/meta-ads/daily-comparison','/api/integrations/meta-ads/breakdowns']);
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
  const response=await commerceV35.fetch(request,env,ctx);
  return customerServiceShippingFallback(request,env,ctx,match,response,body);
}

async function carrierFinancialsRoute(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);
  if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
  const clientId=resolvedClient(me,request,body);
  if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);
  const orderId=decodeURIComponent(match[1]);
  return json(await recordCarrierFinancials(env,{clientId,orderId,me,body}));
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
    if(path==='/api/dashboard'&&method==='GET')return dashboardCurrentCostRoute(request,env,ctx);
    if(path==='/api/integrations/meta-ads/campaign-hub'&&method==='GET')return campaignHubRoute(request,env,ctx);
    if(path==='/api/integrations/meta-ads/daily-comparison'&&method==='GET')return campaignComparisonRoute(request,env,ctx);
    if(path==='/api/integrations/meta-ads/breakdowns'&&method==='GET')return campaignBreakdownRoute(request,env,ctx);
    const financialMatch=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/carrier-financials$/);
    if(financialMatch&&method==='PATCH')return carrierFinancialsRoute(request,env,ctx,financialMatch);
    const stateMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/state$/);
    if(stateMatch&&method==='PATCH')return customerServiceStateTransition(request,env,ctx,stateMatch);
    return commerceV35.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V36_ERROR',path,method},error?.status||500);}
}

export class SyncEntrypoint extends SyncEntrypointV35{
  async health(){const base=await super.health();return {...base,entrypoint:'index-commerce-v36.js',returnReconfirmStockGuard:true,customerServiceShippingHandoff:true,carrierFinancials:true,dashboardCurrentInventoryCosts:true,campaignExpertHub:true,campaignDailyComparison:true,metaBreakdowns:true,campaignAllFilterExhaustive:true,metaBreakdownScopeGuard:true,currentMetaSdkBreakdowns:true,campaignAuthFailClosed:true,campaignAnonymousGate:true,campaignLevelWorkspaces:true,campaignIndependentDateRanges:true,readableCreativeBreakdowns:true};}
}

export default {fetch:fetchV36,scheduled(controller,env,ctx){return commerceV35.scheduled?.(controller,env,ctx);}};