/* Microsoft Clarity — isolated, per-store analytics integration for Kun Online.
 * Storefront tracking is installed on the merchant's storefront, never on the admin dashboard.
 * Clarity Data Export API is aggregate-only; no recording/heatmap export is implied.
 */
import {encryptSecret,decryptSecret} from './integration-secrets.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const CLARITY_API='https://www.clarity.ms/export-data/api/v1/project-live-insights';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const clean=v=>String(v??'').trim();
const err=(message,status=400,code='CLARITY_INVALID')=>Object.assign(new Error(message),{status,code});
const today=()=>new Date().toISOString().slice(0,10);

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
async function schema(env){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS clarity_connections (client_id TEXT NOT NULL,store_id TEXT NOT NULL,project_id TEXT NOT NULL,token_ciphertext_b64 TEXT,token_iv_b64 TEXT,status TEXT NOT NULL DEFAULT 'configured',last_sync_at TEXT,last_error TEXT,quota_day TEXT,quota_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(client_id,store_id))").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_clarity_project_unique ON clarity_connections(project_id)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS clarity_snapshots (client_id TEXT NOT NULL,store_id TEXT NOT NULL,synced_at TEXT NOT NULL,project_id TEXT NOT NULL,campaign_json TEXT NOT NULL,device_json TEXT NOT NULL,PRIMARY KEY(client_id,store_id,synced_at))").run();
}
async function rowFor(env,clientId,storeId){
  return env.DB.prepare("SELECT * FROM clarity_connections WHERE client_id=? AND store_id=?").bind(clientId,storeId).first();
}
function publicStatus(row){
  return {configured:!!row,projectId:row?.project_id||null,hasApiToken:!!row?.token_ciphertext_b64,status:row?.status||'disconnected',lastSyncAt:row?.last_sync_at||null,lastError:row?.last_error||null,quotaUsedToday:row?.quota_day===today()?Number(row?.quota_count||0):0,quotaBudget:8,trackingVerified:false,trackingNote:'التحقق من API لا يثبت تثبيت كود التتبع على المتجر. راجع Live Sessions من لوحة Clarity.'};
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
async function clarityGet(token,dimension1,dimension2){
  const u=new URL(CLARITY_API);
  u.searchParams.set('numOfDays','1');
  u.searchParams.set('dimension1',dimension1);
  if(dimension2)u.searchParams.set('dimension2',dimension2);
  let response;
  try{response=await fetch(u.toString(),{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(15000)});}
  catch(e){throw err('تعذر الوصول لخدمة Microsoft Clarity',502,'CLARITY_UNREACHABLE');}
  if(!response.ok){
    const errorCode=response.status===401?'CLARITY_TOKEN_INVALID':response.status===403?'CLARITY_TOKEN_FORBIDDEN':response.status===429?'CLARITY_PROVIDER_RATE_LIMIT':'CLARITY_UPSTREAM_ERROR';
    throw err('تعذر الاتصال بـMicrosoft Clarity (HTTP '+response.status+')',response.status===429?429:502,errorCode);
  }
  const data=await response.json().catch(()=>null);
  if(!Array.isArray(data))throw err('استجابة Microsoft Clarity غير متوقعة',502,'CLARITY_RESPONSE_INVALID');
  return clarityMetrics(data);
}
async function syncOne(env,clientId,storeId,{force=false}={}){
  await schema(env);
  const row=await rowFor(env,clientId,storeId);
  if(!row)throw err('اربط Clarity بهذا المتجر أولاً',404,'CLARITY_NOT_CONNECTED');
  if(!row.token_ciphertext_b64||!row.token_iv_b64)throw err('أضف Data Export API Token لتفعيل التحليلات',409,'CLARITY_TOKEN_REQUIRED');
  // Protect the per-project 10/day provider quota, leaving 2 spare calls for troubleshooting.
  const age=Date.now()-Date.parse(row.last_sync_at||'1970-01-01T00:00:00Z');
  if(!force&&Number.isFinite(age)&&age<4*60*60*1000)return {ok:true,skipped:true,reason:'fresh_cache',...publicStatus(row)};
  const day=today();
  const reserved=await env.DB.prepare("UPDATE clarity_connections SET quota_count=CASE WHEN quota_day=? THEN quota_count+2 ELSE 2 END,quota_day=?,updated_at=? WHERE client_id=? AND store_id=? AND (quota_day IS NULL OR quota_day<>? OR quota_count<=6)").bind(day,day,new Date().toISOString(),clientId,storeId,day).run();
  if(!reserved?.meta?.changes)throw err('تم بلوغ الحد الآمن للمزامنة اليوم. أعد المحاولة غدًا.',429,'CLARITY_DAILY_BUDGET');
  let token;
  try{token=await decryptSecret(env,row.token_ciphertext_b64,row.token_iv_b64);}
  catch{throw err('تعذر قراءة توكن Clarity المشفر',503,'CLARITY_SECRET_DECRYPT_FAILED');}
  try{
    const campaign=await clarityGet(token,'Campaign','Source');
    const device=await clarityGet(token,'Device');
    const syncedAt=new Date().toISOString();
    await env.DB.prepare("INSERT INTO clarity_snapshots (client_id,store_id,synced_at,project_id,campaign_json,device_json) VALUES (?,?,?,?,?,?)").bind(clientId,storeId,syncedAt,row.project_id,JSON.stringify(campaign),JSON.stringify(device)).run();
    await env.DB.prepare("UPDATE clarity_connections SET status='connected',last_sync_at=?,last_error=NULL,updated_at=? WHERE client_id=? AND store_id=?").bind(syncedAt,syncedAt,clientId,storeId).run();
    return {ok:true,skipped:false,syncedAt,projectId:row.project_id,quotaUsedToday:(row.quota_day===day?Number(row.quota_count):0)+2};
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
    await env.DB.prepare("UPDATE clarity_connections SET project_id=?,token_ciphertext_b64=?,token_iv_b64=?,status='configured',last_sync_at=NULL,last_error=NULL,quota_day=CASE WHEN project_id<>? THEN NULL ELSE quota_day END,quota_count=CASE WHEN project_id<>? THEN 0 ELSE quota_count END,updated_at=? WHERE client_id=? AND store_id=?").bind(projectId,encrypted?.ciphertextB64||(projectChanged?null:existing.token_ciphertext_b64),encrypted?.ivB64||(projectChanged?null:existing.token_iv_b64),projectId,projectId,now,clientId,storeId).run();
    if(projectChanged)await env.DB.prepare("DELETE FROM clarity_snapshots WHERE client_id=? AND store_id=?").bind(clientId,storeId).run();
  }else{
    await env.DB.prepare("INSERT INTO clarity_connections (client_id,store_id,project_id,token_ciphertext_b64,token_iv_b64,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(clientId,storeId,projectId,encrypted?.ciphertextB64||null,encrypted?.ivB64||null,now,now).run();
  }
  return publicStatus(await rowFor(env,clientId,storeId));
}
async function insights(env,clientId,storeId){
  const row=await rowFor(env,clientId,storeId);
  if(!row)return {ok:true,status:publicStatus(null),latest:null,history:[]};
  const rs=await env.DB.prepare("SELECT synced_at,project_id,campaign_json,device_json FROM clarity_snapshots WHERE client_id=? AND store_id=? AND project_id=? ORDER BY synced_at DESC LIMIT 30").bind(clientId,storeId,row.project_id).all();
  const snapshots=rs.results||[];
  const latest=snapshots[0]||null;
  const parse=s=>{try{return JSON.parse(s||'[]')}catch{return [];}};
  return {ok:true,status:publicStatus(row),latest:latest?{syncedAt:latest.synced_at,campaignMetrics:parse(latest.campaign_json),deviceMetrics:parse(latest.device_json),campaigns:clarityTraffic(parse(latest.campaign_json),'Campaign'),sources:clarityTraffic(parse(latest.campaign_json),'Source'),devices:clarityTraffic(parse(latest.device_json),'Device')}:null,history:snapshots.map(s=>({syncedAt:s.synced_at,campaignSessions:clarityTraffic(parse(s.campaign_json),'Campaign').reduce((sum,r)=>sum+r.sessions,0)})),historyNote:'كل عينة تمثل 24 ساعة متحركة وقد تتداخل الفترات؛ لا تجمع العينات كأنها أيام مستقلة.'};
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
    const {clientId,storeId}=await userScope(request,env,ctx,delegate,body,write,action==='insights'?'analytics':'integrations');
    await schema(env);
    if(action==='status'&&method==='GET')return json({ok:true,...publicStatus(await rowFor(env,clientId,storeId))});
    if(action==='connect'&&method==='POST')return json({ok:true,...await saveConnection(env,clientId,storeId,body)});
    if(action==='sync'&&method==='POST')return json(await syncOne(env,clientId,storeId,{}));
    if(action==='insights'&&method==='GET')return json(await insights(env,clientId,storeId));
    if(action==='disconnect'&&method==='DELETE'){
      await env.DB.prepare("DELETE FROM clarity_snapshots WHERE client_id=? AND store_id=?").bind(clientId,storeId).run();
      await env.DB.prepare("DELETE FROM clarity_connections WHERE client_id=? AND store_id=?").bind(clientId,storeId).run();
      return json({ok:true,disconnected:true});
    }
    return json({error:'Not found'},404);
  }catch(e){return json({error:e.message||'Clarity failed',code:e.code||'CLARITY_ERROR'},e.status||500);}
}
export async function syncClarityScheduled(env,{limit=30}={}){
  await schema(env);
  const rs=await env.DB.prepare("SELECT client_id,store_id FROM clarity_connections WHERE token_ciphertext_b64 IS NOT NULL AND (last_sync_at IS NULL OR last_sync_at < ?) ORDER BY COALESCE(last_sync_at,'') ASC LIMIT ?").bind(new Date(Date.now()-12*3600000).toISOString(),Math.max(1,Math.min(50,limit))).all();
  const outcome=[];
  for(const r of rs.results||[]){
    try{const d=await syncOne(env,r.client_id,r.store_id);outcome.push({storeId:r.store_id,ok:true,skipped:!!d.skipped});}
    catch(e){outcome.push({storeId:r.store_id,ok:false,code:e.code||'CLARITY_SYNC_ERROR'});}
  }
  return {ok:true,checked:outcome.length,success:outcome.filter(x=>x.ok).length,errors:outcome.filter(x=>!x.ok).length};
}
