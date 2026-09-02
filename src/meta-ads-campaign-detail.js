import {readConnectionSecrets} from './integration-provider-validation.js';

const PROVIDER='meta_ads';
const MAX_DAYS=90;
const clean=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const r2=value=>Math.round(n(value)*100)/100;
const pct=(a,b)=>b?r2(n(a)/n(b)*100):0;
const iso=value=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value))?clean(value):null;

export const META_BREAKDOWN_CATALOG=[
  {group:'الكرياتيف',key:'image_asset',label:'الصورة'},
  {group:'الكرياتيف',key:'video_asset',label:'الفيديو'},
  {group:'الكرياتيف',key:'body_asset',label:'النص الأساسي'},
  {group:'الكرياتيف',key:'title_asset',label:'العنوان'},
  {group:'الكرياتيف',key:'description_asset',label:'الوصف'},
  {group:'الكرياتيف',key:'call_to_action_asset',label:'زر الدعوة CTA'},
  {group:'الكرياتيف',key:'link_url_asset',label:'رابط الإعلان'},
  {group:'الكرياتيف',key:'ad_format_asset',label:'صيغة الإعلان'},
  {group:'الكرياتيف',key:'media_asset_url',label:'رابط أصل الميديا'},
  {group:'الكرياتيف',key:'media_format',label:'نوع الميديا'},
  {group:'الكرياتيف',key:'media_text_content',label:'محتوى الميديا النصي'},
  {group:'الكرياتيف',key:'landing_destination',label:'وجهة الهبوط'},
  {group:'الجمهور',key:'age',label:'العمر'},
  {group:'الجمهور',key:'gender',label:'النوع'},
  {group:'الجمهور',key:'frequency_value',label:'تكرار الظهور'},
  {group:'الجغرافيا',key:'country',label:'الدولة'},
  {group:'الجغرافيا',key:'region',label:'المنطقة / المحافظة'},
  {group:'الجغرافيا',key:'dma',label:'DMA'},
  {group:'المنصة والموضع',key:'publisher_platform',label:'المنصة'},
  {group:'المنصة والموضع',key:'platform_position',label:'موضع الظهور'},
  {group:'المنصة والموضع',key:'device_platform',label:'منصة الجهاز'},
  {group:'المنصة والموضع',key:'impression_device',label:'جهاز الظهور'},
  {group:'الوقت',key:'hourly_stats_aggregated_by_advertiser_time_zone',label:'الساعة — توقيت المعلن'},
  {group:'الوقت',key:'hourly_stats_aggregated_by_audience_time_zone',label:'الساعة — توقيت الجمهور'},
  {group:'المنتج والمتقدم',key:'product_id',label:'المنتج'},
  {group:'المنتج والمتقدم',key:'app_id',label:'التطبيق'},
  {group:'المنتج والمتقدم',key:'standard_event_content_type',label:'نوع محتوى الحدث'},
  {group:'المنتج والمتقدم',key:'place_page_id',label:'صفحة المكان'},
  {group:'المنتج والمتقدم',key:'marketing_messages_btn_name',label:'زر رسائل التسويق'},
  {group:'المنتج والمتقدم',key:'media_creator',label:'منشئ الميديا'},
  {group:'المنتج والمتقدم',key:'media_destination_url',label:'وجهة الميديا'},
  {group:'المنتج والمتقدم',key:'media_origin_url',label:'مصدر الميديا'},
  {group:'المنتج والمتقدم',key:'skan_campaign_id',label:'SKAN Campaign'},
  {group:'المنتج والمتقدم',key:'skan_conversion_id',label:'SKAN Conversion'},
  {group:'المنتج والمتقدم',key:'skan_version',label:'SKAN Version'}
];
const BREAKDOWN_KEYS=new Set(META_BREAKDOWN_CATALOG.map(item=>item.key));

