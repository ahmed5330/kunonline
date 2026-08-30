import commerceV33 from './index-commerce-v33.js';
import {permissionSnapshot,requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {syncMetaAdsForClient} from './meta-ads-sync.js';
import {syncMetaAdsGranular} from './meta-ads-granular.js';
import {metaAdsExpertAnalysisV2} from './meta-ads-expert.js';
import {reconcileEasyOrdersOrders} from './easyorders-order-reconciliation.js';
import {reconcileManagementFeeForOrder} from './accounting.js';

const BUILD='preview-v34-2026-08-30-meta-ads-expert';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
const text=v=>String(v??'').trim();
const positiveInt=value=>{const n=Math.floor(Number(value));return Number.isFinite(n)&&n>0?n:0;};
function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
function webhookOrderPayload(input){const root=input&&typeof input==='object'&&!Array.isArray(input)?input:{};return [root.data?.order,root.order,root.payload?.order,root.payload,root.data,root].find(x=>x&&typeof x==='object'&&!Array.isArray(x))||{};}

async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV33.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});return me;
}
function cleanDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):null;}
function requestedRange(input={}){const to=cleanDate(input.to)||new Date().toISOString().slice(0,10),rawFrom=String(input.from||''),from=rawFrom==='beginning'?null:cleanDate(rawFrom);let days=30;if(from){days=Math.max(1,Math.min(90,Math.floor((new Date(`${to}T00:00:00Z`)-new Date(`${from}T00:00:00Z`))/86400000)+1));}else if(rawFrom==='beginning')days=90;return {from:from||undefined,to,days};}
async function reconcileRecoveredFees(env,result){for(const id of result?.recoveredOrderIds||[])await reconcileManagementFeeForOrder(env,id).catch(()=>{});return result;}
async function rememberEasyOrdersShortId(env,connectionId,rawPayload){
  const order=webhookOrderPayload(rawPayload),shortId=positiveInt(order.short_id||order.shortId||rawPayload?.short_id||rawPayload?.shortId);if(!shortId||!connectionId)return;
  const row=await env.DB.prepare("SELECT id,client_id,config_json FROM store_connections WHERE id=? AND provider='easyorders' AND status='connected'").bind(connectionId).first();if(!row)return;
  const fresh=await env.DB.prepare('SELECT config_json FROM store_connections WHERE id=? AND client_id=?').bind(row.id,row.client_id).first(),config=parseConfig(fresh||row),oldHigh=positiveInt(config.easyOrdersRecoveryHighestShortId),oldCursor=positiveInt(config.easyOrdersRecoveryCursor);
  config.webhookLastShortId=shortId;
  config.easyOrdersRecoveryHighestShortId=Math.max(oldHigh,shortId);
  if(!oldCursor)config.easyOrdersRecoveryCursor=Math.max(1,shortId-80);
  if(!config.easyOrdersRecoverySeededAt)config.easyOrdersRecoverySeededAt=new Date().toISOString();
  config.easyOrdersRecoveryLastError=null;
  await env.DB.prepare('UPDATE store_connections SET config_json=?,updated_at=? WHERE id=? AND client_id=?').bind(JSON.stringify(config),new Date().toISOString(),row.id,row.client_id).run();
}

async function fetchV34(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v34.js'});
    if(path==='/api/navigation-access'&&method==='GET'){
      const me=await currentUser(request,env,ctx);
      return json({ok:true,...permissionSnapshot(me)});
    }
    const easyWebhook=path.match(/^\/webhooks\/easyorders\/([^/]+)\/[^/]+\/?$/);
    if(easyWebhook&&method==='POST'){
      const payload=await request.clone().json().catch(()=>({})),response=await commerceV33.fetch(request,env,ctx);
      if(response.ok)await rememberEasyOrdersShortId(env,decodeURIComponent(easyWebhook[1]),payload).catch(()=>{});
      return response;
    }
    if(path==='/api/commerce/order-sync/reconcile'&&method==='POST'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','write');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,body.storeId||body.store_id||url.searchParams.get('storeId')||null,{write:true});
      const result=await reconcileEasyOrdersOrders(env,{clientId,storeId:scope.storeId||null,connectionId:body.connectionId||body.connection_id||null,maxRequests:body.maxRequests||30,lookback:body.lookback||80});
      return json(await reconcileRecoveredFees(env,result));
    }
    if(path==='/api/integrations/meta-ads/expert-analysis'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'analytics','read');const clientId=resolveTenant(me,url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,url.searchParams.get('storeId')||null,{write:false});
      return json(await metaAdsExpertAnalysisV2(env,{clientId,storeId:scope.storeId||null,from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
    }
    if(path==='/api/integrations/meta-ads/expert-sync'&&method==='POST'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'analytics','read');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,body.storeId||body.store_id||url.searchParams.get('storeId')||null,{write:false}),range=requestedRange(body);
      const campaignSync=await syncMetaAdsForClient(env,{clientId,storeId:scope.storeId||null,...range});
      const granularSync=await syncMetaAdsGranular(env,{clientId,storeId:scope.storeId||null,...range});
      const analysis=await metaAdsExpertAnalysisV2(env,{clientId,storeId:scope.storeId||null,from:campaignSync.from||range.from,to:campaignSync.to||range.to});
      return json({ok:true,campaignSync,granularSync,analysis});
    }
    return commerceV33.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V34_ERROR',path,method},error?.status||500);}
}

async function runScheduledWithEasyOrdersRecovery(controller,env,ctx){
  const pending=[],nestedCtx=Object.create(ctx||null);nestedCtx.waitUntil=promise=>{if(promise)pending.push(Promise.resolve(promise));};
  let delegated;try{delegated=commerceV33.scheduled?.(controller,env,nestedCtx);}catch(error){pending.push(Promise.reject(error));}
  if(delegated&&typeof delegated.then==='function')pending.push(Promise.resolve(delegated));
  await Promise.allSettled(pending);
  if(String(controller?.cron||'')!=='*/5 * * * *')return {ok:true,easyOrdersRecovery:'skipped'};
  const result=await reconcileEasyOrdersOrders(env,{maxRequests:30,lookback:80});
  await reconcileRecoveredFees(env,result);
  return result;
}

export default {
  fetch:fetchV34,
  scheduled(controller,env,ctx){const task=runScheduledWithEasyOrdersRecovery(controller,env,ctx);ctx?.waitUntil?.(task);return task;}
};
