import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-campaign-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Campaign QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex'),ts=new Date().toISOString();
const adminId=`QA-CAMP-ADMIN-${nonce}`,adminEmail=`qa-campaign-${nonce}@example.test`,adminPassword=`Campaign!${randomBytes(10).toString('hex')}Aa1`;
const ids={
  storeB:`QA-CAMP-STORE-${nonce}`,
  campaignA:`QA-CAMP-LOCAL-A-${nonce}`,campaignPaused:`QA-CAMP-LOCAL-P-${nonce}`,campaignForeign:`QA-CAMP-LOCAL-F-${nonce}`,
  extA:`QA-CAMP-A-${nonce}`,extPaused:`QA-CAMP-P-${nonce}`,extForeign:`QA-CAMP-F-${nonce}`,
  setA:`QA-SET-A-${nonce}`,setPaused:`QA-SET-P-${nonce}`,setForeign:`QA-SET-F-${nonce}`,
  adA:`QA-AD-A-${nonce}`,adPaused:`QA-AD-P-${nonce}`,adForeign:`QA-AD-F-${nonce}`
};
const names={
  campaignA:`QA Campaign Active ${nonce}`,campaignPaused:`QA Campaign Paused ${nonce}`,campaignForeign:`QA Campaign Foreign ${nonce}`,
  setA:`QA AdSet Active ${nonce}`,setPaused:`QA AdSet Paused ${nonce}`,setForeign:`QA AdSet Foreign ${nonce}`,
  adA:`QA Ad Active ${nonce}`,adPaused:`QA Ad Paused ${nonce}`,adForeign:`QA Ad Foreign ${nonce}`
};
let adminCookie='',clientId='',storeA='';

const day1=new Date();day1.setUTCHours(0,0,0,0);
const day0=new Date(day1.getTime()-86400000);
const d1Date=day1.toISOString().slice(0,10),d0Date=day0.toISOString().slice(0,10);
const enc=encodeURIComponent;
const must=(ok,message)=>{if(!ok)throw new Error(message);};

