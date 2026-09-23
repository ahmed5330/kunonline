import app from './index-production-jt-history.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleProductionCustomerService} from './production-customer-service.js';
import {handleProductionMobileOrderGuard} from './production-mobile-order-guard.js';

const LEGACY_APK_URL='https://github.com/ahmed5330/kunonline/releases/download/android-latest/Kun-Online-Mobile.apk';
const DIRECT_APK_PATH='/api/mobile/app-update/apk';

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

export default {
  async fetch(request,env,ctx){
    const mobileUpdate=await handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;

    const mobileOrderGuard=await handleProductionMobileOrderGuard({request,env});
    if(mobileOrderGuard)return mobileOrderGuard;

    const customerService=await handleProductionCustomerService({request,env,ctx,delegate:app});
    if(customerService)return customerService;

    const website=await websiteWithDirectAndroidDownload(request,env);
    if(website)return website;

    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
