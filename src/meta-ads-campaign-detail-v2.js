import {readConnectionSecrets} from './integration-provider-validation.js';
import {
  metaAdsDailyComparison as baseDailyComparison,
  metaAdsBreakdown as baseBreakdown,
  META_BREAKDOWN_CATALOG as BASE_BREAKDOWN_CATALOG
} from './meta-ads-campaign-detail.js';

const PROVIDER='meta_ads';
const clean=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const r2=value=>Math.round(n(value)*100)/100;
const pct=(a,b)=>b?r2(n(a)/n(b)*100):0;
const iso=value=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value))?clean(value):null;
const breakdown=(group,key,label)=>({id:key,group,key,label,param:'breakdowns'});

// Synced against the current Meta Business SDK AdsInsights.Breakdowns enum.
const CURRENT_SDK_EXTRAS=[
  breakdown('Affiliate / الشركاء','affiliate_click_region','Affiliate click region'),
  breakdown('Affiliate / الشركاء','affiliate_link_url','Affiliate link URL'),
  breakdown('المنتجات والكتالوج','msa_seller_name','MSA seller name'),
  breakdown('المنصة والموضع والجهاز','placement_path','Placement path')
];

export const META_BREAKDOWN_CATALOG=[...BASE_BREAKDOWN_CATALOG,...CURRENT_SDK_EXTRAS];
const EXTRA_BY_ID=new Map(CURRENT_SDK_EXTRAS.map(item=>[item.id,item]));
export const metaAdsDailyComparison=baseDailyComparison;

function rangeOf({from,to,days=7}={}){
  const end=iso(to)||new Date().toISOString().slice(0,10);
  let start=iso(from);
  if(!start){
    const count=Math.max(1,Math.min(90,Math.floor(n(days)||7)));
    start=new Date(new Date(`${end}T12:00:00Z`).getTime()-(count-1)*86400000).toISOString().slice(0,10);
  }
  let diff=Math.floor((new Date(`${end}T00:00:00Z`)-new Date(`${start}T00:00:00Z`))/86400000)+1;
  if(diff<1)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'META_RANGE_INVALID'});
  const capped=diff>90;
  if(capped){start=new Date(new Date(`${end}T12:00:00Z`).getTime()-89*86400000).toISOString().slice(0,10);diff=90;}
  return {from:start,to:end,days:diff,capped};
}

async function allowedAdIds(env,{clientId,storeId=null}){
  const hasStore=Boolean(clean(storeId));
  const binds=hasStore?[clientId,storeId]:[clientId];
  const {results=[]}=await env.DB.prepare(`SELECT external_id FROM meta_ad_entities WHERE client_id=? AND level='ad' ${hasStore?'AND store_id=?':''}`).bind(...binds).all();
  return new Set(results.map(row=>clean(row.external_id)).filter(Boolean));
}

function deliveryTotals(rows=[]){
  const raw=rows.reduce((a,row)=>{a.spend+=n(row.spend);a.impressions+=n(row.impressions);a.reach+=n(row.reach);a.clicks+=n(row.clicks);a.leads+=n(row.leads);a.purchases+=n(row.purchases);a.purchaseValue+=n(row.purchaseValue);return a;},{spend:0,impressions:0,reach:0,clicks:0,leads:0,purchases:0,purchaseValue:0});
  return {spend:r2(raw.spend),impressions:Math.round(raw.impressions),reach:Math.round(raw.reach),clicks:Math.round(raw.clicks),leads:r2(raw.leads),purchases:r2(raw.purchases),purchaseValue:r2(raw.purchaseValue),ctr:pct(raw.clicks,raw.impressions),cpc:raw.clicks?r2(raw.spend/raw.clicks):0,cpm:raw.impressions?r2(raw.spend/raw.impressions*1000):0,frequency:raw.reach?r2(raw.impressions/raw.reach):0,cpp:raw.purchases?r2(raw.spend/raw.purchases):0,roas:raw.spend?r2(raw.purchaseValue/raw.spend):0,cvr:pct(raw.purchases,raw.clicks)};
}
function actionTotals(rows=[]){return rows.reduce((a,row)=>{a.resultValue+=n(row.resultValue);a.conversionValue+=n(row.conversionValue);return a;},{resultValue:0,conversionValue:0});}
async function scopeResult(env,{clientId,storeId,result}){
  const allowed=await allowedAdIds(env,{clientId,storeId});
  const rows=(result?.rows||[]).filter(row=>allowed.has(clean(row.adId)));
  const totals=result?.metricMode==='actions'?actionTotals(rows):deliveryTotals(rows);
  return {...result,rows,totals:result?.metricMode==='actions'?{resultValue:r2(totals.resultValue),conversionValue:r2(totals.conversionValue)}:totals,catalog:META_BREAKDOWN_CATALOG,scopeFiltered:true};
}

