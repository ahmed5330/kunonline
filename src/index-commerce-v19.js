import commerceV18 from './index-commerce-v18.js';
import {requirePermission} from './access-control.js';
import {providerById} from './provider-registry.js';
import {readConnectionSecrets,validateProviderConnection} from './integration-provider-validation.js';

const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8'}});
const now=()=>new Date().toISOString();
const id=p=>`${p}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
async function me(request,env,ctx){const u=new URL(request.url);u.pathname='/api/me';u.search='';const r=await commerceV18.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx),d=await r.json().catch(()=>({}));if(!r.ok||!d?.role)throw Object.assign(new Error(d?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});return d;}
function tenant(m,r){if(m.role==='client'){if(r&&String(r)!==String(m.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});return m.clientId;}if(!r)throw Object.assign(new Error('محتاج clientId'),{status:400,code:'CLIENT_ID_REQUIRED'});return r;}
async function audit(env,m,clientId,connectionId,metadata={}){await env.DB.prepare(`INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id('AUD'),clientId,m.uid||null,m.email||null,'integration.connection.validate','store_connection',connectionId,JSON.stringify(metadata),now()).run();}
async function persistValidation(env,clientId,connection,result,currentConfig){const ts=now(),nextConfig={...(currentConfig||{}),...(result.config||{})},status=result.status||'configured',connected=status==='connected';await env.DB.prepare(`UPDATE store_connections SET status=?,store_name=COALESCE(?,store_name),external_store_id=COALESCE(?,external_store_id),config_json=?,last_sync_at=?,last_error=?,updated_at=? WHERE id=? AND client_id=?`).bind(status,connected?(result.storeName||null):null,connected?(result.externalStoreId||null):null,JSON.stringify(nextConfig),connected?ts:(connection.last_sync_at||null),result.ok?null:(result.message||'Validation failed'),ts,connection.id,clientId).run();}
async function fetchV19(request,env,ctx){
  const u=new URL(request.url),p=u.pathname,method=request.method.toUpperCase(),x=p.match(/^\/api\/integrations\/connections\/([^/]+)\/validate$/);
  try{
    if(!x||method!=='POST')return commerceV18.fetch(request,env,ctx);
    const m=await me(request,env,ctx);requirePermission(m,'integrations','write');
    const b=await request.json().catch(()=>({})),clientId=tenant(m,b.clientId||u.searchParams.get('clientId')||(m.role==='client'?m.clientId:null)),connectionId=decodeURIComponent(x[1]);
    const connection=await env.DB.prepare('SELECT * FROM store_connections WHERE id=? AND client_id=?').bind(connectionId,clientId).first();if(!connection)return json({error:'التكامل غير موجود'},404);
    const provider=providerById(connection.provider);if(!provider)return json({error:'Provider غير مدعوم'},400);
    const {results:secretRows=[]}=await env.DB.prepare('SELECT secret_name FROM integration_secrets WHERE client_id=? AND connection_id=?').bind(clientId,connectionId).all();
    const names=new Set(secretRows.map(r=>r.secret_name)),missing=provider.requiredSecrets.filter(secret=>!names.has(secret));
    if(missing.length){const ts=now(),message=`بيانات ناقصة: ${missing.join('، ')}`;await env.DB.prepare('UPDATE store_connections SET status=?,last_error=?,updated_at=? WHERE id=? AND client_id=?').bind('disconnected',message,ts,connectionId,clientId).run();await audit(env,m,clientId,connectionId,{provider:provider.id,ok:false,missingSecrets:missing,externalConnectivityChecked:false});return json({ok:false,status:'disconnected',missingSecrets:missing,externalConnectivityChecked:false,message});}
    const secrets=await readConnectionSecrets(env,clientId,connectionId);let currentConfig={};try{currentConfig=JSON.parse(connection.config_json||'{}')}catch{}
    const result=await validateProviderConnection({env,provider,secrets,selectedAdAccountId:b.adAccountId||b.ad_account_id||currentConfig.adAccountId});
    await persistValidation(env,clientId,connection,result,currentConfig);
    await audit(env,m,clientId,connectionId,{provider:provider.id,ok:!!result.ok,status:result.status,externalConnectivityChecked:!!result.externalConnectivityChecked,requiresAccountSelection:!!result.requiresAccountSelection,adAccountId:result.account?.accountId||null,code:result.code||null});
    return json({...result,missingSecrets:[]});
  }catch(e){return json({error:e.message||'حدث خطأ',code:e.code||null},e.status||500);}
}
export default {fetch:fetchV19,scheduled(c,e,x){return commerceV18.scheduled?.(c,e,x);}};
