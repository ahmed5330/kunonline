import {decryptSecret} from './integration-secrets.js';

async function connected(env,clientId,provider){
  const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider=? AND status='connected' ORDER BY updated_at DESC LIMIT 1").bind(clientId,provider).first();
  if(!row)throw Object.assign(new Error(`التكامل ${provider} غير متصل فعليًا`),{code:'AD_PROVIDER_NOT_CONNECTED'});
  let config={};try{config=JSON.parse(row.config_json||'{}')}catch{}
  const {results=[]}=await env.DB.prepare('SELECT secret_name,ciphertext_b64,iv_b64 FROM integration_secrets WHERE client_id=? AND connection_id=?').bind(clientId,row.id).all();
  const secrets={};for(const s of results)secrets[s.secret_name]=await decryptSecret(env,s.ciphertext_b64,s.iv_b64);
  return {row,config,secrets};
}
async function graph(url,token,params){const body=new URLSearchParams();for(const [k,v] of Object.entries(params||{}))if(v!==undefined&&v!==null)body.set(k,typeof v==='object'?JSON.stringify(v):String(v));body.set('access_token',token);const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const d=await r.json().catch(()=>({}));if(!r.ok||d.error)throw Object.assign(new Error(d?.error?.message||`Meta API HTTP ${r.status}`),{code:'META_ADS_API_ERROR',status:r.status});return d;}

async function meta(env,job,payload,action){
  const c=await connected(env,job.client_id,'meta_ads'),token=c.secrets.access_token;if(!token)throw Object.assign(new Error('Meta access token غير مهيأ'),{code:'META_TOKEN_MISSING'});
  const configuredVersion=String(c.config.apiVersion||env.META_GRAPH_API_VERSION||'').trim();if(!configuredVersion)throw Object.assign(new Error('META_GRAPH_API_VERSION غير مهيأ؛ لا يتم تخمين نسخة API في إجراءات الإنفاق'),{code:'META_API_VERSION_REQUIRED'});
  const version=configuredVersion.startsWith('v')?configuredVersion:`v${configuredVersion}`,account=String(c.config.adAccountId||c.config.ad_account_id||'').replace(/^act_/,'');
  const base=`https://graph.facebook.com/${version}`;
  if(action==='publish_campaign'){
    if(!account)throw Object.assign(new Error('Meta adAccountId غير موجود في إعداد التكامل'),{code:'META_AD_ACCOUNT_MISSING'});
    const name=String(payload.name||payload.campaignName||`Kun AI Campaign ${new Date().toISOString().slice(0,10)}`),objective=String(payload.objective||'OUTCOME_SALES');
    // New campaigns start PAUSED intentionally. Human approval allows creation, not uncontrolled spend.
    return {provider:'meta_ads',action,result:await graph(`${base}/act_${account}/campaigns`,token,{name,objective,status:'PAUSED',special_ad_categories:payload.specialAdCategories||[]})};
  }
  const campaignId=String(payload.externalCampaignId||payload.campaignId||'');if(!campaignId)throw Object.assign(new Error('externalCampaignId مطلوب'),{code:'CAMPAIGN_ID_REQUIRED'});
  if(action==='pause_campaign'||action==='resume_campaign')return {provider:'meta_ads',action,result:await graph(`${base}/${campaignId}`,token,{status:action==='pause_campaign'?'PAUSED':'ACTIVE'})};
  if(action==='update_budget'){
    const amount=Number(payload.budget);if(!Number.isFinite(amount)||amount<=0)throw Object.assign(new Error('budget مطلوب وأكبر من صفر'),{code:'BUDGET_REQUIRED'});
    // Meta expects minor units for daily_budget. The account currency determines display.
    return {provider:'meta_ads',action,result:await graph(`${base}/${campaignId}`,token,{daily_budget:Math.round(amount*100)})};
  }
  throw Object.assign(new Error(`Meta adapter لا ينفذ ${action} بعد. أنشئ Ad Set/Creative عبر provider activation flow أولًا.`),{code:'AD_ACTION_REQUIRES_PROVIDER_ACTIVATION'});
}

export async function executeAdProviderAction(env,job,payload={}){
  const action=String(job.action_type||'').replace(/^ads\./,'');const platform=String(payload.platform||'meta_ads');
  if(platform==='meta_ads')return meta(env,job,payload,action);
  // Google Ads / TikTok Ads write APIs require provider OAuth/app permissions and account-specific identifiers.
  // Fail closed rather than pretending success or spending money through an unverified adapter.
  throw Object.assign(new Error(`${platform} جاهز في الـControl/Approval layer لكن التنفيذ الخارجي يحتاج OAuth/API activation للحساب`),{code:'AD_PROVIDER_ACTIVATION_REQUIRED'});
}
