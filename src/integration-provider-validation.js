import {decryptSecret} from './integration-secrets.js';

const META_PROVIDER='meta_ads';
const EASYORDERS_PROVIDER='easyorders';
const EASYORDERS_PRODUCTS_URL='https://api.easy-orders.net/api/v1/external-apps/products';
const cleanAccountId=value=>String(value||'').trim().replace(/^act_/i,'');
const graphVersion=env=>{const raw=String(env?.META_GRAPH_API_VERSION||'v25.0').trim();return raw.startsWith('v')?raw:`v${raw}`;};
const safeAccount=row=>({id:String(row?.id||''),accountId:cleanAccountId(row?.account_id||row?.id),name:String(row?.name||'حساب إعلاني بدون اسم'),accountStatus:Number(row?.account_status||0),currency:String(row?.currency||''),timezone:String(row?.timezone_name||'')});

function metaFailure(error){
  const code=Number(error?.metaCode||0),original=String(error?.message||'تعذر الاتصال بـ Meta');
  if(code===190)return {code:'META_TOKEN_INVALID',message:'Meta رفضت التوكن لأنه غير صالح أو منتهي. أنشئ User Access Token أو System User Token صالحًا للتطبيق وبصلاحية ads_read، وأضف ads_management إذا كنت تريد تنفيذ تعديلات على الحملات.'};
  if([10,100,200,294].includes(code))return {code:'META_TOKEN_PERMISSION',message:'Meta قبلت الطلب لكن التوكن لا يملك الصلاحيات اللازمة للوصول إلى حسابات الإعلانات. لو التوكن App Access Token فهو غير مناسب لربط حساب إعلاني؛ استخدم User Access Token أو System User Token بصلاحية ads_read، وads_management للكتابة.'};
  return {code:'META_CONNECTIVITY_FAILED',message:`فشل التحقق الحقيقي من Meta: ${original}`};
}

async function metaGet(fetcher,version,path,token,params={}){
  const url=new URL(`https://graph.facebook.com/${version}/${String(path).replace(/^\/+/, '')}`);
  for(const [key,value] of Object.entries(params))if(value!==undefined&&value!==null&&String(value)!=='')url.searchParams.set(key,String(value));
  const response=await fetcher(url.toString(),{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error){const error=new Error(data?.error?.message||`Meta API HTTP ${response.status}`);error.code='META_API_ERROR';error.status=response.status;error.metaCode=data?.error?.code;error.metaSubcode=data?.error?.error_subcode;throw error;}
  return data;
}

export async function readConnectionSecrets(env,clientId,connectionId){
  const {results=[]}=await env.DB.prepare('SELECT secret_name,ciphertext_b64,iv_b64 FROM integration_secrets WHERE client_id=? AND connection_id=?').bind(clientId,connectionId).all();
  const secrets={};for(const row of results)secrets[row.secret_name]=await decryptSecret(env,row.ciphertext_b64,row.iv_b64);return secrets;
}

export async function validateMetaAdsConnection({env,secrets,selectedAdAccountId,fetcher=fetch}){
  const token=String(secrets?.access_token||'').trim();
  if(!token)return {ok:false,status:'disconnected',externalConnectivityChecked:false,code:'META_TOKEN_MISSING',config:{adAccountConfirmed:false},message:'Access Token غير موجود.'};
  const version=graphVersion(env);let identity,accountList;
  try{
    identity=await metaGet(fetcher,version,'me',token,{fields:'id,name'});
    const response=await metaGet(fetcher,version,'me/adaccounts',token,{fields:'id,account_id,name,account_status,currency,timezone_name',limit:'100'});
    accountList=Array.isArray(response?.data)?response.data.map(safeAccount).filter(x=>x.accountId):[];
  }catch(error){const failure=metaFailure(error);return {ok:false,status:'disconnected',externalConnectivityChecked:true,...failure,config:{adAccountConfirmed:false},metaCode:error?.metaCode||null,apiVersion:version};}
  if(!accountList.length)return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'META_NO_AD_ACCOUNTS',apiVersion:version,config:{adAccountConfirmed:false},identity:{id:String(identity?.id||''),name:String(identity?.name||'')},message:'التوكن صالح عند Meta، لكن لا توجد حسابات إعلانية متاحة له. تأكد أن المستخدم أو System User مضاف للحساب الإعلاني وأن التوكن لديه ads_read.'};
  const requested=cleanAccountId(selectedAdAccountId);
  if(!requested)return {ok:true,status:'configured',externalConnectivityChecked:true,requiresAccountSelection:true,requiresAccountIdInput:true,accounts:accountList,apiVersion:version,config:{adAccountConfirmed:false},identity:{id:String(identity?.id||''),name:String(identity?.name||'')},message:'اكتب رقم الحساب الإعلاني Ad Account ID الذي تريد ربطه بهذا العميل. لن يختار Kun Online أي حساب تلقائيًا حتى لو كان التوكن يرى حسابًا واحدًا فقط.'};
  const selected=accountList.find(x=>x.accountId===requested||x.id===`act_${requested}`);
  if(!selected)return {ok:false,status:'configured',externalConnectivityChecked:true,requiresAccountSelection:true,requiresAccountIdInput:true,code:'META_AD_ACCOUNT_NOT_ACCESSIBLE',accounts:accountList,apiVersion:version,config:{adAccountConfirmed:false},message:`الحساب الإعلاني act_${requested} غير متاح لهذا التوكن. تأكد من رقم الحساب وأن المستخدم أو System User لديه صلاحية عليه.`};
  let verified=selected;
  try{const direct=await metaGet(fetcher,version,`act_${selected.accountId}`,token,{fields:'id,account_id,name,account_status,currency,timezone_name'});verified=safeAccount(direct);}catch(error){const failure=metaFailure(error);return {ok:false,status:'disconnected',externalConnectivityChecked:true,...failure,config:{adAccountConfirmed:false},metaCode:error?.metaCode||null,apiVersion:version};}
  return {ok:true,status:'connected',externalConnectivityChecked:true,requiresAccountSelection:false,requiresAccountIdInput:false,apiVersion:version,identity:{id:String(identity?.id||''),name:String(identity?.name||'')},account:verified,externalStoreId:`act_${verified.accountId}`,storeName:verified.name,config:{apiVersion:version,adAccountId:verified.accountId,adAccountConfirmed:true},message:`تم الاتصال بـ Meta Ads بنجاح — ${verified.name} (act_${verified.accountId}).`};
}

