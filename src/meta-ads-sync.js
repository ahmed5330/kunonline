import {readConnectionSecrets} from './integration-provider-validation.js';

const PROVIDER='meta_ads';
const DEFAULT_DAYS=30;
const MAX_DAYS=90;
const now=()=>new Date().toISOString();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const cleanAccountId=value=>String(value||'').trim().replace(/^act_/i,'');
const isoDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):null;
const clampDays=value=>Math.max(1,Math.min(MAX_DAYS,Math.floor(n(value)||DEFAULT_DAYS)));
const campaignPk=(clientId,externalId)=>`META-${String(clientId).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24)}-${String(externalId)}`;

function graphVersion(env,config={}){const raw=String(config.apiVersion||env?.META_GRAPH_API_VERSION||'v25.0').trim();return raw.startsWith('v')?raw:`v${raw}`;}
function rangeOf({from,to,days=DEFAULT_DAYS}={}){const end=isoDate(to)||new Date().toISOString().slice(0,10);const count=clampDays(days);const start=isoDate(from)||new Date(new Date(`${end}T12:00:00Z`).getTime()-(count-1)*86400000).toISOString().slice(0,10);if(start>end)throw Object.assign(new Error('تاريخ بداية مزامنة Meta بعد تاريخ النهاية'),{status:400,code:'META_SYNC_RANGE_INVALID'});return {from:start,to:end,days:Math.min(MAX_DAYS,Math.floor((new Date(`${end}T00:00:00Z`)-new Date(`${start}T00:00:00Z`))/86400000)+1)};}
function normalizeStatus(value){const raw=String(value||'unknown').toLowerCase();return raw.replace(/^campaign_/,'').replace(/_/g,'-');}
function firstActionValue(items=[],keys=[]){const map=new Map((Array.isArray(items)?items:[]).map(row=>[String(row?.action_type||''),n(row?.value)]));for(const key of keys){const value=map.get(key);if(value!==undefined&&value!==0)return value;}return 0;}
function purchaseCount(row){return firstActionValue(row?.actions,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_web_purchase']);}
function purchaseValue(row){return firstActionValue(row?.action_values,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_web_purchase']);}
function leadCount(row){return firstActionValue(row?.actions,['lead','omni_lead','offsite_conversion.fb_pixel_lead','onsite_conversion.lead_grouped']);}
function metaError(error){const code=Number(error?.metaCode||0),message=String(error?.message||'تعذر مزامنة بيانات Meta Ads');if(code===190)return Object.assign(new Error('Meta رفضت التوكن لأنه غير صالح أو منتهي. حدّث Access Token ثم أعد التحقق.'),{status:400,code:'META_TOKEN_INVALID'});if([10,100,200,294].includes(code))return Object.assign(new Error('التوكن متصل لكن لا يملك صلاحية قراءة الحملات/Insights. تأكد من ads_read وصلاحية المستخدم على الحساب الإعلاني.'),{status:403,code:'META_ADS_READ_PERMISSION'});return Object.assign(new Error(`فشل مزامنة Meta Ads: ${message}`),{status:error?.status||502,code:'META_SYNC_FAILED'});}

function graphUrl(version,path,params={}){const url=new URL(`https://graph.facebook.com/${version}/${String(path).replace(/^\/+/, '')}`);for(const [key,value] of Object.entries(params)){if(value===undefined||value===null||value==='')continue;url.searchParams.set(key,typeof value==='object'?JSON.stringify(value):String(value));}return url;}
async function graphGet(fetcher,url,token){const target=url instanceof URL?url:new URL(String(url));if(target.protocol!=='https:'||target.hostname!=='graph.facebook.com')throw Object.assign(new Error('Meta pagination returned an unexpected host'),{code:'META_PAGING_HOST_INVALID'});const response=await fetcher(target.toString(),{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});const data=await response.json().catch(()=>({}));if(!response.ok||data?.error){const error=new Error(data?.error?.message||`Meta API HTTP ${response.status}`);error.status=response.status;error.metaCode=data?.error?.code;error.metaSubcode=data?.error?.error_subcode;throw error;}return data;}
async function collectPages(fetcher,firstUrl,token,{maxPages=25}={}){const rows=[];let next=firstUrl,pages=0;while(next&&pages<maxPages){const data=await graphGet(fetcher,next,token);if(Array.isArray(data?.data))rows.push(...data.data);next=data?.paging?.next||null;pages++;}if(next)throw Object.assign(new Error('Meta returned more pages than the safe sync limit'),{status:409,code:'META_SYNC_PAGE_LIMIT'});return rows;}

export async function fetchMetaAdsSnapshot({env,token,accountId,apiVersion,from,to,fetcher=fetch}){
  const account=cleanAccountId(accountId);if(!account)throw Object.assign(new Error('Meta adAccountId غير موجود في إعداد التكامل'),{status:409,code:'META_AD_ACCOUNT_MISSING'});
  const version=apiVersion||graphVersion(env,{});
  try{
    const accountData=await graphGet(fetcher,graphUrl(version,`act_${account}`,{fields:'id,account_id,name,account_status,currency,timezone_name'}),token);
    const campaigns=await collectPages(fetcher,graphUrl(version,`act_${account}/campaigns`,{fields:'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,updated_time',limit:200}),token);
    const insightRows=await collectPages(fetcher,graphUrl(version,`act_${account}/insights`,{level:'campaign',time_increment:1,time_range:{since:from,until:to},fields:'campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,action_values',limit:500}),token);
    const insights=insightRows.map(row=>({
      campaignId:String(row?.campaign_id||''),campaignName:String(row?.campaign_name||''),date:String(row?.date_start||row?.date_stop||''),
      spend:n(row?.spend),impressions:Math.max(0,Math.floor(n(row?.impressions))),reach:Math.max(0,Math.floor(n(row?.reach))),frequency:n(row?.frequency),
      clicks:Math.max(0,Math.floor(n(row?.clicks))),ctr:n(row?.ctr),cpc:n(row?.cpc),cpm:n(row?.cpm),leads:Math.max(0,Math.floor(leadCount(row))),
      purchases:Math.max(0,purchaseCount(row)),purchaseValue:Math.max(0,purchaseValue(row))
    })).filter(row=>row.campaignId&&isoDate(row.date));
    return {apiVersion:version,account:{id:String(accountData?.id||`act_${account}`),accountId:cleanAccountId(accountData?.account_id||account),name:String(accountData?.name||`act_${account}`),status:Number(accountData?.account_status||0),currency:String(accountData?.currency||''),timezone:String(accountData?.timezone_name||'')},campaigns,insights};
  }catch(error){throw metaError(error);}
}

async function connectedMeta(env,clientId){const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider=? AND status='connected' ORDER BY updated_at DESC LIMIT 1").bind(clientId,PROVIDER).first();if(!row)throw Object.assign(new Error('اربط Meta Ads من مركز التكاملات أولًا'),{status:409,code:'META_ADS_NOT_CONNECTED'});let config={};try{config=JSON.parse(row.config_json||'{}')}catch{}const secrets=await readConnectionSecrets(env,clientId,row.id),token=String(secrets?.access_token||'').trim();if(!token)throw Object.assign(new Error('Access Token غير موجود في تكامل Meta Ads'),{status:409,code:'META_TOKEN_MISSING'});const accountId=cleanAccountId(config.adAccountId||config.ad_account_id||row.external_store_id);if(!accountId)throw Object.assign(new Error('تحقق من تكامل Meta Ads مرة أخرى لاختيار الحساب الإعلاني'),{status:409,code:'META_AD_ACCOUNT_MISSING'});return {row,config,token,accountId,apiVersion:graphVersion(env,config)};}
async function syncStore(env,clientId,requested,config){let storeId=String(requested||config?.syncStoreId||'').trim()||null;if(storeId){const row=await env.DB.prepare("SELECT id FROM stores WHERE id=? AND client_id=? AND status='active'").bind(storeId,clientId).first();if(row)return row.id;storeId=null;}const row=await env.DB.prepare("SELECT id FROM stores WHERE client_id=? AND status='active' ORDER BY is_default DESC,created_at LIMIT 1").bind(clientId).first();return row?.id||null;}
async function runBatches(env,statements,size=75){for(let i=0;i<statements.length;i+=size)await env.DB.batch(statements.slice(i,i+size));}

export async function syncMetaAdsForClient(env,{clientId,storeId=null,from,to,days=DEFAULT_DAYS,fetcher=fetch}={}){
  if(!clientId)throw Object.assign(new Error('clientId مطلوب للمزامنة'),{status:400,code:'CLIENT_ID_REQUIRED'});
  const connection=await connectedMeta(env,clientId),range=rangeOf({from,to,days}),targetStore=await syncStore(env,clientId,storeId,connection.config);
  try{
    const snapshot=await fetchMetaAdsSnapshot({env,token:connection.token,accountId:connection.accountId,apiVersion:connection.apiVersion,from:range.from,to:range.to,fetcher});
    const {results:existing=[]}=await env.DB.prepare("SELECT id,external_campaign_id FROM marketing_campaigns WHERE client_id=? AND store_id IS ? AND platform='meta_ads'").bind(clientId,targetStore).all();
    const localIds=new Map(existing.map(row=>[String(row.external_campaign_id||''),String(row.id)]));
    const campaignMap=new Map();
    for(const raw of snapshot.campaigns){const externalId=String(raw?.id||'');if(!externalId)continue;campaignMap.set(externalId,raw);}
    for(const metric of snapshot.insights){if(!campaignMap.has(metric.campaignId))campaignMap.set(metric.campaignId,{id:metric.campaignId,name:metric.campaignName||`Meta Campaign ${metric.campaignId}`,status:'unknown',effective_status:'unknown',objective:null});}
    const statements=[],campaignIds=new Map(),ts=now();
    for(const [externalId,campaign] of campaignMap){const localId=localIds.get(externalId)||campaignPk(clientId,externalId),budgetMinor=n(campaign?.daily_budget)||n(campaign?.lifetime_budget),budget=budgetMinor?budgetMinor/100:0,status=normalizeStatus(campaign?.effective_status||campaign?.status);campaignIds.set(externalId,localId);statements.push(env.DB.prepare(`INSERT INTO marketing_campaigns (id,client_id,store_id,platform,external_campaign_id,name,objective,status,currency,budget,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,store_id,platform,external_campaign_id) DO UPDATE SET name=excluded.name,objective=excluded.objective,status=excluded.status,currency=excluded.currency,budget=excluded.budget,updated_at=excluded.updated_at`).bind(localId,clientId,targetStore,'meta_ads',externalId,String(campaign?.name||`Meta Campaign ${externalId}`),campaign?.objective||null,status,snapshot.account.currency||'EGP',budget,ts,ts));}
    for(const localId of campaignIds.values())statements.push(env.DB.prepare('DELETE FROM campaign_daily_metrics WHERE client_id=? AND campaign_id=? AND metric_date BETWEEN ? AND ?').bind(clientId,localId,range.from,range.to));
    for(const metric of snapshot.insights){const localId=campaignIds.get(metric.campaignId);if(!localId)continue;statements.push(env.DB.prepare(`INSERT INTO campaign_daily_metrics (client_id,store_id,campaign_id,metric_date,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,leads,conversions,platform_purchases,revenue,platform_purchase_value,orders_count,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,campaign_id,metric_date) DO UPDATE SET store_id=excluded.store_id,spend=excluded.spend,impressions=excluded.impressions,reach=excluded.reach,frequency=excluded.frequency,clicks=excluded.clicks,ctr=excluded.ctr,cpc=excluded.cpc,cpm=excluded.cpm,leads=excluded.leads,conversions=excluded.conversions,platform_purchases=excluded.platform_purchases,revenue=excluded.revenue,platform_purchase_value=excluded.platform_purchase_value,updated_at=excluded.updated_at`).bind(clientId,targetStore,localId,metric.date,metric.spend,metric.impressions,metric.reach,metric.frequency,metric.clicks,metric.ctr,metric.cpc,metric.cpm,metric.leads,metric.purchases,metric.purchases,metric.purchaseValue,metric.purchaseValue,0,ts));}
    const nextConfig={...connection.config,apiVersion:snapshot.apiVersion,adAccountId:snapshot.account.accountId,syncStoreId:targetStore||null};statements.push(env.DB.prepare('UPDATE store_connections SET store_name=?,external_store_id=?,config_json=?,last_sync_at=?,last_error=NULL,updated_at=? WHERE id=? AND client_id=?').bind(snapshot.account.name,`act_${snapshot.account.accountId}`,JSON.stringify(nextConfig),ts,ts,connection.row.id,clientId));
    await runBatches(env,statements);
    const active=[...campaignMap.values()].filter(c=>normalizeStatus(c?.effective_status||c?.status)==='active').length;
    return {ok:true,provider:PROVIDER,account:snapshot.account,storeId:targetStore,from:range.from,to:range.to,days:range.days,campaigns:campaignMap.size,activeCampaigns:active,dailyMetrics:snapshot.insights.length,syncedAt:ts,message:`تمت مزامنة Meta Ads: ${campaignMap.size} حملة (${active} شغالة) و${snapshot.insights.length} سجل أداء يومي.`};
  }catch(error){try{await env.DB.prepare('UPDATE store_connections SET last_error=?,updated_at=? WHERE id=? AND client_id=?').bind(String(error?.message||error),now(),connection.row.id,clientId).run();}catch{}throw error;}
}

export async function syncAllConnectedMetaAds(env,{days=DEFAULT_DAYS,limit=50,fetcher=fetch}={}){const {results=[]}=await env.DB.prepare("SELECT DISTINCT client_id FROM store_connections WHERE provider='meta_ads' AND status='connected' ORDER BY updated_at DESC LIMIT ?").bind(Math.max(1,Math.min(200,Number(limit)||50))).all();const outcomes=[];for(const row of results){try{outcomes.push({clientId:row.client_id,...await syncMetaAdsForClient(env,{clientId:row.client_id,days,fetcher})});}catch(error){outcomes.push({clientId:row.client_id,ok:false,code:error?.code||'META_SYNC_FAILED',error:error?.message||String(error)});}}return outcomes;}
