import {handleHRDirectory} from './hr-directory.js';
import {handleDocumentSettings} from './document-settings.js';
import {guardSessionRequest} from './session-request-guard.js';
import {handleFinancialAccountingOS} from './accounting-faos-api.js';
import {routeProductionCodRead} from './production-cod-read-fallback.js';
import app from './index-production-jt-history.js';
import {handlePublicSiteReviews} from './public-site-reviews.js';
import {handleAIMarketing} from './ai-marketing-analyst.js';
import {handleMobileSync} from './mobile-state-sync.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleProductionCustomerService} from './production-customer-service.js';
import {handleProductionMobileOrderGuard} from './production-mobile-order-guard.js';
import {handleProductionCallerJntEdit} from './production-caller-jnt-edit.js';
import {handleProductionJntShippingEdit} from './production-jnt-shipping-edit.js';
import {handleProductionPrintingQueue} from './production-printing-queue.js';
import {handleJtPrintWorkflowV2} from './jt-print-workflow-v2.js';
import {handleInternalCollaboration} from './internal-collaboration.js';
import {handleCollaborationOrderSearch} from './internal-collaboration-order-search.js';
import {handleMobileOrderSearch} from './mobile-global-order-search.js';
import {handleMobileStoreOptions} from './mobile-store-options.js';
import {handleProductionClientContext} from './production-client-context.js';
import {handleMobileOrderAlerts} from './mobile-order-alerts.js';
import {ensureInternalCollaborationSchema} from './internal-collaboration-schema.js';
import {handleProductionPreviewParity} from './production-preview-parity.js';
import {handleProductionEasyOrdersHealth} from './production-easyorders-health.js';
import {handleTenantEasyOrdersHealth} from './tenant-easyorders-health.js';
import {reconcileFinancePresentation} from './production-finance-presentation.js';
import {reconcileMonthlySubscriptions} from './subscription-billing.js';
import {handleSubscriptionControl} from './subscription-control.js';
import {handleInventoryUnitTracking,syncInventoryTrackingAfterResponse,reconcileTrackedOrderLifecycles,reconcileAllClientsUnitCoverage} from './inventory-unit-tracking.js';
import {handleAdminJntShipments} from './admin-jnt-shipments.js';
import {handleKunMcpOAuth} from './kun-chatgpt-mcp-oauth.js';
import {handleKunMcpServer} from './kun-chatgpt-mcp-server.js';
import {handleAiIntegrations} from './ai-integrations.js';

