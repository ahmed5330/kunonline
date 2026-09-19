const clean=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const normalizeStatus=value=>clean(value||'unknown').toLowerCase().replace(/^campaign_/,'').replace(/_/g,'-');
const falseDiagnostics=()=>({winner:false,waste:false,fatigue:false,lowCtr:false,highCpm:false,landingRisk:false,scale:false});
const zeroTrend=()=>({earlyCtr:0,lateCtr:0,ctrChange:0,earlyRoas:0,lateRoas:0,roasChange:0,earlyCpp:0,lateCpp:0,cppChange:0});
const zeroMetrics=()=>({spend:0,impressions:0,reach:0,clicks:0,leads:0,purchases:0,purchaseValue:0,ctr:0,cpc:0,cpm:0,frequency:0,cpp:0,roas:0,cvr:0});

async function entityCatalog(env,{clientId,storeId=null,level}){
  const hasStore=Boolean(clean(storeId));
  const sql=`SELECT external_id,external_campaign_id,external_adset_id,name,status,effective_status,optimization_goal,budget,currency,store_id FROM meta_ad_entities WHERE client_id=? AND level=? ${hasStore?'AND store_id=?':''} ORDER BY updated_at DESC`;
  const binds=hasStore?[clientId,level,storeId]:[clientId,level];
  return (await env.DB.prepare(sql).bind(...binds).all()).results||[];
}
async function campaignNames(env,{clientId,storeId=null}){
  const hasStore=Boolean(clean(storeId)),binds=hasStore?[clientId,storeId]:[clientId];
  const {results=[]}=await env.DB.prepare(`SELECT external_campaign_id,name FROM marketing_campaigns WHERE client_id=? AND platform='meta_ads' ${hasStore?'AND store_id=?':''}`).bind(...binds).all();
  return new Map(results.map(row=>[clean(row.external_campaign_id),row.name]));
}
async function adsetNames(env,{clientId,storeId=null}){
  const rows=await entityCatalog(env,{clientId,storeId,level:'adset'});
  return new Map(rows.map(row=>[clean(row.external_id),row.name]));
}
function expertRow(entity,{campaignMap,adsetMap}){
  return {
    externalId:clean(entity.external_id),name:entity.name||'بدون اسم',campaignId:clean(entity.external_campaign_id),campaignName:campaignMap.get(clean(entity.external_campaign_id))||'',adsetId:clean(entity.external_adset_id),adsetName:adsetMap.get(clean(entity.external_adset_id))||'',storeId:clean(entity.store_id),status:normalizeStatus(entity.effective_status||entity.status),optimizationGoal:clean(entity.optimization_goal),budget:n(entity.budget),currency:entity.currency||'EGP',
    ...zeroMetrics(),trend:zeroTrend(),flags:[],score:0,diagnostics:falseDiagnostics()
  };
}
function mergeExpertRows(existing=[],catalog=[],maps){
  const ids=new Set(existing.map(row=>clean(row.externalId)));
  const missing=catalog.filter(entity=>!ids.has(clean(entity.external_id))).map(entity=>expertRow(entity,maps));
  return [...existing,...missing];
}
export async function includeInactiveExpertEntities(env,{clientId,storeId=null,analysis}){
  if(!analysis)return analysis;
  const [sets,ads,campaignMap,adsetMap]=await Promise.all([
    entityCatalog(env,{clientId,storeId,level:'adset'}),entityCatalog(env,{clientId,storeId,level:'ad'}),campaignNames(env,{clientId,storeId}),adsetNames(env,{clientId,storeId})
  ]);
  return {
    ...analysis,
    adsets:{...(analysis.adsets||{}),rows:mergeExpertRows(analysis?.adsets?.rows||[],sets,{campaignMap,adsetMap})},
    ads:{...(analysis.ads||{}),rows:mergeExpertRows(analysis?.ads?.rows||[],ads,{campaignMap,adsetMap})},
    allEntitiesIncluded:true
  };
}

function emptyDay(date){return {date,...zeroMetrics()};}
function comparisonEntity(entity,level,{campaignMap,adsetMap}){
  if(level==='campaign')return {id:clean(entity.external_campaign_id)||clean(entity.id),localId:clean(entity.id),name:entity.name||'بدون اسم',status:normalizeStatus(entity.status),currency:entity.currency||'EGP',budget:n(entity.budget),campaignId:clean(entity.external_campaign_id),campaignName:entity.name||'بدون اسم',adsetName:''};
  return {id:clean(entity.external_id),name:entity.name||'بدون اسم',status:normalizeStatus(entity.effective_status||entity.status),currency:entity.currency||'EGP',budget:n(entity.budget),campaignId:clean(entity.external_campaign_id),campaignName:campaignMap.get(clean(entity.external_campaign_id))||'',adsetId:clean(entity.external_adset_id),adsetName:level==='ad'?(adsetMap.get(clean(entity.external_adset_id))||''):(entity.name||'بدون اسم'),optimizationGoal:clean(entity.optimization_goal)};
}
async function campaignCatalog(env,{clientId,storeId=null}){
  const hasStore=Boolean(clean(storeId)),binds=hasStore?[clientId,storeId]:[clientId];
  return (await env.DB.prepare(`SELECT id,external_campaign_id,name,status,currency,budget FROM marketing_campaigns WHERE client_id=? AND platform='meta_ads' ${hasStore?'AND store_id=?':''} ORDER BY updated_at DESC`).bind(...binds).all()).results||[];
}
export async function includeInactiveComparisonEntities(env,{clientId,storeId=null,level,result}){
  if(!result||result.statusFilter!=='all')return result;
  const [catalog,campaignMap,adsetMap]=await Promise.all([
    level==='campaign'?campaignCatalog(env,{clientId,storeId}):entityCatalog(env,{clientId,storeId,level}),campaignNames(env,{clientId,storeId}),adsetNames(env,{clientId,storeId})
  ]);
  const ids=new Set((result.rows||[]).map(row=>clean(row.id)));
  const missing=catalog.map(entity=>comparisonEntity(entity,level,{campaignMap,adsetMap})).filter(entity=>entity.id&&!ids.has(entity.id)).map(entity=>({...entity,daily:(result.dates||[]).map(emptyDay),total:zeroMetrics()}));
  return {...result,rows:[...(result.rows||[]),...missing],allEntitiesIncluded:true};
}
