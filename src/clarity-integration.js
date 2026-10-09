/* Microsoft Clarity — isolated, per-store analytics integration for Kun Online.
 * Storefront tracking is installed on the merchant's storefront, never on the admin dashboard.
 * Clarity Data Export API is aggregate-only; no recording/heatmap export is implied.
 */
import {encryptSecret,decryptSecret} from './integration-secrets.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {reportFromCapture,mergeMetaWithClarity,sanitizeClarityExport} from './clarity-growth-insights.js';
import {metaAdsExpertAnalysisV2} from './meta-ads-expert.js';

const CLARITY_API='https://www.clarity.ms/export-data/api/v1/project-live-insights';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const clean=v=>String(v??'').trim();
const err=(message,status=400,code='CLARITY_INVALID')=>Object.assign(new Error(message),{status,code});
const today=()=>new Date().toISOString().slice(0,10);
export function clarityDays(v=1){const str=String(v??1).trim();if(!/^[123]$/.test(str))throw err('فترة Clarity المسموحة 24 أو 48 أو 72 ساعة فقط',400,'CLARITY_INVALID_DAYS');return Number(str);}
const snapshotDays=(raw)=>{try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;return clarityDays(parsed?.days||1);}catch{return 1;}};

export function clarityProjectId(input){
  const raw=clean(input);
  const tag=raw.match(/clarity\.ms\/tag\/([a-zA-Z0-9_-]+)/i);
  const snippet=raw.match(/["']clarity["']\s*,\s*["']script["']\s*,\s*["']([a-zA-Z0-9_-]+)["']/i);
  const value=tag?.[1]||snippet?.[1]||raw;
  if(!/^[a-zA-Z0-9_-]{5,40}$/.test(value))throw err('ضع Project ID الصحيح من Microsoft Clarity أو كود التثبيت كاملًا');
  return value;
}
export function clarityTraffic(rows,dimension){
  if(!Array.isArray(rows))return [];
  const traffic=rows.find(x=>String(x?.metricName||'').toLowerCase()==='traffic');
  const map=new Map();
  for(const r of traffic?.information||[]){
    const label=clean(r?.[dimension])||'غير محدد';
    const count=Math.max(0,Number(r?.totalSessionCount)||0);
    const found=map.get(label)||{name:label,sessions:0,botSessions:0,users:0};
    found.sessions+=count;
    found.botSessions+=Math.max(0,Number(r?.totalBotSessionCount)||0);
    // Distinct users cannot safely be added across separate Source/Device segments.
    found.users=null;
    map.set(label,found);
  }
  return [...map.values()].sort((a,b)=>b.sessions-a.sessions).slice(0,60);
}
export function clarityMetrics(raw){
  if(!Array.isArray(raw))return [];
  return raw.map(x=>({name:String(x?.metricName||'').slice(0,80),information:(Array.isArray(x?.information)?x.information:[]).slice(0,1000)})).slice(0,30);
}

