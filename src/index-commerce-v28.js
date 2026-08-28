import commerceV27 from './index-commerce-v27.js';
import {
  requireTeamManager,resolveTeamClient,teamRoleCatalog,listTeamMembers,createTeamMember,updateTeamMember,
  resetTeamMemberPassword,replaceTeamMemberStoreAccess,deleteTeamMember,teamStaffCount
} from './team-management.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope,requestedStoreId} from './store-scope.js';
import {campaignPerformance,dateRange} from './marketing-performance.js';
import {syncMetaAdsForClient,syncAllConnectedMetaAds} from './meta-ads-sync.js';

const BUILD='preview-v28-2026-08-28';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'
}});

async function currentUser(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const response=await commerceV27.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}
async function bodyOf(request){return ['POST','PUT','PATCH','DELETE'].includes(request.method.toUpperCase())?await request.clone().json().catch(()=>({})):{};}
function requestedClient(url,body={}){return body.clientId||body.client_id||url.searchParams.get('clientId')||null;}
async function audit(env,me,clientId,storeId,action,entityId,metadata={}){try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,storeId||null,me?.uid||null,me?.email||me?.role||'user',action,'store_connection',entityId||null,JSON.stringify(metadata),new Date().toISOString()).run();}catch{}}

async function onboardingV28(request,env,ctx,me,clientId){
  const response=await commerceV27.fetch(request,env,ctx);if(!response.ok)return response;
  const data=await response.clone().json().catch(()=>null);if(!data||!Array.isArray(data.checks))return response;
  const staff=await teamStaffCount(env,clientId);data.checks=data.checks.map(x=>x.key==='team'?{...x,label:'إضافة عضو فريق بصلاحية فرع',done:staff>0}:x);
  data.completed=data.checks.filter(x=>x.done).length;data.total=data.checks.length;data.percent=data.total?Math.round(data.completed/data.total*100):100;data.ready=data.completed===data.total;data.teamMembers=staff;
  return json(data,response.status);
}

async function fetchV28(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v28.js'});
    const isTeam=path==='/api/team-role-catalog'||path==='/api/team-members'||path.startsWith('/api/team-members/')||path==='/api/onboarding/status';
    const isMetaAds=path==='/api/integrations/meta-ads/sync'||path==='/api/integrations/meta-ads/performance';
    if(!isTeam&&!isMetaAds)return commerceV27.fetch(request,env,ctx);
    const me=await currentUser(request,env,ctx),body=await bodyOf(request);

    if(isMetaAds){
      const clientId=resolveTenant(me,requestedClient(url,body));
      const write=path.endsWith('/sync');
      requirePermission(me,'campaigns',write?'write':'read');
      const scope=await resolveStoreScope(env,me,clientId,requestedStoreId(request,body),{write});
      if(path==='/api/integrations/meta-ads/performance'&&method==='GET'){
        const range=dateRange(url);return json(await campaignPerformance(env,{clientId,storeId:scope.storeId||null,...range,platform:'meta_ads'}));
      }
      if(path==='/api/integrations/meta-ads/sync'&&method==='POST'){
        const result=await syncMetaAdsForClient(env,{clientId,storeId:scope.storeId||null,from:body.from,to:body.to,days:body.days});
        await audit(env,me,clientId,result.storeId,'integration.meta_ads.sync',`act_${result.account?.accountId||''}`,{campaigns:result.campaigns,activeCampaigns:result.activeCampaigns,dailyMetrics:result.dailyMetrics,from:result.from,to:result.to});
        return json(result);
      }
      return json({error:'المسار غير مدعوم',code:'METHOD_NOT_ALLOWED'},405);
    }

    if(path==='/api/team-role-catalog'&&method==='GET'){requireTeamManager(me);return json(teamRoleCatalog());}
    const clientId=resolveTeamClient(me,requestedClient(url,body));requireTeamManager(me);
    if(path==='/api/onboarding/status'&&method==='GET')return onboardingV28(request,env,ctx,me,clientId);
    if(path==='/api/team-members'&&method==='GET')return json(await listTeamMembers(env,clientId));
    if(path==='/api/team-members'&&method==='POST')return json(await createTeamMember(env,clientId,body,me),201);
    let m=path.match(/^\/api\/team-members\/([^/]+)$/);
    if(m&&method==='PATCH')return json(await updateTeamMember(env,clientId,decodeURIComponent(m[1]),body,me));
    if(m&&method==='DELETE')return json(await deleteTeamMember(env,clientId,decodeURIComponent(m[1]),me));
    m=path.match(/^\/api\/team-members\/([^/]+)\/reset-password$/);
    if(m&&method==='POST')return json(await resetTeamMemberPassword(env,clientId,decodeURIComponent(m[1]),body,me));
    m=path.match(/^\/api\/team-members\/([^/]+)\/store-access$/);
    if(m&&method==='PUT')return json(await replaceTeamMemberStoreAccess(env,clientId,decodeURIComponent(m[1]),body,me));
    return json({error:'المسار غير مدعوم',code:'METHOD_NOT_ALLOWED'},405);
  }catch(error){
    return json({error:error?.message||'حدث خطأ',code:error?.code||'V28_ERROR',path,method},error?.status||500);
  }
}

export default {
  fetch:fetchV28,
  scheduled(controller,env,ctx){
    if(controller?.cron==='0 */2 * * *')ctx.waitUntil(syncAllConnectedMetaAds(env,{days:30}).catch(()=>[]));
    return commerceV27.scheduled?.(controller,env,ctx);
  }
};