async function d1(sql,params=[]){
  const response=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({})),result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Preview D1 query failed (${response.status}): ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,900)}`);
  return result?.results||[];
}
async function hashPassword(value){
  const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}
async function login(){
  const response=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:adminEmail,password:adminPassword})});
  const text=await response.text();if(response.status!==200)throw new Error(`Campaign QA admin login failed (${response.status}): ${text.slice(0,500)}`);
  const cookie=(response.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Campaign QA admin cookie missing');return cookie;
}
async function api(path,{ok=[200]}={}){
  const response=await fetch(`${base}${path}`,{headers:{Cookie:adminCookie,'Cache-Control':'no-cache'}}),text=await response.text();let data={};
  try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!ok.includes(response.status))throw new Error(`GET ${path} expected ${ok.join('/')}, got ${response.status}: ${text.slice(0,800)}`);
  return data;
}
async function cleanup(){
  const errors=[];
  const ops=[
    ['DELETE FROM meta_ad_daily_metrics WHERE client_id=? AND external_id IN (?,?,?,?,?,?)',[clientId,ids.setA,ids.setPaused,ids.setForeign,ids.adA,ids.adPaused,ids.adForeign]],
    ['DELETE FROM meta_ad_entities WHERE client_id=? AND external_id IN (?,?,?,?,?,?)',[clientId,ids.setA,ids.setPaused,ids.setForeign,ids.adA,ids.adPaused,ids.adForeign]],
    ['DELETE FROM campaign_daily_metrics WHERE client_id=? AND campaign_id IN (?,?,?)',[clientId,ids.campaignA,ids.campaignPaused,ids.campaignForeign]],
    ['DELETE FROM marketing_campaigns WHERE client_id=? AND id IN (?,?,?)',[clientId,ids.campaignA,ids.campaignPaused,ids.campaignForeign]],
    ['DELETE FROM stores WHERE id=?',[ids.storeB]],
    ['DELETE FROM login_attempts WHERE email=?',[adminEmail]],
    ['DELETE FROM users WHERE id=?',[adminId]]
  ];
  for(const [sql,params] of ops){try{await d1(sql,params)}catch(error){errors.push(error.message)}}
  if(errors.length)throw new Error(`Campaign live cleanup failed: ${errors.join(' | ')}`);
}
function seedMetric(level,externalId,campaignId,adsetId,storeId,date,spend,impressions,reach,clicks,purchases,purchaseValue){
  return d1('INSERT INTO meta_ad_daily_metrics (client_id,store_id,level,external_id,external_campaign_id,external_adset_id,metric_date,spend,impressions,reach,clicks,leads,purchases,purchase_value,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
    clientId,storeId,level,externalId,campaignId,adsetId||null,date,spend,impressions,reach,clicks,Math.max(0,Math.round(purchases/2)),purchases,purchaseValue,ts
  ]);
}

let primaryError=null;
try{
  const store=(await d1("SELECT id,client_id FROM stores WHERE status='active' AND client_id IS NOT NULL AND trim(client_id)<>'' ORDER BY is_default DESC,created_at LIMIT 1"))[0];
  if(!store?.id||!store?.client_id)throw new Error('Campaign live QA needs one active Preview store');
  storeA=String(store.id);clientId=String(store.client_id);

  await d1('DELETE FROM login_attempts WHERE email=?',[adminEmail]);await d1('DELETE FROM users WHERE id=? OR email=?',[adminId,adminEmail]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminId,adminEmail,'CI Campaign Admin',await hashPassword(adminPassword),'admin','active',ts]);
  adminCookie=await login();

  const version=await api('/api/preview/version');
  must(version.environment==='preview'&&version.entrypoint==='index-commerce-v36.js'&&String(version.build||'').includes('campaign'),'Campaign live QA is not running on the current Campaign Preview build');

  await d1('INSERT INTO stores (id,client_id,name,code,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[ids.storeB,clientId,`QA Campaign Foreign Store ${nonce}`,`QAC${nonce}`,'active',0,ts,ts]);
  for(const row of [
    [ids.campaignA,storeA,ids.extA,names.campaignA,'active',500],
    [ids.campaignPaused,storeA,ids.extPaused,names.campaignPaused,'paused',250],
    [ids.campaignForeign,ids.storeB,ids.extForeign,names.campaignForeign,'active',900]
  ])await d1('INSERT INTO marketing_campaigns (id,client_id,store_id,platform,external_campaign_id,name,objective,status,currency,budget,created_at,updated_at) VALUES (?,?,?,\'meta_ads\',?,?,\'sales\',?,\'EGP\',?,?,?)',[row[0],clientId,row[1],row[2],row[3],row[4],row[5],ts,ts]);

  for(const [campaignId,storeId,date,spend,impressions,reach,clicks,purchases,value] of [
    [ids.campaignA,storeA,d0Date,100,10000,8000,200,4,600],[ids.campaignA,storeA,d1Date,120,11000,8500,220,5,800],
    [ids.campaignForeign,ids.storeB,d0Date,700,50000,40000,900,20,4000]
  ])await d1('INSERT INTO campaign_daily_metrics (client_id,campaign_id,metric_date,spend,impressions,clicks,updated_at,store_id,reach,leads,platform_purchases,platform_purchase_value) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[clientId,campaignId,date,spend,impressions,clicks,ts,storeId,reach,Math.max(1,Math.round(purchases/2)),purchases,value]);

  for(const row of [
    ['adset',ids.setA,ids.extA,null,names.setA,'active',storeA],['adset',ids.setPaused,ids.extPaused,null,names.setPaused,'paused',storeA],['adset',ids.setForeign,ids.extForeign,null,names.setForeign,'active',ids.storeB],
    ['ad',ids.adA,ids.extA,ids.setA,names.adA,'active',storeA],['ad',ids.adPaused,ids.extPaused,ids.setPaused,names.adPaused,'paused',storeA],['ad',ids.adForeign,ids.extForeign,ids.setForeign,names.adForeign,'active',ids.storeB]
  ])await d1('INSERT INTO meta_ad_entities (client_id,store_id,level,external_id,external_campaign_id,external_adset_id,name,status,effective_status,optimization_goal,budget,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,\'OFFSITE_CONVERSIONS\',100,\'EGP\',?,?)',[clientId,row[6],row[0],row[1],row[2],row[3],row[4],row[5],row[5],ts,ts]);

  for(const metric of [
    ['adset',ids.setA,ids.extA,null,storeA,d0Date,100,10000,8000,200,4,600],['adset',ids.setA,ids.extA,null,storeA,d1Date,120,11000,8500,220,5,800],
    ['ad',ids.adA,ids.extA,ids.setA,storeA,d0Date,100,10000,8000,200,4,600],['ad',ids.adA,ids.extA,ids.setA,storeA,d1Date,120,11000,8500,220,5,800],
    ['adset',ids.setForeign,ids.extForeign,null,ids.storeB,d0Date,700,50000,40000,900,20,4000],['ad',ids.adForeign,ids.extForeign,ids.setForeign,ids.storeB,d0Date,700,50000,40000,900,20,4000]
  ])await seedMetric(...metric);

  const qs=`clientId=${enc(clientId)}&storeId=${enc(storeA)}&from=${d0Date}&to=${d1Date}`;
  const hub=await api(`/api/integrations/meta-ads/campaign-hub?${qs}`),hubText=JSON.stringify(hub);
  for(const expected of [names.campaignA,names.campaignPaused,names.setA,names.setPaused,names.adA,names.adPaused])must(hubText.includes(expected),`Campaign Hub missing scoped QA entity: ${expected}`);
  for(const hidden of [names.campaignForeign,names.setForeign,names.adForeign])must(!hubText.includes(hidden),`Campaign Hub leaked foreign-store entity: ${hidden}`);
  must(hub.allEntitiesIncluded===true,'Campaign Hub must include inactive zero-spend ad/adset catalog rows');
  for(const breakdown of ['affiliate_click_region','affiliate_link_url','msa_seller_name','placement_path','action__action_type'])must(hub.breakdownCatalog?.some?.(item=>item.id===breakdown),`Campaign Hub breakdown catalog missing ${breakdown}`);

  const activeCampaigns=await api(`/api/integrations/meta-ads/daily-comparison?${qs}&level=campaign&status=active`);
  const activeRow=activeCampaigns.rows?.find(row=>row.id===ids.extA||row.name===names.campaignA);
  must(activeRow&&activeRow.total?.spend===220&&activeRow.total?.purchases===9&&activeRow.total?.purchaseValue===1400,'Campaign daily comparison totals are incorrect');
  must(!activeCampaigns.rows?.some(row=>row.name===names.campaignPaused||row.name===names.campaignForeign),'Active campaign comparison must exclude paused and foreign-store campaigns');

  const allCampaigns=await api(`/api/integrations/meta-ads/daily-comparison?${qs}&level=campaign&status=all`);
  const pausedCampaign=allCampaigns.rows?.find(row=>row.name===names.campaignPaused);
  must(pausedCampaign&&pausedCampaign.total?.spend===0&&allCampaigns.allEntitiesIncluded===true,'All campaign comparison must include paused zero-spend campaigns');
  must(!allCampaigns.rows?.some(row=>row.name===names.campaignForeign),'All campaign comparison leaked foreign store');

  for(const [level,activeName,pausedName,foreignName] of [['adset',names.setA,names.setPaused,names.setForeign],['ad',names.adA,names.adPaused,names.adForeign]]){
    const result=await api(`/api/integrations/meta-ads/daily-comparison?${qs}&level=${level}&status=all`);
    must(result.rows?.some(row=>row.name===activeName),'All comparison missing active '+level);
    must(result.rows?.some(row=>row.name===pausedName&&row.total?.spend===0),'All comparison missing zero-spend paused '+level);
    must(!result.rows?.some(row=>row.name===foreignName),'All comparison leaked foreign-store '+level);
  }

  const foreignQs=`clientId=${enc(clientId)}&storeId=${enc(ids.storeB)}&from=${d0Date}&to=${d1Date}`;
  const foreignHub=await api(`/api/integrations/meta-ads/campaign-hub?${foreignQs}`),foreignText=JSON.stringify(foreignHub);
  must(foreignText.includes(names.campaignForeign)&&foreignText.includes(names.adForeign),'Explicit foreign QA store scope did not return its own Campaign data');
  must(!foreignText.includes(names.campaignA)&&!foreignText.includes(names.adA),'Explicit foreign QA store scope leaked Store A Campaign data');

  console.log(`Live Campaign Hub QA passed: authenticated campaign/adset/ad analysis, active/all zero-spend coverage, exact daily totals, current breakdown catalog and Store A/B isolation (${clientId}/${storeA}).`);
}catch(error){primaryError=error;
}finally{try{await cleanup()}catch(cleanupError){primaryError=primaryError?new Error(`${primaryError.message}; ${cleanupError.message}`):cleanupError;}}
if(primaryError)throw primaryError;