const LEGACY_APK_URL='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile.apk';
const DIRECT_APK_PATH='/api/mobile/app-update/apk';
const HTML_PATHS=new Set(['/','/index.html','/v2','/v2/','/v2/index.html']);
// Auth endpoints must reach one signer/verifier, without billing, finance or UI response adapters.
const AUTH_PATHS=new Set(['/api/login','/api/me','/api/logout']);

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
  if(!html.includes('/v2/hr-directory-ui.js'))html=html.replace('</body>','<script src="/v2/hr-directory-ui.js?v=1.0"></script></body>');
  html=html.replace(/modules-v128-unit-tracking\.js\?v=[^"']+/g,'modules-v128-unit-tracking.js?v=128.5');
  if(!html.includes('/v2/document-settings-ui.js'))html=html.replace('</body>','<script type="module" src="/v2/document-settings-ui.js?v=1.0"></script></body>');
  html=html.replace(/modules-v155-accounting-faos\.js\?v=[^"']+/g,'modules-v155-accounting-faos.js?v=155.5');
  html=html.replace(/modules-v31-customer-service\.js\?v=[^"']+/g,'modules-v31-customer-service.js?v=31.3.5');
  if(!html.includes('/v2/order-followups.js'))html=html.replace('</body>','<script src="/v2/order-followups.js?v=1.0"></script></body>');
  if(!html.includes('/v2/modules-v161-order-freshness.js'))
    html=html.replace('</body>','<script src="/v2/modules-v161-order-freshness.js?v=161.0" defer></script></body>');
  html=html
    .replace(/\/v2\/modules-v46-variant-inventory-sync\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v46-variant-inventory-sync.js?v=46.5')
    .replace(/\/v2\/modules-v43-product-catalog\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v43-product-catalog.js?v=43.1')
    .replace(/\/v2\/app-v3\.js(?:\?v=[\d.]+)?/g,'/v2/app-v3.js?v=3.3')
    .replace(/\/v2\/modules-v19\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v19.js?v=20.3')
    .replace(/\/v2\/modules-v22\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v22.js?v=22.1')
    .replace(/\/v2\/modules-v80-jnt-address-cascade-v805\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v80-jnt-address-cascade-v805.js?v=80.6')
    .replace(/\/v2\/modules-v121-dashboard-sync-guard\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v121-dashboard-sync-guard.js?v=121.4')
    .replace(/\/v2\/modules-v122-dashboard-experience\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v122-dashboard-experience.js?v=122.4')
    .replace(/\/v2\/modules-v123-dashboard-unified\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v123-dashboard-unified.js?v=123.1')
    .replace(/\/v2\/modules-v124-dashboard-periods-province\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v124-dashboard-periods-province.js?v=124.2')
    .replace(/\/v2\/modules-v49-easyorders-recovery\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v49-easyorders-recovery.js?v=49.3')
    .replaceAll(LEGACY_APK_URL,DIRECT_APK_PATH)
    .replaceAll('/v2/modules-v51-permission-navigation.js?v=51.10','/v2/modules-v51-permission-navigation.js?v=51.17')
    .replace(/\/v2\/modules-v57-section-reload\.js(?:\?v=[\d.]+)?/g,'/v2/modules-v57-section-reload.js?v=57.3')
    .replaceAll('/v2/modules-v78-jt-shipping-order.js?v=78.4','/v2/modules-v78-jt-shipping-order.js?v=78.5')
    .replaceAll('/v2/modules-v79-printing.js?v=79.7','/v2/modules-v79-printing.js?v=79.12')
    .replaceAll('/v2/modules-v117-team-collaboration.js?v=117.0','/v2/modules-v117-team-collaboration.js?v=117.3')
    .replaceAll('/v2/modules-v118-collaboration-order-picker.js?v=118.0','/v2/modules-v118-collaboration-order-picker.js?v=118.1.1');
  // v57 owns the ordered v66 -> v67 -> v68... chain. Injecting v66/v67 here
  // executes them twice and splits the hub state from its event handlers.
  html=html.replace(/order-document-preview\.js\?v=[^"']+/g,'order-document-preview.js?v=1.1');
  if(!html.includes('/v2/order-document-preview.js'))html=html.replace('</body>','<script src="/v2/order-document-preview.js?v=1.1"></script></body>');
  html=html.replace(/modules-v79-printing\.js\?v=[^"']+/g,'modules-v79-printing.js?v=79.12');
  if(!html.includes('/v2/modules-v116-print-routing.js')){
    html=html.replace('</body>','<script src="/v2/modules-v116-print-routing.js?v=116.1" data-kun-print-routing="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v117-team-collaboration.js')){
    html=html.replace('</body>','<script src="/v2/modules-v117-team-collaboration.js?v=117.3" data-kun-team-collaboration="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v118-collaboration-order-picker.js')){
    html=html.replace('</body>','<script src="/v2/modules-v118-collaboration-order-picker.js?v=118.1.1" data-kun-collaboration-order-picker="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v121-dashboard-sync-guard.js')){
    html=html.replace('</body>','<script src="/v2/modules-v121-dashboard-sync-guard.js?v=121.4" data-kun-dashboard-sync-guard="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v122-dashboard-experience.js')){
    html=html.replace('</body>','<script src="/v2/modules-v122-dashboard-experience.js?v=122.4" data-kun-dashboard-experience="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v123-dashboard-unified.js')){
    html=html.replace('</body>','<script src="/v2/modules-v123-dashboard-unified.js?v=123.1" data-kun-dashboard-unified="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v124-dashboard-periods-province.js')){
    html=html.replace('</body>','<script src="/v2/modules-v124-dashboard-periods-province.js?v=124.2" data-kun-dashboard-periods-v124="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v125-dashboard-section-periods.js')){
    html=html.replace('</body>','<script src="/v2/modules-v125-dashboard-section-periods.js?v=125.3" data-kun-dashboard-section-periods-v125="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v126-dashboard-finance-top.js')){
    html=html.replace('</body>','<script src="/v2/modules-v126-dashboard-finance-top.js?v=126.5" data-kun-dashboard-finance-top-v126="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v127-subscriptions.js?v=127.22')){
    html=html.replace('</body>','<script src="/v2/modules-v127-subscriptions.js?v=127.22" data-kun-subscriptions-v127="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v128-unit-tracking.js')){
    html=html.replace('</body>','<script src="/v2/modules-v128-unit-tracking.js?v=128.5" data-kun-unit-tracking-v128="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v154-admin-jnt-shipments.js')){
    html=html.replace('</body>','<script src="/v2/modules-v154-admin-jnt-shipments.js?v=154.0" data-kun-admin-jnt-shipments="1"></script></body>');
  }
  const headers=new Headers(asset.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','no-cache, no-store, must-revalidate');
  headers.set('X-Kun-Canonical-App','v2');
  headers.set('X-Kun-Data-Source','preview');
  headers.delete('Content-Length');
  return new Response(html,{status:asset.status,headers});
}

// The same order must be readable in Customer Service and Printing.
// Never hide confirmed/preparing records from the Customer Service response.
function preserveCustomerServiceOrderVisibility(_request,response){return response;}

function collaborationSchemaFailure(){
  return new Response(JSON.stringify({error:'تعذر تفعيل مخطط تواصل الفريق',code:'COLLAB_SCHEMA_BOOTSTRAP_FAILED'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env,ctx){
    const sessionGuard=guardSessionRequest(request);if(sessionGuard)return sessionGuard;
    // Public marketing reviews and admin moderation remain isolated from
    // customer/store subscriptions and from Preview database forwarding.
    const websiteReviews=await handlePublicSiteReviews(request,env,{
      authorizeAdmin:async sourceRequest=>{
        const identityUrl=new URL('/api/me',sourceRequest.url);
        const identityRequest=new Request(identityUrl.toString(),{method:'GET',headers:sourceRequest.headers});
        const identity=await previewFetch(identityRequest,env)||
          await app.fetch(identityRequest,previewRuntimeEnv(env),ctx);
        if(!identity.ok)return null;
        return identity.json().catch(()=>null);
      }
    });
    if(websiteReviews)return websiteReviews;
    const easyOrdersHealth=await handleProductionEasyOrdersHealth(request,env);
    if(easyOrdersHealth)return easyOrdersHealth;
    const parity=await handleProductionPreviewParity(request,env,{
      authorizeAdmin:async sourceRequest=>{
        const identityUrl=new URL('/api/me',sourceRequest.url);
        const identityRequest=new Request(identityUrl.toString(),{method:'GET',headers:sourceRequest.headers});
        const identity=await previewFetch(identityRequest,env)||
          await app.fetch(identityRequest,previewRuntimeEnv(env),ctx);
        return identity.ok?identity.json().catch(()=>null):null;
      }
    });
    if(parity)return parity;

    const mobileUpdate=await handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;

    // A successful /api/login issues ko_session on the *same* origin as /api/me.
    // Send both endpoints to the same upstream unchanged, including Cookie and
    // Set-Cookie. Do not let subscription or finance middleware rewrite them.
    // If the service binding is absent, both use the same local fallback.
    if(request.method==='GET'&&new URL(request.url).pathname==='/api/preview/growth-release')return await previewFetch(request,env)||app.fetch(request,previewRuntimeEnv(env),ctx);

    if(AUTH_PATHS.has(new URL(request.url).pathname)){
      const identity=await previewFetch(request,env);
      return identity||app.fetch(request,previewRuntimeEnv(env),ctx);
    }

    const dataEnv=previewRuntimeEnv(env);
    const delegate=previewDelegate(env,dataEnv,ctx);
    // Keep staff client discovery and mobile store grants on the same canonical
    // live D1/identity, even when an older Preview worker serves legacy routes.
    const currentClientContext=await handleProductionClientContext({request,env:dataEnv,delegate});
    if(currentClientContext)return currentClientContext;
    const faos=await handleFinancialAccountingOS({request,env:dataEnv,ctx,delegate});
    if(faos)return faos;
    const codRead=await routeProductionCodRead({request,
      fetchPreview:source=>previewFetch(source,env),
      fetchLocal:source=>app.fetch(source,dataEnv,ctx)});
    if(codRead)return codRead;
    // Preview-backed customer data is live: never silently fall back to a
    // different D1 source for this status. Fail closed if bindings are absent.
    if(new URL(request.url).pathname==='/api/integrations/easyorders/dashboard-health'){
      if(!env.PREVIEW_DB||!env.PREVIEW_APP?.fetch)
        return new Response(JSON.stringify({error:'HEALTH_UNAVAILABLE'}),{
          status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
        });
      const tenantHealth=await handleTenantEasyOrdersHealth(request,dataEnv,{
        authorize:async incoming=>{
          const identity=new URL('/api/me',incoming.url);
          const auth=await previewFetch(new Request(identity,{method:'GET',headers:incoming.headers}),env);
          return auth?.ok?auth.json().catch(()=>null):null;
        }
      });
      if(tenantHealth)return tenantHealth;
    }
    const mcpAuth=await handleKunMcpOAuth({request,env:dataEnv,delegate});
    if(mcpAuth)return mcpAuth;
    const mcpTools=await handleKunMcpServer({request,env:dataEnv});
    if(mcpTools)return mcpTools;
    const aiIntegrations=await handleAiIntegrations({request,env:dataEnv,delegate});
    if(aiIntegrations)return aiIntegrations;
    const mobileStoreOptions=await handleMobileStoreOptions({request,env:dataEnv,delegate});
    if(mobileStoreOptions)return mobileStoreOptions;
    const newOrderAlerts=await handleMobileOrderAlerts({request,env:dataEnv,delegate});
    if(newOrderAlerts)return newOrderAlerts;
    const adminJntShipments=await handleAdminJntShipments({request,env:dataEnv,delegate});
    if(adminJntShipments)return adminJntShipments;
    // Keep the actual AI analyst on this deployed version; the Preview backend can lag the UI.
    // Authentication and store checks still use the same preview identity delegate.
    const aiMarketing=await handleAIMarketing({request,env:dataEnv,ctx,delegate});
    if(aiMarketing)return aiMarketing;
    const subscription=await handleSubscriptionControl({request,env:dataEnv,ctx,delegate});
    if(subscription)return subscription;

    const unitTracking=await handleInventoryUnitTracking({request,env:dataEnv,ctx,delegate});
    if(unitTracking)return unitTracking;

    const mobileSync=await handleMobileSync({request,load:async sourceRequest=>{
      const board=await handleProductionCustomerService({request:sourceRequest,env:dataEnv,ctx,delegate});
      return board?preserveCustomerServiceOrderVisibility(sourceRequest,board):delegate.fetch(sourceRequest);
    }});
    if(mobileSync)return mobileSync;

    const mobileOrderGuard=await handleProductionMobileOrderGuard({request,env:dataEnv});
    if(mobileOrderGuard)return mobileOrderGuard;

    const jntShippingEdit=await handleProductionJntShippingEdit({request,env:dataEnv,ctx,delegate});
    if(jntShippingEdit)return jntShippingEdit;

    const callerJntEdit=await handleProductionCallerJntEdit({request,env:dataEnv,ctx,delegate});
    if(callerJntEdit)return callerJntEdit;

    // Keep queue, official printing, and void on the SAME canonical D1 and
    // current workflow implementation as the Customer Service / Printing views.
    // Forwarding only queue/print to an older Preview service version can leave
    // confirmed orders stuck or write the shipping transition through a
    // different implementation. No carrier action occurs without an explicit POST.
    if(/^\/api\/jt\/shipments\/[^/]+(?:\/(?:print|void))?$/.test(new URL(request.url).pathname)&&request.method==='POST'){
      try{
        const identityUrl=new URL('/api/me',request.url);
        const identityResponse=await delegate.fetch(new Request(identityUrl.toString(),{method:'GET',headers:request.headers}));
        const me=await identityResponse.json().catch(()=>({}));
        if(!identityResponse.ok||!me?.role)return new Response(JSON.stringify({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'}),{status:401,headers:{'Content-Type':'application/json'}});
        const result=await handleJtPrintWorkflowV2({request,env:dataEnv,ctx,delegate,me});
        if(result)return result;
      }catch(error){
        return new Response(JSON.stringify({error:error?.message||'تعذر تنفيذ إجراء J&T',code:error?.code||'JT_SHIPPING_WORKFLOW_ERROR'}),{status:Number(error?.status)>=400&&Number(error.status)<600?Number(error.status):500,headers:{'Content-Type':'application/json; charset=utf-8'}});
      }
    }

    const hrDirectory=await handleHRDirectory({request,env:dataEnv,ctx,delegate:delegate});if(hrDirectory)return hrDirectory;
    const documentSettings=await handleDocumentSettings({request,env:dataEnv,ctx,delegate:delegate});if(documentSettings)return documentSettings;
    const printing=await handleProductionPrintingQueue({request,env:dataEnv,ctx,delegate});
    if(printing)return syncInventoryTrackingAfterResponse({request,response:printing,env:dataEnv,actor:'production'});

    const customerService=await handleProductionCustomerService({request,env:dataEnv,ctx,delegate});
    if(customerService){
      const routed=await preserveCustomerServiceOrderVisibility(request,customerService);
      return syncInventoryTrackingAfterResponse({request,response:routed,env:dataEnv,actor:'production'});
    }

    const globalOrderSearch=await handleMobileOrderSearch({request,env:dataEnv,ctx,delegate});
    if(globalOrderSearch)return globalOrderSearch;

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
