import app from './index-production-jt-history.js';
import {handleMobileSync} from './mobile-state-sync.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleProductionCustomerService} from './production-customer-service.js';
import {handleProductionMobileOrderGuard} from './production-mobile-order-guard.js';
import {handleProductionCallerJntEdit} from './production-caller-jnt-edit.js';
import {handleProductionPrintingQueue} from './production-printing-queue.js';
import {handleInternalCollaboration} from './internal-collaboration.js';
import {handleCollaborationOrderSearch} from './internal-collaboration-order-search.js';
import {ensureInternalCollaborationSchema} from './internal-collaboration-schema.js';
import {handleProductionPreviewParity} from './production-preview-parity.js';
import {handleProductionEasyOrdersHealth} from './production-easyorders-health.js';
import {reconcileFinancePresentation} from './production-finance-presentation.js';
import {reconcileMonthlySubscriptions} from './subscription-billing.js';
import {handleSubscriptionControl} from './subscription-control.js';
import {handleInventoryUnitTracking,syncInventoryTrackingAfterResponse,reconcileTrackedOrderLifecycles,reconcileAllClientsUnitCoverage} from './inventory-unit-tracking.js';

const LEGACY_APK_URL='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile.apk';
const DIRECT_APK_PATH='/api/mobile/app-update/apk';
const PRINTING_STATES=new Set(['confirmed','preparing']);
const HTML_PATHS=new Set(['/','/index.html','/v2','/v2/','/v2/index.html']);

function previewRuntimeEnv(env){
  if(!env?.PREVIEW_DB)return env;
  return new Proxy(env,{get(target,key,receiver){if(key==='DB')return target.PREVIEW_DB;return Reflect.get(target,key,receiver);}});
}