// Weighted session percentages from campaign x source segments; never add percentages.
export function clarityCampaignFriction(metrics){
  if(!Array.isArray(metrics))return [];
  const names=['RageClickCount','DeadClickCount','ScriptErrorCount','ErrorClickCount','QuickbackClick','ExcessiveScroll'];
  const results=new Map();
  for(const metric of metrics){
    if(!names.includes(metric?.name||metric?.metricName))continue;
    const name=metric.name||metric.metricName;
    for(const row of metric.information||[]){
      const campaign=clean(row.Campaign)||'غير محدد';
      const sessions=Number(row.sessionsCount);
      const rate=Number(row.sessionsWithMetricPercentage);
      if(!Number.isFinite(sessions)||sessions<=0||!Number.isFinite(rate)||rate<0||rate>100)continue;
      const data=results.get(campaign)||{campaign};
      const current=data[name]||{weightedTotal:0,sessions:0};
      current.weightedTotal+=rate*sessions;
      current.sessions+=sessions;
      data[name]=current;
      results.set(campaign,data);
    }
  }
  return [...results.values()].map(item=>{
    const entry={campaign:item.campaign};
    for(const name of names){
      const x=item[name];
      entry[name]=x?.sessions?Number((x.weightedTotal/x.sessions).toFixed(2)):null;
    }
    return entry;
  });
}
// Tables are created by migration 0095, not at request time.
async function rowFor(env,clientId,storeId){
  return env.DB.prepare("SELECT * FROM clarity_connections WHERE client_id=? AND store_id=?").bind(clientId,storeId).first();
}
function publicStatus(row){
  return {configured:!!row,projectId:row?.project_id||null,hasApiToken:!!row?.token_ciphertext_b64,status:row?.status||'disconnected',lastSyncAt:row?.last_sync_at||null,lastError:row?.last_error||null,quotaUsedToday:row?.quota_day===today()?Number(row?.quota_count||0):0,quotaBudget:8,requestsPerSync:3,trackingVerified:false,trackingNote:'التحقق من API لا يثبت تثبيت كود التتبع على المتجر. راجع Live Sessions من لوحة Clarity.'};
}
async function userScope(request,env,ctx,delegate,body,write=false,resource='integrations'){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const meRes=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await meRes.json().catch(()=>({}));
  if(!meRes.ok||!me?.role)throw err('سجل دخولك أولاً',401,'AUTH_REQUIRED');
  requirePermission(me,resource,write?'write':'read');
  const params=new URL(request.url).searchParams;
  const clientId=resolveTenant(me,body?.clientId||params.get('clientId')||null);
  const storeId=clean(body?.storeId||params.get('storeId'));
  if(!storeId)throw err('اختار متجرًا محددًا من أعلى الصفحة قبل إعداد Clarity',400,'CLARITY_STORE_REQUIRED');
  const scope=await resolveStoreScope(env,me,clientId,storeId,{write});
  return {me,clientId,storeId:scope.storeId};
}
async function clarityGet(token,dimensions,days=1){
  const u=new URL(CLARITY_API);
  u.searchParams.set('numOfDays',String(clarityDays(days)));
  if(dimensions.length<1||dimensions.length>3)throw err('حد Clarity المسموح 3 أبعاد لكل استدعاء');
  for(const [i,d] of dimensions.entries())u.searchParams.set('dimension'+(i+1),d);
  let response;
  try{response=await fetch(u.toString(),{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(15000)});}
  catch(e){throw err('تعذر الوصول لخدمة Microsoft Clarity',502,'CLARITY_UNREACHABLE');}
  if(!response.ok){
    const errorCode=response.status===401?'CLARITY_TOKEN_INVALID':response.status===403?'CLARITY_TOKEN_FORBIDDEN':response.status===429?'CLARITY_PROVIDER_RATE_LIMIT':'CLARITY_UPSTREAM_ERROR';
    throw err('تعذر الاتصال بـMicrosoft Clarity (HTTP '+response.status+')',response.status===429?429:502,errorCode);
  }
  const data=await response.json().catch(()=>null);
  if(!Array.isArray(data))throw err('استجابة Microsoft Clarity غير متوقعة',502,'CLARITY_RESPONSE_INVALID');
  return sanitizeClarityExport(clarityMetrics(data));
}
async function syncOne(env,clientId,storeId,{force=false,days=1}={}){
  days=clarityDays(days);
  const row=await rowFor(env,clientId,storeId);
  if(!row)throw err('اربط Clarity بهذا المتجر أولاً',404,'CLARITY_NOT_CONNECTED');
  if(!row.token_ciphertext_b64||!row.token_iv_b64)throw err('أضف Data Export API Token لتفعيل التحليلات',409,'CLARITY_TOKEN_REQUIRED');
  // Three provider calls per snapshot; eight reserved daily calls per project, two held back.
  // Cached windows must match exactly: a 72-hour export is not a substitute for 24-hour data.
  const cached=await env.DB.prepare('SELECT synced_at,device_json FROM clarity_snapshots WHERE client_id=? AND store_id=? AND project_id=? ORDER BY synced_at DESC LIMIT 30').bind(clientId,storeId,row.project_id).all();
  const usable=(cached.results||[]).find(x=>snapshotDays(x.device_json)===days&&Number.isFinite(Date.parse(x.synced_at))&&Date.now()-Date.parse(x.synced_at)<4*3600000);
  if(!force&&row.last_sync_at&&usable)return {ok:true,skipped:true,reason:'fresh_cache',days,syncedAt:usable.synced_at,...publicStatus(row)};
  const day=today();
  const attemptAt=new Date().toISOString();
  const reserved=await env.DB.prepare("UPDATE clarity_connections SET quota_count=CASE WHEN quota_day=? THEN quota_count+3 ELSE 3 END,quota_day=?,last_attempt_at=?,updated_at=? WHERE client_id=? AND store_id=? AND (quota_day IS NULL OR quota_day<>? OR quota_count<=5)").bind(day,day,attemptAt,attemptAt,clientId,storeId,day).run();
  if(!reserved?.meta?.changes)throw err('تم بلوغ الحد الآمن للمزامنة اليوم. أعد المحاولة غدًا.',429,'CLARITY_DAILY_BUDGET');
  let token;
  try{token=await decryptSecret(env,row.token_ciphertext_b64,row.token_iv_b64);}
  catch{throw err('تعذر قراءة توكن Clarity المشفر',503,'CLARITY_SECRET_DECRYPT_FAILED');}
  try{
    const campaign=await clarityGet(token,['Campaign','Source','Device'],days);
    // Second view covers page URLs, media, and channels; per-URL sessions must not be totaled across pages.
    const pages=await clarityGet(token,['URL','Medium','Channel'],days);
    const technology=await clarityGet(token,['Browser','OS','Country/Region'],days);
    const device={version:2,days,pages,technology};
    const syncedAt=new Date().toISOString();
    await env.DB.prepare("INSERT INTO clarity_snapshots (client_id,store_id,synced_at,project_id,campaign_json,device_json) VALUES (?,?,?,?,?,?)").bind(clientId,storeId,syncedAt,row.project_id,JSON.stringify(campaign),JSON.stringify(device)).run();
    await env.DB.prepare("UPDATE clarity_connections SET status='connected',last_sync_at=?,last_error=NULL,updated_at=? WHERE client_id=? AND store_id=?").bind(syncedAt,syncedAt,clientId,storeId).run();
    return {ok:true,skipped:false,syncedAt,projectId:row.project_id,days,quotaUsedToday:(row.quota_day===day?Number(row.quota_count):0)+3};
  }catch(e){
    const message=e.code==='CLARITY_TOKEN_INVALID'?'API Token غير صالح أو منتهي':e.message;
    await env.DB.prepare("UPDATE clarity_connections SET status='error',last_error=?,updated_at=? WHERE client_id=? AND store_id=?").bind(message,new Date().toISOString(),clientId,storeId).run();
    throw e;
  }
}
async function saveConnection(env,clientId,storeId,body){
  const projectId=clarityProjectId(body.projectId||body.script||'');
  const existing=await rowFor(env,clientId,storeId);
  const projectChanged=!!existing&&existing.project_id!==projectId;
  const claimed=await env.DB.prepare("SELECT client_id,store_id FROM clarity_connections WHERE project_id=? AND NOT (client_id=? AND store_id=?) LIMIT 1").bind(projectId,clientId,storeId).first();
  if(claimed)throw err('مشروع Clarity ده مربوط بمتجر آخر؛ أنشئ مشروعًا مستقلاً لكل متجر',409,'CLARITY_PROJECT_IN_USE');
  const token=clean(body.apiToken);
  if(token.length>4096)throw err('API Token طويل بصورة غير معتادة');
  let encrypted=null;
  if(token)encrypted=await encryptSecret(env,token);
  const now=new Date().toISOString();
  if(existing){
    await env.DB.prepare("UPDATE clarity_connections SET project_id=?,token_ciphertext_b64=?,token_iv_b64=?,status='configured',last_sync_at=NULL,last_attempt_at=NULL,last_error=NULL,quota_day=CASE WHEN project_id<>? THEN NULL ELSE quota_day END,quota_count=CASE WHEN project_id<>? THEN 0 ELSE quota_count END,updated_at=? WHERE client_id=? AND store_id=?").bind(projectId,encrypted?.ciphertextB64||(projectChanged?null:existing.token_ciphertext_b64),encrypted?.ivB64||(projectChanged?null:existing.token_iv_b64),projectId,projectId,now,clientId,storeId).run();
    if(projectChanged)await env.DB.prepare("DELETE FROM clarity_snapshots WHERE client_id=? AND store_id=?").bind(clientId,storeId).run();
  }else{
    await env.DB.prepare("INSERT INTO clarity_connections (client_id,store_id,project_id,token_ciphertext_b64,token_iv_b64,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(clientId,storeId,projectId,encrypted?.ciphertextB64||null,encrypted?.ivB64||null,now,now).run();
  }
  return publicStatus(await rowFor(env,clientId,storeId));
}
export async function insights(env,clientId,storeId,days=1){
  days=clarityDays(days);
  const row=await rowFor(env,clientId,storeId);
  if(!row)return {ok:true,status:publicStatus(null),latest:null,history:[]};
  const rs=await env.DB.prepare("SELECT synced_at,project_id,campaign_json,device_json FROM clarity_snapshots WHERE client_id=? AND store_id=? AND project_id=? ORDER BY synced_at DESC LIMIT 30").bind(clientId,storeId,row.project_id).all();
  const snapshots=(rs.results||[]).filter(x=>snapshotDays(x.device_json)===days);
  const parse=s=>{try{return JSON.parse(s||'[]')}catch{return [];}};
  const unpack=entry=>{
    const campaign=parse(entry.campaign_json),second=parse(entry.device_json);
    const extended=second&&typeof second==='object'&&!Array.isArray(second)&&second.version===2;
    const pages=extended&&Array.isArray(second.pages)?second.pages:[];
    const technology=extended&&Array.isArray(second.technology)?second.technology:[];
    const legacy=Array.isArray(second)?second:[];
    const report=reportFromCapture({campaign,pages,technology,legacyDevice:legacy,days});
    const {dimensions,totals,diagnostics,catalog,limitations,campaigns,pagesDetail}=report;
    return {syncedAt:entry.synced_at,projectId:entry.project_id,
      // Legacy contract kept for existing Clarity integrations:
      campaignMetrics:campaign,deviceMetrics:legacy.length?legacy:technology,
      campaigns:dimensions.Campaign,campaignFriction:campaigns,sources:dimensions.Source,devices:dimensions.Device,
      // Detailed analytics for the dedicated new dashboard.
      metrics:{totals,dimensions,campaigns,pagesDetail,diagnostics,catalog,limitations,snapshotHours:days*24,windowDays:days,projectId:entry.project_id,coverage:report.coverage},
      sampleCoverage:{campaignRows:campaign.find(x=>x.name==='Traffic'||x.metricName==='Traffic')?.information?.length||0,
        pagesRows:pages.find(x=>x.name==='Traffic'||x.metricName==='Traffic')?.information?.length||0,
        technologyRows:technology.find(x=>x.name==='Traffic'||x.metricName==='Traffic')?.information?.length||0}
    };
  };
  const latest=snapshots[0]?unpack(snapshots[0]):null;
  return {ok:true,status:publicStatus(row),latest,
    history:snapshots.map(s=>{const metric=parse(s.campaign_json).find(x=>String(x.name||x.metricName).toLowerCase()==='traffic');return {syncedAt:s.synced_at,campaignSessions:(metric?.information||[]).reduce((sum,r)=>sum+(Number(r.totalSessionCount)||0),0)};}),
    days,historyNote:'عينات '+(days*24)+' ساعة متحركة ومتداخلة بتوقيت UTC؛ لا تُجمع عينات التاريخ كأيام مستقلة.'};
}
async function growthReport(env,clientId,storeId,days=1){
  days=clarityDays(days);
  const basic=await insights(env,clientId,storeId,days);
  if(!basic.latest)return {ok:true,status:basic.status,latest:null,growth:null,history:basic.history};
  const now=new Date();
  const from=new Date(now.getTime()-days*86400000).toISOString().slice(0,10);
  const to=now.toISOString().slice(0,10);
  let meta=null,metaError=null;
  try{meta=await metaAdsExpertAnalysisV2(env,{clientId,storeId,from,to});}
  catch(e){metaError={code:e?.code||'META_READ_FAILED',message:'تعذر تحميل تحليل Meta؛ تقرير Clarity متاح بصورة مستقلة.'};}
  const latest={...basic.latest};delete latest.campaignMetrics;delete latest.deviceMetrics;
  return {...basic,latest,growth:mergeMetaWithClarity(latest.metrics,meta),metaError};
}

export async function handleClarityApi({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/clarity/'))return null;
  const method=request.method.toUpperCase();
  try{
    if(!['GET','POST','DELETE'].includes(method))return json({error:'Method not allowed'},405);
    const body=method==='POST'?await request.clone().json().catch(()=>({})):{};
    const action=path.slice('/api/clarity/'.length);
    const write=(action==='connect'||action==='sync'||action==='disconnect');
    const {clientId,storeId}=await userScope(request,env,ctx,delegate,body,write,['insights','growth','report'].includes(action)?'analytics':'integrations');
    const days=['sync','insights','growth','report'].includes(action)?clarityDays(body.days||url.searchParams.get('days')||1):1;
      if(action==='status'&&method==='GET')return json({ok:true,...publicStatus(await rowFor(env,clientId,storeId))});
    if(action==='connect'&&method==='POST')return json({ok:true,...await saveConnection(env,clientId,storeId,body)});
    if(action==='sync'&&method==='POST')return json(await syncOne(env,clientId,storeId,{days}));
    if((action==='insights'||action==='report')&&method==='GET')return json(await insights(env,clientId,storeId,days));
    if(action==='growth'&&method==='GET')return json(await growthReport(env,clientId,storeId,days));
    if(action==='disconnect'&&method==='DELETE'){
      await env.DB.prepare("DELETE FROM clarity_snapshots WHERE client_id=? AND store_id=?").bind(clientId,storeId).run();
      await env.DB.prepare("DELETE FROM clarity_connections WHERE client_id=? AND store_id=?").bind(clientId,storeId).run();
      return json({ok:true,disconnected:true});
    }
    return json({error:'Not found'},404);
  }catch(e){return json({error:e.message||'Clarity failed',code:e.code||'CLARITY_ERROR'},e.status||500);}
}
export async function syncClarityScheduled(env,{limit=30}={}){
  const threshold=new Date(Date.now()-12*3600000).toISOString();
  const rs=await env.DB.prepare("SELECT client_id,store_id FROM clarity_connections WHERE token_ciphertext_b64 IS NOT NULL AND (last_attempt_at IS NULL OR last_attempt_at < ?) ORDER BY COALESCE(last_attempt_at,'') ASC LIMIT ?").bind(threshold,Math.max(1,Math.min(50,limit))).all();
  const outcome=[];
  for(const r of rs.results||[]){
    try{const d=await syncOne(env,r.client_id,r.store_id);outcome.push({storeId:r.store_id,ok:true,skipped:!!d.skipped});}
    catch(e){outcome.push({storeId:r.store_id,ok:false,code:e.code||'CLARITY_SYNC_ERROR'});}
  }
  return {ok:true,checked:outcome.length,success:outcome.filter(x=>x.ok).length,errors:outcome.filter(x=>!x.ok).length};
}
