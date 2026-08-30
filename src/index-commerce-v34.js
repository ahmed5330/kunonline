import commerceV33 from './index-commerce-v33.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {syncMetaAdsForClient} from './meta-ads-sync.js';
import {syncMetaAdsGranular} from './meta-ads-granular.js';
import {metaAdsExpertAnalysisV2} from './meta-ads-expert.js';

const BUILD='preview-v34-2026-08-30-meta-ads-expert';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});

async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV33.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});return me;
}
function cleanDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):null;}
function requestedRange(input={}){const to=cleanDate(input.to)||new Date().toISOString().slice(0,10),rawFrom=String(input.from||''),from=rawFrom==='beginning'?null:cleanDate(rawFrom);let days=30;if(from){days=Math.max(1,Math.min(90,Math.floor((new Date(`${to}T00:00:00Z`)-new Date(`${from}T00:00:00Z`))/86400000)+1));}else if(rawFrom==='beginning')days=90;return {from:from||undefined,to,days};}

async function fetchV34(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v34.js'});
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

export default {fetch:fetchV34,scheduled(controller,env,ctx){return commerceV33.scheduled?.(controller,env,ctx);}};