async function previewFetch(request,env){
  if(!env?.PREVIEW_APP?.fetch)return null;
  const response=await env.PREVIEW_APP.fetch(request);
  const headers=new Headers(response.headers);
  headers.set('X-Kun-Data-Source','preview');
  headers.delete('Content-Length');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

function previewDelegate(env,dataEnv,ctx){
  return {fetch:async request=>{
    const response=await previewFetch(request,env);
    return response||app.fetch(request,dataEnv,ctx);
  }};
}

function shouldUsePreviewBackend(request){
  const path=new URL(request.url).pathname;
  return path.startsWith('/api/')||path.startsWith('/webhooks/')||path.startsWith('/webhook/');
}

async function websiteWithDirectAndroidDownload(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET'||!HTML_PATHS.has(url.pathname))return null;
  if(!env.ASSETS?.fetch)return null;

  let assetRequest=request;
  if(url.pathname==='/'||url.pathname==='/index.html'){
    const assetUrl=new URL(request.url);
    assetUrl.pathname='/v2/index.html';
    assetRequest=new Request(assetUrl.toString(),request);
  }
  const asset=await env.ASSETS.fetch(assetRequest);
  const type=String(asset.headers.get('Content-Type')||'');
  if(!asset.ok||!type.includes('text/html'))return asset;

  let html=await asset.text();
  html=html
    .replace(/\/v2\/modules-v46-variant-inventory-sync\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v46-variant-inventory-sync.js?v=46.5')
    .replace(/\/v2\/modules-v43-product-catalog\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v43-product-catalog.js?v=43.1')
    .replace(/\/v2\/app-v3\.js(?:\?v=[\d.]+)?/g,'/v2/app-v3.js?v=3.3')
    .replace(/\/v2\/modules-v19\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v19.js?v=20.3')
    .replace(/\/v2\/modules-v22\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v22.js?v=22.1')
    .replace(/\/v2\/modules-v80-jnt-address-cascade-v805\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v80-jnt-address-cascade-v805.js?v=80.6')
    .replace(/\/v2\/modules-v121-dashboard-sync-guard\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v121-dashboard-sync-guard.js?v=121.1')
    .replaceAll(LEGACY_APK_URL,DIRECT_APK_PATH)
    .replaceAll('/v2/modules-v51-permission-navigation.js?v=51.10','/v2/modules-v51-permission-navigation.js?v=51.15')
    .replace(/\/v2\/modules-v57-section-reload\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v57-section-reload.js?v=57.3')
    .replaceAll('/v2/modules-v78-jt-shipping-order.js?v=78.4','/v2/modules-v78-jt-shipping-order.js?v=78.5')
    .replaceAll('/v2/modules-v79-printing.js?v=79.7','/v2/modules-v79-printing.js?v=79.9')
    .replaceAll('/v2/modules-v117-team-collaboration.js?v=117.0','/v2/modules-v117-team-collaboration.js?v=117.1')
    .replaceAll('/v2/modules-v118-collaboration-order-picker.js?v=118.0','/v2/modules-v118-collaboration-order-picker.js?v=118.1.1');
  // v57 owns the ordered v66 -> v67 -> v68... chain. Injecting v66/v67 here
  // executes them twice and splits the hub state from its event handlers.
  if(!html.includes('/v2/modules-v116-print-routing.js')){
    html=html.replace('</body>','<script src="/v2/modules-v116-print-routing.js?v=116.0" data-kun-print-routing="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v117-team-collaboration.js')){
    html=html.replace('</body>','<script src="/v2/modules-v117-team-collaboration.js?v=117.1" data-kun-team-collaboration="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v118-collaboration-order-picker.js')){
    html=html.replace('</body>','<script src="/v2/modules-v118-collaboration-order-picker.js?v=118.1.1" data-kun-collaboration-order-picker="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v121-dashboard-sync-guard.js')){
    html=html.replace('</body>','<script src="/v2/modules-v121-dashboard-sync-guard.js?v=121.1" data-kun-dashboard-sync-guard="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v122-dashboard-experience.js')){
    html=html.replace('</body>','<script src="/v2/modules-v122-dashboard-experience.js?v=122.0" data-kun-dashboard-experience="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v123-dashboard-unified.js')){
    html=html.replace('</body>','<script src="/v2/modules-v123-dashboard-unified.js?v=123.0" data-kun-dashboard-unified="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v124-dashboard-periods-province.js')){
    html=html.replace('</body>','<script src="/v2/modules-v124-dashboard-periods-province.js?v=124.0" data-kun-dashboard-periods-v124="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v125-dashboard-section-periods.js')){
    html=html.replace('</body>','<script src="/v2/modules-v125-dashboard-section-periods.js?v=125.0" data-kun-dashboard-section-periods-v125="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v126-dashboard-finance-top.js')){
    html=html.replace('</body>','<script src="/v2/modules-v126-dashboard-finance-top.js?v=126.1" data-kun-dashboard-finance-top-v126="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v127-subscriptions.js')){
    html=html.replace('</body>','<script src="/v2/modules-v127-subscriptions.js?v=127.19" data-kun-subscriptions-v127="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v128-unit-tracking.js')){
    html=html.replace('</body>','<script src="/v2/modules-v128-unit-tracking.js?v=128.4" data-kun-unit-tracking-v128="1"></script></body>');
  }
  const headers=new Headers(asset.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','no-cache, no-store, must-revalidate');
  headers.set('X-Kun-Canonical-App','v2');
  headers.set('X-Kun-Data-Source','preview');
  headers.delete('Content-Length');
  return new Response(html,{status:asset.status,headers});
}

async function routeConfirmedOrdersToPrinting(request,response){
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/api/customer-service'||!response?.ok)return response;
  const data=await response.clone().json().catch(()=>null);
  if(!data||!Array.isArray(data.orders))return response;
  data.orders=data.orders.filter(order=>!PRINTING_STATES.has(String(order?.state||'')));
  if(Array.isArray(data.stages))data.stages=data.stages.filter(stage=>!PRINTING_STATES.has(String(stage?.id||'')));
  const headers=new Headers(response.headers);headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');headers.set('X-Kun-Data-Source','preview');headers.delete('Content-Length');
  return new Response(JSON.stringify(data),{status:response.status,headers});
}

function collaborationSchemaFailure(){
  return new Response(JSON.stringify({error:'تعذر تفعيل مخطط تواصل الفريق',code:'COLLAB_SCHEMA_BOOTSTRAP_FAILED'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env,ctx){
    const easyOrdersHealth=await handleProductionEasyOrdersHealth(request,env);
    if(easyOrdersHealth)return easyOrdersHealth;
    const parity=await handleProductionPreviewParity(request,env);
    if(parity)return parity;

    const mobileUpdate=await handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;

    const dataEnv=previewRuntimeEnv(env);
    const delegate=previewDelegate(env,dataEnv,ctx);
    const subscription=await handleSubscriptionControl({request,env:dataEnv,ctx,delegate});
    if(subscription)return subscription;

    const unitTracking=await handleInventoryUnitTracking({request,env:dataEnv,ctx,delegate});
    if(unitTracking)return unitTracking;

    const mobileSync=await handleMobileSync({request,load:async sourceRequest=>{
      const board=await handleProductionCustomerService({request:sourceRequest,env:dataEnv,ctx,delegate});
      return board?routeConfirmedOrdersToPrinting(sourceRequest,board):delegate.fetch(sourceRequest);
    }});
    if(mobileSync)return mobileSync;

    const mobileOrderGuard=await handleProductionMobileOrderGuard({request,env:dataEnv});
    if(mobileOrderGuard)return mobileOrderGuard;

    const callerJntEdit=await handleProductionCallerJntEdit({request,env:dataEnv,ctx,delegate});
    if(callerJntEdit)return callerJntEdit;

    const printing=await handleProductionPrintingQueue({request,env:dataEnv,ctx,delegate});
    if(printing)return syncInventoryTrackingAfterResponse({request,response:printing,env:dataEnv,actor:'production'});

    const customerService=await handleProductionCustomerService({request,env:dataEnv,ctx,delegate});
    if(customerService){
      const routed=await routeConfirmedOrdersToPrinting(request,customerService);
      return syncInventoryTrackingAfterResponse({request,response:routed,env:dataEnv,actor:'production'});
    }

    const collaborationOrderSearch=await handleCollaborationOrderSearch({request,env:dataEnv,ctx,delegate});
    if(collaborationOrderSearch)return collaborationOrderSearch;

    if(new URL(request.url).pathname.startsWith('/api/collaboration')){
      try{await ensureInternalCollaborationSchema(dataEnv);}catch{return collaborationSchemaFailure();}
    }
    const collaboration=await handleInternalCollaboration({request,env:dataEnv,ctx,delegate});
    if(collaboration)return collaboration;

    const website=await websiteWithDirectAndroidDownload(request,env);
    if(website)return website;

    if(shouldUsePreviewBackend(request)){
      const preview=await previewFetch(request,env);
      if(preview){
        const tracked=await syncInventoryTrackingAfterResponse({request,response:preview,env:dataEnv,actor:'production'});
        return reconcileFinancePresentation(request,tracked,dataEnv);
      }
    }

    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){
    const dataEnv=previewRuntimeEnv(env);
    ctx?.waitUntil?.(reconcileMonthlySubscriptions(dataEnv,{limit:1000}).catch(()=>[]));
    ctx?.waitUntil?.(reconcileTrackedOrderLifecycles(dataEnv,{limit:1000,actor:'scheduled'}).catch(()=>({ok:false})));
    if(String(event?.cron||'')==='0 */2 * * *'){
      ctx?.waitUntil?.(reconcileAllClientsUnitCoverage(dataEnv,{limit:1000,actor:'scheduled'}).catch(()=>({ok:false})));
    }
    return app.scheduled?.(event,env,ctx);
  }
};
