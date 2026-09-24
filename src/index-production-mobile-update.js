import app from './index-production-jt-history.js';
import {handleMobileSync} from './mobile-state-sync.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleProductionCustomerService} from './production-customer-service.js';
import {handleProductionMobileOrderGuard} from './production-mobile-order-guard.js';
import {handleProductionCallerJntEdit} from './production-caller-jnt-edit.js';
import {handleProductionPrintingQueue} from './production-printing-queue.js';

const LEGACY_APK_URL='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile.apk';
const DIRECT_APK_PATH='/api/mobile/app-update/apk';
const PRINTING_STATES=new Set(['confirmed','preparing']);

async function websiteWithDirectAndroidDownload(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET'||(url.pathname!=='/'&&url.pathname!=='/index.html'))return null;
  if(!env.ASSETS?.fetch)return null;

  const asset=await env.ASSETS.fetch(request);
  const type=String(asset.headers.get('Content-Type')||'');
  if(!asset.ok||!type.includes('text/html'))return asset;

  const html=(await asset.text()).replaceAll(LEGACY_APK_URL,DIRECT_APK_PATH);
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

    const website=await websiteWithDirectAndroidDownload(request,env);
    if(website)return website;

    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