function cleanAccountId(value){return clean(value).replace(/^act_/i,'');}
function graphVersion(env,config={}){const raw=clean(config.apiVersion||env?.META_GRAPH_API_VERSION||'v25.0');return raw.startsWith('v')?raw:`v${raw}`;}
async function connection(env,clientId){
  const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider=? AND status='connected' ORDER BY updated_at DESC LIMIT 1").bind(clientId,PROVIDER).first();
  if(!row)throw Object.assign(new Error('اربط Meta Ads من مركز التكاملات أولًا'),{status:409,code:'META_ADS_NOT_CONNECTED'});
  let config={};try{config=JSON.parse(row.config_json||'{}')}catch{}
  const secrets=await readConnectionSecrets(env,clientId,row.id),token=clean(secrets?.access_token),accountId=cleanAccountId(config.adAccountId||config.ad_account_id||row.external_store_id);
  if(!token)throw Object.assign(new Error('Access Token غير موجود في تكامل Meta Ads'),{status:409,code:'META_TOKEN_MISSING'});
  if(!accountId)throw Object.assign(new Error('الحساب الإعلاني غير محدد في تكامل Meta Ads'),{status:409,code:'META_AD_ACCOUNT_MISSING'});
  return {token,accountId,version:graphVersion(env,config)};
}
function graphUrl(version,path,params={}){const url=new URL(`https://graph.facebook.com/${version}/${String(path).replace(/^\/+/, '')}`);for(const [key,value] of Object.entries(params)){if(value===undefined||value===null||value==='')continue;url.searchParams.set(key,typeof value==='object'?JSON.stringify(value):String(value));}return url;}
async function graphGet(fetcher,url,token){
  const target=url instanceof URL?url:new URL(String(url));
  if(target.protocol!=='https:'||target.hostname!=='graph.facebook.com')throw Object.assign(new Error('Meta pagination returned an unexpected host'),{status:502,code:'META_PAGING_HOST_INVALID'});
  const response=await fetcher(target.toString(),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}}),data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error){
    const message=clean(data?.error?.message)||`Meta API HTTP ${response.status}`,metaCode=Number(data?.error?.code||0);
    if(metaCode===190)throw Object.assign(new Error('Meta Access Token غير صالح أو منتهي.'),{status:401,code:'META_TOKEN_INVALID'});
    if(/breakdown|breakdowns|not supported|not valid|invalid.*field|invalid.*parameter/i.test(message))throw Object.assign(new Error(`Meta لا تسمح بالـ Breakdown المختار مع نوع الإعلان/الحقول الحالية: ${message}`),{status:422,code:'META_BREAKDOWN_UNAVAILABLE'});
    if([10,100,200,294].includes(metaCode))throw Object.assign(new Error('التوكن لا يملك صلاحية ads_read الكافية لقراءة الـBreakdowns.'),{status:403,code:'META_ADS_READ_PERMISSION'});
    throw Object.assign(new Error(message),{status:response.status||502,code:'META_BREAKDOWN_FAILED'});
  }
  return data;
}
async function pages(fetcher,url,token,{maxPages=35}={}){const rows=[];let next=url,count=0;while(next&&count<maxPages){const data=await graphGet(fetcher,next,token);if(Array.isArray(data?.data))rows.push(...data.data);next=data?.paging?.next||null;count++;}if(next)throw Object.assign(new Error('نتائج الـBreakdown أكبر من حد القراءة الآمن. قلّل الفترة.'),{status:409,code:'META_BREAKDOWN_PAGE_LIMIT'});return rows;}
function firstActionValue(items=[],keys=[]){const map=new Map((Array.isArray(items)?items:[]).map(row=>[clean(row?.action_type),n(row?.value)]));for(const key of keys)if(map.has(key))return n(map.get(key));return 0;}
function purchases(row){return firstActionValue(row?.actions,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_web_purchase']);}
function purchaseValue(row){return firstActionValue(row?.action_values,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_web_purchase']);}
function leads(row){return firstActionValue(row?.actions,['lead','omni_lead','offsite_conversion.fb_pixel_lead','onsite_conversion.lead_grouped']);}
function dimensionValue(value){if(value===null||value===undefined||value==='')return 'غير محدد';if(typeof value==='object'){const label=clean(value.name||value.title||value.url||value.id||value.value);return label||JSON.stringify(value);}return clean(value)||'غير محدد';}

async function extraBreakdown(env,{clientId,storeId=null,from,to,days=7,dimension,status='active',fetcher=fetch}){
  const catalogItem=EXTRA_BY_ID.get(clean(dimension));
  if(!catalogItem)throw Object.assign(new Error('Breakdown غير مدعوم'),{status:400,code:'META_BREAKDOWN_INVALID'});
  const range=rangeOf({from,to,days}),conn=await connection(env,clientId),allowed=await allowedAdIds(env,{clientId,storeId});
  const hasStore=Boolean(clean(storeId)),binds=hasStore?[clientId,storeId]:[clientId];
  const {results:entities=[]}=await env.DB.prepare(`SELECT external_id,name,external_campaign_id,external_adset_id,COALESCE(effective_status,status,'unknown') effective_status FROM meta_ad_entities WHERE client_id=? AND level='ad' ${hasStore?'AND store_id=?':''}`).bind(...binds).all();
  const entityMap=new Map(entities.map(row=>[clean(row.external_id),row]));
  const fields='campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,actions,action_values';
  const raw=await pages(fetcher,graphUrl(conn.version,`act_${conn.accountId}/insights`,{level:'ad',time_range:{since:range.from,until:range.to},fields,limit:500,breakdowns:catalogItem.key}),conn.token);
  const activeOnly=clean(status).toLowerCase()!=='all',rows=[];
  for(const item of raw){
    const adId=clean(item?.ad_id);if(!allowed.has(adId))continue;
    const entity=entityMap.get(adId),effective=clean(entity?.effective_status||'unknown').toLowerCase().replace(/_/g,'-');if(activeOnly&&effective!=='active')continue;
    const spend=n(item?.spend),impressions=n(item?.impressions),reach=n(item?.reach),clicks=n(item?.clicks),p=purchases(item),pv=purchaseValue(item),l=leads(item);
    rows.push({dimension:catalogItem.id,dimensionKey:catalogItem.key,dimensionParam:'breakdowns',dimensionValue:dimensionValue(item?.[catalogItem.key]),dimensionRaw:item?.[catalogItem.key]??null,adId,adName:clean(item?.ad_name)||entity?.name||'',adsetId:clean(item?.adset_id)||clean(entity?.external_adset_id),adsetName:clean(item?.adset_name)||'',campaignId:clean(item?.campaign_id)||clean(entity?.external_campaign_id),campaignName:clean(item?.campaign_name)||'',status:effective,spend:r2(spend),impressions:Math.round(impressions),reach:Math.round(reach),clicks:Math.round(clicks),leads:r2(l),purchases:r2(p),purchaseValue:r2(pv),ctr:pct(clicks,impressions),cpc:clicks?r2(spend/clicks):0,cpm:impressions?r2(spend/impressions*1000):0,frequency:reach?r2(impressions/reach):0,cpp:p?r2(spend/p):0,roas:spend?r2(pv/spend):0,cvr:pct(p,clicks)});
  }
  rows.sort((a,b)=>b.spend-a.spend||b.purchases-a.purchases);
  return {ok:true,metricMode:'delivery',dimension:catalogItem.id,key:catalogItem.key,param:'breakdowns',label:catalogItem.label,group:catalogItem.group,statusFilter:activeOnly?'active':'all',from:range.from,to:range.to,capped:range.capped,rows,totals:deliveryTotals(rows),catalog:META_BREAKDOWN_CATALOG,scopeFiltered:true,note:'النتائج مفلترة صراحة إلى إعلانات العميل/المتجر المحدد بعد رد Meta لمنع ظهور أي Ad خارج النطاق.'};
}

export async function metaAdsBreakdown(env,args={}){
  const dimension=clean(args.dimension||'image_asset');
  const result=EXTRA_BY_ID.has(dimension)?await extraBreakdown(env,{...args,dimension}):await baseBreakdown(env,{...args,dimension});
  return scopeResult(env,{clientId:args.clientId,storeId:args.storeId||null,result});
}