export async function validateEasyOrdersConnection({secrets,fetcher=fetch}){
  const apiKey=String(secrets?.api_key||'').trim();
  if(!apiKey)return {ok:false,status:'disconnected',externalConnectivityChecked:false,code:'EASYORDERS_API_KEY_MISSING',message:'مفتاح Easy Orders API غير موجود.'};
  let response;
  try{
    response=await fetcher(EASYORDERS_PRODUCTS_URL,{method:'GET',headers:{'Api-Key':apiKey,Accept:'application/json'}});
  }catch(error){
    return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'EASYORDERS_CONNECTIVITY_FAILED',message:`تعذر الاتصال بـ Easy Orders: ${String(error?.message||'خطأ في الشبكة')}`};
  }
  if(response.ok){
    const payload=await response.clone().json().catch(()=>null),items=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.products)?payload.products:Array.isArray(payload?.data?.products)?payload.data.products:[];
    const externalStoreId=String(payload?.store_id||payload?.storeId||items[0]?.store_id||items[0]?.storeId||'').trim()||null;
    return {ok:true,status:'connected',externalConnectivityChecked:true,externalStoreId,config:{authentication:'api-key',validatedResource:'products',easyOrdersStoreId:externalStoreId},message:externalStoreId?'تم الاتصال بـ Easy Orders وربط Store ID لاستقبال الطلبات الجديدة.':'تم الاتصال بـ Easy Orders. فعّل Webhook الطلبات؛ تعذر اكتشاف Store ID تلقائيًا لأن قائمة المنتجات لا تحتويه.'};
  }
  if(response.status===401)return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'EASYORDERS_API_KEY_INVALID',message:'Easy Orders رفضت مفتاح API. انسخ المفتاح الظاهر مرة واحدة عند إنشائه من Public API، وليس رقم سجل المفتاح.'};
  if(response.status===403)return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'EASYORDERS_PRODUCTS_READ_FORBIDDEN',message:'مفتاح Easy Orders صالح لكنه لا يملك صلاحية products:read المطلوبة للتحقق.'};
  if(response.status===429)return {ok:false,status:'configured',externalConnectivityChecked:true,code:'EASYORDERS_RATE_LIMITED',message:'Easy Orders أوقفت التحقق مؤقتًا بسبب حد الطلبات. حاول مرة أخرى بعد قليل.'};
  return {ok:false,status:'disconnected',externalConnectivityChecked:true,code:'EASYORDERS_VALIDATION_FAILED',message:`فشل التحقق من Easy Orders (HTTP ${response.status}).`};
}

export async function validateProviderConnection({env,provider,secrets,selectedAdAccountId,fetcher=fetch}){
  if(provider?.id===META_PROVIDER)return validateMetaAdsConnection({env,secrets,selectedAdAccountId,fetcher});
  if(provider?.id===EASYORDERS_PROVIDER)return validateEasyOrdersConnection({secrets,fetcher});
  return {ok:true,status:'configured',externalConnectivityChecked:false,code:'PROVIDER_EXTERNAL_VALIDATION_PENDING',message:`بيانات ${provider?.name||provider?.id||'التكامل'} محفوظة، لكن التحقق الخارجي لهذا المزود لم يتم تفعيله بعد.`};
}