function rangeOf({from,to,days=7}={}){
  const end=iso(to)||new Date().toISOString().slice(0,10);
  let start=iso(from);
  if(!start){const count=Math.max(1,Math.min(MAX_DAYS,Math.floor(n(days)||7)));start=new Date(new Date(`${end}T12:00:00Z`).getTime()-(count-1)*86400000).toISOString().slice(0,10);}
  let diff=Math.floor((new Date(`${end}T00:00:00Z`)-new Date(`${start}T00:00:00Z`))/86400000)+1;
  if(diff<1)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'META_RANGE_INVALID'});
  const capped=diff>MAX_DAYS;if(capped){start=new Date(new Date(`${end}T12:00:00Z`).getTime()-(MAX_DAYS-1)*86400000).toISOString().slice(0,10);diff=MAX_DAYS;}
  return {from:start,to:end,days:diff,capped};
}
function dateList(from,to){const out=[];for(let d=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`);d<=end;d.setUTCDate(d.getUTCDate()+1))out.push(d.toISOString().slice(0,10));return out;}
function normalizeStatus(value){return clean(value||'unknown').toLowerCase().replace(/^campaign_/,'').replace(/_/g,'-');}
function metricShape(raw={}){const spend=n(raw.spend),impressions=n(raw.impressions),reach=n(raw.reach),clicks=n(raw.clicks),purchases=n(raw.purchases),purchaseValue=n(raw.purchaseValue),leads=n(raw.leads);return {spend:r2(spend),impressions:Math.round(impressions),reach:Math.round(reach),clicks:Math.round(clicks),leads:r2(leads),purchases:r2(purchases),purchaseValue:r2(purchaseValue),ctr:pct(clicks,impressions),cpc:clicks?r2(spend/clicks):0,cpm:impressions?r2(spend/impressions*1000):0,frequency:reach?r2(impressions/reach):0,cpp:purchases?r2(spend/purchases):0,roas:spend?r2(purchaseValue/spend):0,cvr:pct(purchases,clicks)};}
function emptyMetric(){return metricShape({});}
function sumMetrics(rows=[]){return metricShape(rows.reduce((a,row)=>{a.spend+=n(row.spend);a.impressions+=n(row.impressions);a.reach+=n(row.reach);a.clicks+=n(row.clicks);a.leads+=n(row.leads);a.purchases+=n(row.purchases);a.purchaseValue+=n(row.purchaseValue);return a;},{spend:0,impressions:0,reach:0,clicks:0,leads:0,purchases:0,purchaseValue:0}));}
function activeOnly(status){return clean(status).toLowerCase()==='active';}
function normalizeFilter(value){return clean(value).toLowerCase()==='all'?'all':'active';}

async function campaignEntities(env,{clientId,storeId,status}){
  const hasStore=Boolean(clean(storeId)),filter=normalizeFilter(status),sql=`SELECT id,external_campaign_id,name,status,currency,budget FROM marketing_campaigns WHERE client_id=? AND platform='meta_ads' ${hasStore?'AND store_id=?':''} ${filter==='active'?"AND lower(status)='active'":''} ORDER BY updated_at DESC`,binds=hasStore?[clientId,storeId]:[clientId],{results=[]}=await env.DB.prepare(sql).bind(...binds).all();
  return results.map(row=>({id:clean(row.external_campaign_id)||clean(row.id),localId:clean(row.id),name:row.name,status:normalizeStatus(row.status),currency:row.currency||'EGP',budget:r2(row.budget),campaignId:clean(row.external_campaign_id)}));
}
async function granularEntities(env,{clientId,storeId,level,status}){
  const hasStore=Boolean(clean(storeId)),filter=normalizeFilter(status),sql=`SELECT external_id,external_campaign_id,external_adset_id,name,status,effective_status,optimization_goal,budget,currency FROM meta_ad_entities WHERE client_id=? AND level=? ${hasStore?'AND store_id=?':''} ${filter==='active'?"AND lower(COALESCE(effective_status,status,''))='active'":''} ORDER BY updated_at DESC`,binds=hasStore?[clientId,level,storeId]:[clientId,level],{results=[]}=await env.DB.prepare(sql).bind(...binds).all();
  return results.map(row=>({id:clean(row.external_id),name:row.name,status:normalizeStatus(row.effective_status||row.status),currency:row.currency||'EGP',budget:r2(row.budget),campaignId:clean(row.external_campaign_id),adsetId:clean(row.external_adset_id),optimizationGoal:clean(row.optimization_goal)}));
}
async function names(env,{clientId,storeId}){
  const hasStore=Boolean(clean(storeId)),cBinds=hasStore?[clientId,storeId]:[clientId],sBinds=hasStore?[clientId,storeId]:[clientId];
  const [{results:campaigns=[]},{results:sets=[]}]=await Promise.all([
    env.DB.prepare(`SELECT external_campaign_id,name FROM marketing_campaigns WHERE client_id=? AND platform='meta_ads' ${hasStore?'AND store_id=?':''}`).bind(...cBinds).all(),
    env.DB.prepare(`SELECT external_id,name FROM meta_ad_entities WHERE client_id=? AND level='adset' ${hasStore?'AND store_id=?':''}`).bind(...sBinds).all()
  ]);
  return {campaign:new Map(campaigns.map(row=>[clean(row.external_campaign_id),row.name])),adset:new Map(sets.map(row=>[clean(row.external_id),row.name]))};
}

export async function metaAdsDailyComparison(env,{clientId,storeId=null,level='campaign',from,to,days=7,status='active'}={}){
  if(!clientId)throw Object.assign(new Error('clientId مطلوب'),{status:400,code:'CLIENT_ID_REQUIRED'});
  const kind=['campaign','adset','ad'].includes(level)?level:'campaign',range=rangeOf({from,to,days}),dates=dateList(range.from,range.to),filter=normalizeFilter(status),hasStore=Boolean(clean(storeId));
  let entities=[],metrics=[];
  if(kind==='campaign'){
    entities=await campaignEntities(env,{clientId,storeId,status:filter});
    const binds=hasStore?[clientId,storeId,range.from,range.to]:[clientId,range.from,range.to],sql=`SELECT m.campaign_id,m.metric_date,m.spend,m.impressions,m.reach,m.clicks,m.leads,m.platform_purchases purchases,m.platform_purchase_value purchase_value FROM campaign_daily_metrics m WHERE m.client_id=? ${hasStore?'AND m.store_id=?':''} AND m.metric_date BETWEEN ? AND ? ORDER BY m.metric_date`;
    metrics=(await env.DB.prepare(sql).bind(...binds).all()).results||[];
  }else{
    entities=await granularEntities(env,{clientId,storeId,level:kind,status:filter});
    const binds=hasStore?[clientId,kind,storeId,range.from,range.to]:[clientId,kind,range.from,range.to],sql=`SELECT external_id,metric_date,spend,impressions,reach,clicks,leads,purchases,purchase_value FROM meta_ad_daily_metrics WHERE client_id=? AND level=? ${hasStore?'AND store_id=?':''} AND metric_date BETWEEN ? AND ? ORDER BY metric_date`;
    metrics=(await env.DB.prepare(sql).bind(...binds).all()).results||[];
  }
  const labelMaps=await names(env,{clientId,storeId}),metricByEntity=new Map();
  for(const raw of metrics){const key=kind==='campaign'?clean(raw.campaign_id):clean(raw.external_id);if(!metricByEntity.has(key))metricByEntity.set(key,new Map());metricByEntity.get(key).set(clean(raw.metric_date),metricShape({spend:raw.spend,impressions:raw.impressions,reach:raw.reach,clicks:raw.clicks,leads:raw.leads,purchases:raw.purchases,purchaseValue:raw.purchase_value}));}
  const rows=entities.map(entity=>{const sourceKey=kind==='campaign'?entity.localId:entity.id,map=metricByEntity.get(sourceKey)||new Map(),daily=dates.map(date=>({date,...(map.get(date)||emptyMetric())})),total=sumMetrics(daily);return {...entity,campaignName:kind==='campaign'?entity.name:(labelMaps.campaign.get(entity.campaignId)||''),adsetName:kind==='ad'?(labelMaps.adset.get(entity.adsetId)||''):(kind==='adset'?entity.name:''),daily,total};}).filter(row=>filter==='active'||row.total.spend>0||activeOnly(row.status)).sort((a,b)=>b.total.spend-a.total.spend||b.total.purchases-a.total.purchases);
  return {ok:true,level:kind,statusFilter:filter,from:range.from,to:range.to,capped:range.capped,dates,rows,totals:sumMetrics(rows.flatMap(row=>row.daily))};
}

function graphVersion(env,config={}){const raw=clean(config.apiVersion||env?.META_GRAPH_API_VERSION||'v25.0');return raw.startsWith('v')?raw:`v${raw}`;}
function cleanAccountId(value){return clean(value).replace(/^act_/i,'');}
async function connection(env,clientId){const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider=? AND status='connected' ORDER BY updated_at DESC LIMIT 1").bind(clientId,PROVIDER).first();if(!row)throw Object.assign(new Error('اربط Meta Ads من مركز التكاملات أولًا'),{status:409,code:'META_ADS_NOT_CONNECTED'});let config={};try{config=JSON.parse(row.config_json||'{}')}catch{}const secrets=await readConnectionSecrets(env,clientId,row.id),token=clean(secrets?.access_token),accountId=cleanAccountId(config.adAccountId||config.ad_account_id||row.external_store_id);if(!token)throw Object.assign(new Error('Access Token غير موجود في تكامل Meta Ads'),{status:409,code:'META_TOKEN_MISSING'});if(!accountId)throw Object.assign(new Error('الحساب الإعلاني غير محدد في تكامل Meta Ads'),{status:409,code:'META_AD_ACCOUNT_MISSING'});return {row,config,token,accountId,version:graphVersion(env,config)};}
function graphUrl(version,path,params={}){const url=new URL(`https://graph.facebook.com/${version}/${String(path).replace(/^\/+/, '')}`);for(const [key,value] of Object.entries(params)){if(value===undefined||value===null||value==='')continue;url.searchParams.set(key,typeof value==='object'?JSON.stringify(value):String(value));}return url;}
async function graphGet(fetcher,url,token){const target=url instanceof URL?url:new URL(String(url));if(target.protocol!=='https:'||target.hostname!=='graph.facebook.com')throw Object.assign(new Error('Meta pagination returned an unexpected host'),{status:502,code:'META_PAGING_HOST_INVALID'});const response=await fetcher(target.toString(),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}}),data=await response.json().catch(()=>({}));if(!response.ok||data?.error){const message=clean(data?.error?.message)||`Meta API HTTP ${response.status}`,metaCode=Number(data?.error?.code||0);if(metaCode===190)throw Object.assign(new Error('Meta Access Token غير صالح أو منتهي.'),{status:401,code:'META_TOKEN_INVALID'});if(/breakdown|breakdowns|not supported|not valid|invalid.*field|invalid.*parameter/i.test(message))throw Object.assign(new Error(`Meta لا تسمح بالـ Breakdown المختار مع نوع الإعلان/الحقول الحالية: ${message}`),{status:422,code:'META_BREAKDOWN_UNAVAILABLE'});if([10,100,200,294].includes(metaCode))throw Object.assign(new Error('التوكن لا يملك صلاحية ads_read الكافية لقراءة الـBreakdowns.'),{status:403,code:'META_ADS_READ_PERMISSION'});throw Object.assign(new Error(message),{status:response.status||502,code:'META_BREAKDOWN_FAILED'});}return data;}
async function pages(fetcher,url,token,{maxPages=35}={}){const rows=[];let next=url,count=0;while(next&&count<maxPages){const data=await graphGet(fetcher,next,token);if(Array.isArray(data?.data))rows.push(...data.data);next=data?.paging?.next||null;count++;}if(next)throw Object.assign(new Error('نتائج الـBreakdown أكبر من حد القراءة الآمن. قلّل الفترة.'),{status:409,code:'META_BREAKDOWN_PAGE_LIMIT'});return rows;}
function firstActionValue(items=[],keys=[]){const map=new Map((Array.isArray(items)?items:[]).map(row=>[clean(row?.action_type),n(row?.value)]));for(const key of keys)if(map.has(key))return n(map.get(key));return 0;}
function purchases(row){return firstActionValue(row?.actions,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_web_purchase']);}
function purchaseValue(row){return firstActionValue(row?.action_values,['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase','onsite_web_purchase']);}
function leads(row){return firstActionValue(row?.actions,['lead','omni_lead','offsite_conversion.fb_pixel_lead','onsite_conversion.lead_grouped']);}
function dimensionValue(value){if(value===null||value===undefined||value==='')return 'غير محدد';if(typeof value==='object'){const label=clean(value.name||value.title||value.url||value.id||value.value);return label||JSON.stringify(value);}return clean(value)||'غير محدد';}

export async function metaAdsBreakdown(env,{clientId,storeId=null,from,to,days=7,dimension='image_asset',status='active',fetcher=fetch}={}){
  if(!clientId)throw Object.assign(new Error('clientId مطلوب'),{status:400,code:'CLIENT_ID_REQUIRED'});
  const key=clean(dimension);if(!BREAKDOWN_KEYS.has(key))throw Object.assign(new Error('Breakdown غير مدعوم في واجهة Kun Online'),{status:400,code:'META_BREAKDOWN_INVALID'});
  const range=rangeOf({from,to,days}),conn=await connection(env,clientId),filter=normalizeFilter(status),hasStore=Boolean(clean(storeId));
  const entitySql=`SELECT external_id,name,external_campaign_id,external_adset_id,COALESCE(effective_status,status,'unknown') effective_status FROM meta_ad_entities WHERE client_id=? AND level='ad' ${hasStore?'AND store_id=?':''}`,entityBinds=hasStore?[clientId,storeId]:[clientId],{results:entities=[]}=await env.DB.prepare(entitySql).bind(...entityBinds).all(),entityMap=new Map(entities.map(row=>[clean(row.external_id),row]));
  const labelMaps=await names(env,{clientId,storeId});
  const fields='campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,actions,action_values';
  const raw=await pages(fetcher,graphUrl(conn.version,`act_${conn.accountId}/insights`,{level:'ad',time_range:{since:range.from,until:range.to},breakdowns:key,fields,limit:500}),conn.token);
  const rows=[];
  for(const item of raw){const adId=clean(item?.ad_id),entity=entityMap.get(adId),effective=normalizeStatus(entity?.effective_status||'unknown');if(filter==='active'&&effective!=='active')continue;const metric=metricShape({spend:item?.spend,impressions:item?.impressions,reach:item?.reach,clicks:item?.clicks,leads:leads(item),purchases:purchases(item),purchaseValue:purchaseValue(item)}),value=item?.[key];rows.push({dimension:key,dimensionValue:dimensionValue(value),dimensionRaw:value??null,adId,adName:clean(item?.ad_name)||entity?.name||'',adsetId:clean(item?.adset_id)||clean(entity?.external_adset_id),adsetName:clean(item?.adset_name)||labelMaps.adset.get(clean(item?.adset_id))||'',campaignId:clean(item?.campaign_id)||clean(entity?.external_campaign_id),campaignName:clean(item?.campaign_name)||labelMaps.campaign.get(clean(item?.campaign_id))||'',status:effective,...metric});}
  rows.sort((a,b)=>b.spend-a.spend||b.purchases-a.purchases);
  const catalogItem=META_BREAKDOWN_CATALOG.find(item=>item.key===key);
  return {ok:true,dimension:key,label:catalogItem?.label||key,group:catalogItem?.group||'Breakdown',statusFilter:filter,from:range.from,to:range.to,capped:range.capped,rows,totals:sumMetrics(rows),catalog:META_BREAKDOWN_CATALOG,note:'يتم طلب كل Breakdown منفردًا لأن Meta قد ترفض بعض التركيبات حسب نوع الإعلان والحساب.'};
}
