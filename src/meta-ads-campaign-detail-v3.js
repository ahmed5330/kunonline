import {readConnectionSecrets} from './integration-provider-validation.js';
import {
  metaAdsDailyComparison,
  metaAdsBreakdown as baseBreakdown,
  META_BREAKDOWN_CATALOG
} from './meta-ads-campaign-detail-v2.js';

const PROVIDER='meta_ads';
const clean=value=>String(value??'').trim();
const TEXT_DIMENSIONS=new Set(['body_asset','title_asset','description_asset','media_text_content']);
const CREATIVE_DIMENSIONS=new Set(['body_asset','title_asset','description_asset','image_asset','video_asset','link_url_asset','call_to_action_asset','ad_format_asset','media_text_content']);
const ARRAY_BY_DIMENSION={body_asset:'bodies',title_asset:'titles',description_asset:'descriptions',image_asset:'images',video_asset:'videos',link_url_asset:'link_urls'};

export {metaAdsDailyComparison,META_BREAKDOWN_CATALOG};

function firstReadable(object,keys){for(const key of keys){const value=object?.[key];if(value!==undefined&&value!==null&&clean(value))return clean(value);}return '';}
function rawAssetId(raw){
  if(raw&&typeof raw==='object')return firstReadable(raw,['id','asset_id','assetId','hash','image_hash','video_id','value']);
  const value=clean(raw);return /^\d{8,}$/.test(value)?value:'';
}
export function readableBreakdownValue(raw,fallback=''){
  if(raw===null||raw===undefined||raw==='')return {value:clean(fallback)||'غير محدد',assetId:'',resolved:false};
  if(typeof raw==='object'){
    const assetId=rawAssetId(raw);
    const value=firstReadable(raw,['text','message','body','headline','description','caption','name','title','label','url','link_url','type','value']);
    if(value&&value!==assetId)return {value,assetId,resolved:true};
    return {value:clean(fallback)||assetId||'غير محدد',assetId,resolved:Boolean(value&&value!==assetId)};
  }
  const value=clean(raw)||clean(fallback)||'غير محدد';
  return {value,assetId:/^\d{8,}$/.test(value)?value:'',resolved:!/^\d{8,}$/.test(value)};
}
function graphVersion(env,config={}){const raw=clean(config.apiVersion||env?.META_GRAPH_API_VERSION||'v25.0');return raw.startsWith('v')?raw:`v${raw}`;}
function cleanAccountId(value){return clean(value).replace(/^act_/i,'');}
async function connection(env,clientId){
  const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider=? AND status='connected' ORDER BY updated_at DESC LIMIT 1").bind(clientId,PROVIDER).first();
  if(!row)throw Object.assign(new Error('اربط Meta Ads من مركز التكاملات أولًا'),{status:409,code:'META_ADS_NOT_CONNECTED'});
  let config={};try{config=JSON.parse(row.config_json||'{}')}catch{}
  const secrets=await readConnectionSecrets(env,clientId,row.id),token=clean(secrets?.access_token),accountId=cleanAccountId(config.adAccountId||config.ad_account_id||row.external_store_id);
  if(!token)throw Object.assign(new Error('Access Token غير موجود في تكامل Meta Ads'),{status:409,code:'META_TOKEN_MISSING'});
  if(!accountId)throw Object.assign(new Error('الحساب الإعلاني غير محدد في تكامل Meta Ads'),{status:409,code:'META_AD_ACCOUNT_MISSING'});
  return {token,accountId,version:graphVersion(env,config)};
}
function graphUrl(version,path='',params={}){const suffix=String(path||'').replace(/^\/+/,''),url=new URL(`https://graph.facebook.com/${version}/${suffix}`);for(const [key,value] of Object.entries(params)){if(value===undefined||value===null||value==='')continue;url.searchParams.set(key,typeof value==='object'?JSON.stringify(value):String(value));}return url;}
async function graphGet(fetcher,url,token){
  const target=url instanceof URL?url:new URL(String(url));
  if(target.protocol!=='https:'||target.hostname!=='graph.facebook.com')throw Object.assign(new Error('Meta creative lookup returned an unexpected host'),{status:502,code:'META_CREATIVE_HOST_INVALID'});
  const response=await fetcher(target.toString(),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}}),data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error)throw Object.assign(new Error(clean(data?.error?.message)||`Meta API HTTP ${response.status}`),{status:response.status||502,code:'META_CREATIVE_LOOKUP_FAILED'});
  return data;
}
function chunks(values,size=45){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function assetDisplay(asset,dimension){
  if(asset===null||asset===undefined)return '';
  if(typeof asset!=='object')return clean(asset);
  const common=dimension==='body_asset'||dimension==='media_text_content'?['text','message','body','name','title']:dimension==='title_asset'?['text','headline','title','name']:dimension==='description_asset'?['text','description','name','title']:dimension==='image_asset'?['name','url','picture','image_url','hash','image_hash']:dimension==='video_asset'?['name','title','video_id','id']:dimension==='link_url_asset'?['url','link_url','website_url','link','name']:['text','name','title','type','value','url'];
  return firstReadable(asset,common);
}
function assetIds(asset){if(!asset||typeof asset!=='object')return [];return ['id','asset_id','assetId','hash','image_hash','video_id','value'].map(key=>clean(asset?.[key])).filter(Boolean);}
function storyFallback(creative,dimension){
  const story=creative?.object_story_spec||{},data=story.link_data||story.video_data||story.photo_data||{};
  if(dimension==='body_asset'||dimension==='media_text_content')return firstReadable(data,['message','text','body']);
  if(dimension==='title_asset')return firstReadable(data,['name','title','headline']);
  if(dimension==='description_asset')return firstReadable(data,['description']);
  if(dimension==='image_asset')return firstReadable(data,['picture','image_url']);
  if(dimension==='video_asset')return firstReadable(data,['video_id']);
  if(dimension==='link_url_asset')return firstReadable(data,['link']);
  if(dimension==='call_to_action_asset')return firstReadable(data?.call_to_action,['type']);
  return '';
}
function creativeAssetMap(ad,dimension){
  const creative=ad?.creative||{},feed=creative?.asset_feed_spec||{},key=ARRAY_BY_DIMENSION[dimension],assets=key&&Array.isArray(feed?.[key])?feed[key]:[];
  const byId=new Map(),readable=[];
  for(const asset of assets){const display=assetDisplay(asset,dimension);if(display)readable.push(display);for(const id of assetIds(asset))if(display)byId.set(id,display);}
  if(dimension==='call_to_action_asset'&&Array.isArray(feed?.call_to_action_types))for(const type of feed.call_to_action_types){const value=clean(type);if(value)readable.push(value);}
  if(dimension==='ad_format_asset'&&Array.isArray(feed?.ad_formats))for(const type of feed.ad_formats){const value=clean(type);if(value)readable.push(value);}
  const fallback=storyFallback(creative,dimension);if(fallback)readable.push(fallback);
  return {byId,readable:[...new Set(readable)]};
}
async function fetchCreativeAds(env,{clientId,adIds,fetcher}){
  const ids=[...new Set(adIds.map(clean).filter(Boolean))];if(!ids.length)return new Map();
  const conn=await connection(env,clientId),out=new Map();
  for(const group of chunks(ids)){
    const data=await graphGet(fetcher,graphUrl(conn.version,'',{ids:group.join(','),fields:'id,name,creative{id,asset_feed_spec,object_story_spec,effective_object_story_id}'}),conn.token);
    for(const [id,ad] of Object.entries(data||{}))if(ad&&typeof ad==='object'&&!ad.error)out.set(clean(id),ad);
  }
  return out;
}
async function enrichCreativeRows(env,{clientId,result,fetcher}){
  const dimension=clean(result?.dimension);if(result?.metricMode!=='delivery'||!CREATIVE_DIMENSIONS.has(dimension)||!Array.isArray(result?.rows))return result;
  let unresolved=[];
  const rows=result.rows.map(row=>{
    const readable=readableBreakdownValue(row.dimensionRaw,row.dimensionValue);
    const next={...row,dimensionValue:readable.value,dimensionAssetId:readable.assetId||rawAssetId(row.dimensionValue),dimensionResolved:readable.resolved,dimensionValueType:TEXT_DIMENSIONS.has(dimension)?'text':'asset'};
    if(!next.dimensionResolved&&next.dimensionAssetId)unresolved.push(next);
    return next;
  });
  if(unresolved.length){
    try{
      const ads=await fetchCreativeAds(env,{clientId,adIds:unresolved.map(row=>row.adId),fetcher});
      for(const row of unresolved){
        const assetId=clean(row.dimensionAssetId),map=creativeAssetMap(ads.get(clean(row.adId)),dimension),matched=assetId?map.byId.get(assetId):'';
        if(matched){row.dimensionValue=matched;row.dimensionResolved=true;row.dimensionResolvedVia='creative-id';continue;}
        if(map.readable.length===1){row.dimensionValue=map.readable[0];row.dimensionResolved=true;row.dimensionResolvedVia='creative-single';}
      }
    }catch(error){
      // Insights remain usable even when the optional creative lookup is unavailable.
      for(const row of unresolved)row.dimensionResolutionError=clean(error?.code||error?.message||'META_CREATIVE_LOOKUP_FAILED');
    }
  }
  return {...result,rows,readableCreativeAssets:true,note:[result.note,'في Breakdowns الخاصة بالكرياتيف يعرض Kun Online النص/العنوان/الوصف أو الأصل المقروء أولًا، ويحتفظ بـ Asset ID كمرجع تقني منفصل.'].filter(Boolean).join(' ')};
}
export async function metaAdsBreakdown(env,args={}){
  const result=await baseBreakdown(env,args);
  return enrichCreativeRows(env,{clientId:args.clientId,result,fetcher:args.fetcher||fetch});
}
