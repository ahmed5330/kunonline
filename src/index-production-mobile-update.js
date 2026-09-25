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

const LEGACY_APK_URL='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile.apk';
const DIRECT_APK_PATH='/api/mobile/app-update/apk';
const PRINTING_STATES=new Set(['confirmed','preparing']);
const HTML_PATHS=new Set(['/','/index.html','/v2/','/v2/index.html']);

async function websiteWithDirectAndroidDownload(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET'||!HTML_PATHS.has(url.pathname))return null;
  if(!env.ASSETS?.fetch)return null;

  const asset=await env.ASSETS.fetch(request);
  const type=String(asset.headers.get('Content-Type')||'');
  if(!asset.ok||!type.includes('text/html'))return asset;

  let html=await asset.text();
  html=html
    .replaceAll(LEGACY_APK_URL,DIRECT_APK_PATH)
    .replaceAll('/v2/modules-v51-permission-navigation.js?v=51.10','/v2/modules-v51-permission-navigation.js?v=51.11')
    .replaceAll('/v2/modules-v78-jt-shipping-order.js?v=78.4','/v2/modules-v78-jt-shipping-order.js?v=78.5')
    .replaceAll('/v2/modules-v79-printing.js?v=79.7','/v2/modules-v79-printing.js?v=79.8')
    .replaceAll('/v2/modules-v118-collaboration-order-picker.js?v=118.0','/v2/modules-v118-collaboration-order-picker.js?v=118.1');
  if(!html.includes('/v2/modules-v116-print-routing.js')){
    html=html.replace('</body>','<script src="/v2/modules-v116-print-routing.js?v=116.0" data-kun-print-routing="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v117-team-collaboration.js')){
    html=html.replace('</body>','<script src="/v2/modules-v117-team-collaboration.js?v=117.0" data-kun-team-collaboration="1"></script></body>');
  }
  if(!html.includes('/v2/modules-v118-collaboration-order-picker.js')){
    html=html.replace('</body>','<script src="/v2/modules-v118-collaboration-order-picker.js?v=118.1" data-kun-collaboration-order-picker="1"></script></body>');
  }
  const headers=new Headers(asset.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','no-cache, no-store, must-revalidate');
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
  const headers=new Headers(response.headers);headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');headers.delete('Content-Length');
  return new Response(JSON.stringify(data),{status:response.status,headers});
}

function collaborationSchemaFailure(){
  return new Response(JSON.stringify({error:'تعذر تفعيل مخطط تواصل الفريق',code:'COLLAB_SCHEMA_BOOTSTRAP_FAILED'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env,ctx){
    const mobileUpdate=await handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;

    const mobileSync=await handleMobileSync({request,load:async sourceRequest=>{
      const board=await handleProductionCustomerService({request:sourceRequest,env,ctx,delegate:app});
      return board?routeConfirmedOrdersToPrinting(sourceRequest,board):app.fetch(sourceRequest,env,ctx);
    }});
    if(mobileSync)return mobileSync;

    const mobileOrderGuard=await handleProductionMobileOrderGuard({request,env});
    if(mobileOrderGuard)return mobileOrderGuard;

    const callerJntEdit=await handleProductionCallerJntEdit({request,env,ctx,delegate:app});
    if(callerJntEdit)return callerJntEdit;

    const printing=await handleProductionPrintingQueue({request,env,ctx,delegate:app});
    if(printing)return printing;

    const customerService=await handleProductionCustomerService({request,env,ctx,delegate:app});
    if(customerService)return routeConfirmedOrdersToPrinting(request,customerService);

    const collaborationOrderSearch=await handleCollaborationOrderSearch({request,env,ctx,delegate:app});
    if(collaborationOrderSearch)return collaborationOrderSearch;

    if(new URL(request.url).pathname.startsWith('/api/collaboration')){
      try{await ensureInternalCollaborationSchema(env);}catch{return collaborationSchemaFailure();}
    }
    const collaboration=await handleInternalCollaboration({request,env,ctx,delegate:app});
    if(collaboration)return collaboration;

    const website=await websiteWithDirectAndroidDownload(request,env);
    if(website)return website;

    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
