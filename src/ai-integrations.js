import {AI_PROVIDERS,aiProvider,verifyAiProviderKey} from './ai-integration-provider.js';
import {encryptSecret} from './integration-secrets.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {listMyStores,resolveStoreScope} from './store-scope.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=value=>String(value??'').trim();
const safeConfig=value=>{try{const data=JSON.parse(value||'{}');return data&&typeof data==='object'?data:{};}catch{return {};}};
const fail=(message,status=400,code='AI_INTEGRATION_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const stamp=()=>new Date().toISOString();
const formatConnection=(row,hasKey)=>({
 id:row.id,provider:row.provider,storeId:safeConfig(row.config_json).kunAiStoreId||null,
 storeName:row.store_name,status:row.status,hasKey:Boolean(hasKey),
 lastVerifiedAt:row.last_sync_at||null,lastError:row.last_error||null,
 modelsPreview:safeConfig(row.config_json).modelsPreview||[]
});
async function identity(request,delegate){
 const u=new URL('/api/me',request.url);
 const res=await delegate.fetch(new Request(u.toString(),{method:'GET',headers:request.headers}));
 const me=await res.json().catch(()=>({}));
 if(!res.ok||!me?.role)fail('محتاج تسجل دخول',401,'AUTH_REQUIRED');
 return me;
}
async function audit(env,me,clientId,id,action,metadata={}){
 try{
  await env.DB.prepare('INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
   .bind('AUD-'+crypto.randomUUID(),clientId,me.uid||me.id||null,me.email||null,action,'store_connection',id,JSON.stringify(metadata),stamp()).run();
 }catch{/* Audit tables may be unavailable in legacy tenant DBs. Never log secrets. */}
}
async function connection(env,clientId,id){
 const row=await env.DB.prepare("SELECT * FROM store_connections WHERE id=? AND client_id=? AND provider IN ('ai_openai','ai_gemini','ai_anthropic','ai_groq')").bind(id,clientId).first();
 if(!row)fail('الربط غير موجود لهذا الحساب',404,'AI_CONNECTION_NOT_FOUND');
 const storeId=clean(safeConfig(row.config_json).kunAiStoreId);
 if(!storeId)fail('الربط قديم وغير مرتبط بمتجر محدد',409,'AI_STORE_BINDING_REQUIRED');
 return {...row,kunAiStoreId:storeId};
}
async function validateStore(env,me,clientId,storeId,write){
 if(!storeId)fail('اختار المتجر أولًا',400,'AI_STORE_REQUIRED');
 await resolveStoreScope(env,me,clientId,storeId,{write});
}
async function list(env,me,clientId,storeId){
 const access=await listMyStores(env,me,clientId);
 const allowed=access.stores.filter(s=>s.status!=='inactive');
 if(storeId)await validateStore(env,me,clientId,storeId,false);
 const stores=storeId?allowed.filter(s=>String(s.id)===String(storeId)):allowed;
 const {results:rows=[]}=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider IN ('ai_openai','ai_gemini','ai_anthropic','ai_groq') ORDER BY updated_at DESC").bind(clientId).all();
 const {results:secrets=[]}=await env.DB.prepare("SELECT connection_id FROM integration_secrets WHERE client_id=? AND secret_name='api_key'").bind(clientId).all();
 const keys=new Set(secrets.map(x=>x.connection_id)),ids=new Set(stores.map(x=>String(x.id)));
 const connections=rows.filter(x=>ids.has(String(safeConfig(x.config_json).kunAiStoreId||''))).map(x=>formatConnection(x,keys.has(x.id)));
 return {ok:true,providers:AI_PROVIDERS.map(({id,name,site})=>({id,name,site})),
  stores:stores.map(s=>({id:s.id,name:s.name,role:s.role||'owner'})),connections};
}
async function connect(env,me,clientId,body){
 const provider=aiProvider(clean(body.provider)),storeId=clean(body.storeId),key=clean(body.apiKey);
 if(!provider)fail('مزود غير مدعوم',400,'AI_PROVIDER_INVALID');
 await validateStore(env,me,clientId,storeId,true);
 if(key.length>4096)fail('مفتاح API طويل جدًا',400,'AI_KEY_TOO_LONG');
 const store=await env.DB.prepare("SELECT id,name FROM stores WHERE id=? AND client_id=? AND status='active'").bind(storeId,clientId).first();
 if(!store)fail('المتجر غير موجود',404,'AI_STORE_NOT_FOUND');
 const externalId='kunai:'+provider.id+':'+storeId;
 const existing=await env.DB.prepare('SELECT id FROM store_connections WHERE client_id=? AND provider=? AND external_store_id=?').bind(clientId,provider.id,externalId).first();
 if(!existing&&!key)fail('ادخل مفتاح API الخاص بالمزود أولًا',400,'AI_KEY_REQUIRED');
 if(existing&&!key)return {ok:true,connectionId:existing.id,status:'configured',unchanged:true,message:'المفتاح المحفوظ لم يتغير. استخدم تحقق لاختبار الاتصال.'};
 // Encryption occurs before any DB write, so a missing secret does not create
 // a partially configured connection or leave plaintext in the database.
 const encrypted=await encryptSecret(env,key),ts=stamp(),id=existing?.id||'AIC-'+crypto.randomUUID();
 const config=JSON.stringify({kunAiStoreId:storeId,kunAiManaged:true,modelsPreview:[]});
 const statements=[];
 if(existing)statements.push(env.DB.prepare("UPDATE store_connections SET store_name=?,status='configured',last_error=NULL,last_sync_at=NULL,config_json=?,updated_at=? WHERE id=? AND client_id=?").bind(store.name,config,ts,id,clientId));
 else statements.push(env.DB.prepare('INSERT INTO store_connections(id,client_id,provider,store_name,external_store_id,status,scopes_json,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .bind(id,clientId,provider.id,store.name,externalId,'configured',JSON.stringify(['models.read']),config,ts,ts));
 statements.push(env.DB.prepare('INSERT INTO integration_secrets (id,client_id,connection_id,secret_name,ciphertext_b64,iv_b64,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(client_id,connection_id,secret_name) DO UPDATE SET ciphertext_b64=excluded.ciphertext_b64,iv_b64=excluded.iv_b64,updated_at=excluded.updated_at')
  .bind('SEC-'+crypto.randomUUID(),clientId,id,'api_key',encrypted.ciphertextB64,encrypted.ivB64,ts,ts));
 await env.DB.batch(statements);
 await audit(env,me,clientId,id,'ai.connection.save',{provider:provider.id,storeId,rotated:Boolean(existing)});
 return {ok:true,connectionId:id,status:'configured',message:'تم حفظ المفتاح مشفرًا لهذا المتجر. اضغط تحقق حقيقي لفحص الاتصال دون توليد توكنز.'};
}
async function validate(env,me,clientId,id,fetcher){
 const row=await connection(env,clientId,id);
 await validateStore(env,me,clientId,row.kunAiStoreId,true);
 const secrets=await readConnectionSecrets(env,clientId,id);
 const result=await verifyAiProviderKey({providerId:row.provider,apiKey:secrets.api_key,fetcher});
 const ts=stamp(),config={...safeConfig(row.config_json),
  modelsPreview:result.ok?result.modelsPreview:[],verifiedAt:result.ok?result.verifiedAt:null};
 await env.DB.prepare('UPDATE store_connections SET status=?,last_sync_at=?,last_error=?,config_json=?,updated_at=? WHERE id=? AND client_id=?')
  .bind(result.status,result.ok?ts:null,result.ok?null:result.message,JSON.stringify(config),ts,id,clientId).run();
 await audit(env,me,clientId,id,'ai.connection.validate',{provider:row.provider,storeId:row.kunAiStoreId,ok:result.ok,code:result.code||null});
 return {...result,connectionId:id,storeId:row.kunAiStoreId};
}
async function remove(env,me,clientId,id){
 const row=await connection(env,clientId,id);
 await validateStore(env,me,clientId,row.kunAiStoreId,true);
 await env.DB.batch([
  env.DB.prepare('DELETE FROM integration_secrets WHERE client_id=? AND connection_id=?').bind(clientId,id),
  env.DB.prepare('DELETE FROM store_connections WHERE client_id=? AND id=?').bind(clientId,id)
 ]);
 await audit(env,me,clientId,id,'ai.connection.remove',{provider:row.provider,storeId:row.kunAiStoreId});
 return {ok:true,removed:true};
}
export async function handleAiIntegrations({request,env,delegate,fetcher=fetch}){
 const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
 if(!path.startsWith('/api/integrations/ai'))return null;
 try{
  const me=await identity(request,delegate);
  requirePermission(me,'integrations',method==='GET'?'read':'write');
  if(method!=='GET'){
   const origin=request.headers.get('Origin');
   if(origin&&origin!==url.origin)fail('طلب غير معتمد من هذا الموقع',403,'AI_ORIGIN_DENIED');
   if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail('الطلب يجب أن يكون JSON',415,'AI_JSON_REQUIRED');
  }
  const body=method==='GET'?{}:await request.clone().json().catch(()=>({}));
  const clientId=resolveTenant(me,body.clientId||url.searchParams.get('clientId')||me.clientId||null);
  if(path==='/api/integrations/ai'&&method==='GET')return json(await list(env,me,clientId,url.searchParams.get('storeId')||''));
  if(path==='/api/integrations/ai/connect'&&method==='POST')return json(await connect(env,me,clientId,body));
  const matched=path.match(/^\/api\/integrations\/ai\/connections\/([^/]+)(\/validate)?$/);
  if(matched){
   const id=decodeURIComponent(matched[1]);
   if(matched[2]&&method==='POST')return json(await validate(env,me,clientId,id,fetcher));
   if(!matched[2]&&method==='DELETE')return json(await remove(env,me,clientId,id));
  }
  return json({error:'طريقة أو مسار غير مدعوم',code:'AI_ROUTE_INVALID'},405);
 }catch(error){return json({error:error?.message||'تعذر إجراء التكامل',code:error?.code||'AI_INTEGRATION_ERROR'},Number.isInteger(error?.status)?error.status:500);}
}
