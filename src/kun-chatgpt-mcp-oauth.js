import {ensureKunMcpSchema} from './kun-chatgpt-mcp-schema.js';
import {listMyStores} from './store-scope.js';

export const KUN_MCP_ORIGIN='https://app.kun-online.com';
export const KUN_MCP_RESOURCE=KUN_MCP_ORIGIN+'/mcp';
const SCOPE='kun:read';
const stamp=()=>Math.floor(Date.now()/1000);
const encode=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const j=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
export const sha256=async s=>b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(s)))));
const die=(message,status=400,code='MCP_OAUTH_INVALID')=>{throw Object.assign(new Error(message),{status,code});};
function authorizedClient(id,redirect){
 const client=/^https:\/\/chatgpt\.com\/oauth\/(?:client\.json|[A-Za-z0-9_-]{6,128}\/client\.json)$/.test(id||'');
 const callback=/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]{6,128})$/.test(redirect||'');
 return client&&callback;
}
function oauthParams(q){
 const client_id=q.get('client_id')||'',redirect_uri=q.get('redirect_uri')||'',resource=q.get('resource')||'',
  challenge=q.get('code_challenge')||'',state=q.get('state')||'',scope=q.get('scope')||SCOPE;
 if(q.get('response_type')!=='code'||!authorizedClient(client_id,redirect_uri)
   ||resource!==KUN_MCP_RESOURCE||q.get('code_challenge_method')!=='S256'
   ||!/^[A-Za-z0-9_-]{43}$/.test(challenge)||scope!==SCOPE||state.length>1200)
  die('طلب تفويض ChatGPT غير صالح',400,'MCP_OAUTH_PARAMS_INVALID');
 return {client_id,redirect_uri,resource,challenge,state,scope};
}
async function meFromDelegate(request,delegate){
 const u=new URL('/api/me',request.url);
 const r=await delegate.fetch(new Request(u.toString(),{method:'GET',headers:request.headers}));
 const me=await r.json().catch(()=>({}));
 return r.ok&&me?.role==='client'&&me.clientId?me:null;
}
function html(content,status=200,headers={}){return new Response('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ربط ChatGPT | كن أونلاين</title><style>body{font-family:system-ui;background:#f5f6fa;color:#17243c;margin:0;padding:28px}main{max-width:560px;margin:50px auto;background:white;padding:26px;border-radius:18px;border:1px solid #e4e7ee;box-shadow:0 12px 28px #101b3310}button{background:#183b68;color:white;border:0;border-radius:10px;padding:13px 20px;font-weight:700;cursor:pointer}select{padding:12px;border-radius:8px;width:100%;margin:12px 0 22px}p{line-height:1.8}small{color:#637188}</style></head><body><main>'+content+'</main></body></html>',{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'","X-Frame-Options":"DENY",...headers}});}
async function authorize(request,env,delegate){
 const url=new URL(request.url),method=request.method.toUpperCase(),form=method==='POST'?await request.formData():null;
 const query=method==='POST'?new URLSearchParams([...form.entries()].filter(([k])=>k!=='csrf'&&k!=='store_id')):url.searchParams;
 const values=oauthParams(query),me=await meFromDelegate(request,delegate);
 if(!me)return html('<h2>سجّل دخولك إلى كن أونلاين أولًا</h2><p>افتح حسابك على كن أونلاين في المتصفح نفسه ثم ارجع إلى ChatGPT وأعد محاولة الربط.</p><a href="/v2/">الدخول إلى كن أونلاين</a>',401);
 const access=await listMyStores(env,me,me.clientId),stores=(access.stores||[]).filter(s=>s.status==='active'||!s.status);
 if(!stores.length)die('لا توجد متاجر متاحة للتفويض',403,'MCP_NO_STORE_ACCESS');
 if(method==='GET'){
  const csrf=random(),fields=['response_type','client_id','redirect_uri','resource','code_challenge','code_challenge_method','state','scope']
   .map(k=>'<input type="hidden" name="'+k+'" value="'+encode(query.get(k)||((k==='scope')?SCOPE:''))+'">').join('');
  return html('<h2>السماح لـ ChatGPT بقراءة تقارير متجر</h2><p>هيقدر يقرأ إجماليات الطلبات والمبيعات والإعلانات والمنتجات. <b>لن يتمكن من عرض أسماء العملاء أو هواتفهم أو تعديل الطلبات.</b></p><form method="POST" action="/oauth/authorize">'+fields+'<input type="hidden" name="csrf" value="'+csrf+'"><label for="store">المتجر المصرح له</label><select id="store" name="store_id" required>'+stores.map(s=>'<option value="'+encode(s.id)+'">'+encode(s.name)+'</option>').join('')+'</select><button type="submit">موافقة وربط المتجر</button></form><p><small>صلاحية القراءة فقط. يمكنك فصل الربط في مركز التكاملات في أي وقت.</small></p>',200,{'Set-Cookie':'__Host-kun_mcp_csrf='+csrf+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600'});
 }
 if(method!=='POST')die('الطريقة غير مدعومة',405);
 const origin=request.headers.get('Origin');
 if(origin&&origin!==KUN_MCP_ORIGIN)die('طلب تفويض غير معتمد',403,'MCP_CSRF_ORIGIN');
 const cookies=request.headers.get('Cookie')||'',cookie=cookies.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-kun_mcp_csrf='));
 if(!cookie||cookie.slice('__Host-kun_mcp_csrf='.length)!==form.get('csrf'))die('انتهت صلاحية نموذج الموافقة، أعد المحاولة',403,'MCP_CSRF_FAILED');
 const selected=String(form.get('store_id')||'');
 if(!stores.some(s=>String(s.id)===selected))die('متجر غير مسموح',403,'MCP_STORE_DENIED');
 const userId=String(me.uid||me.id||'');
 if(!userId)die('الحساب لا يحتوي على هوية مستخدم قابلة للتحقق',403,'MCP_USER_ID_MISSING');
 await ensureKunMcpSchema(env);
 const code=random(),codeHash=await sha256(code),now=stamp();
 await env.DB.prepare('INSERT INTO kun_mcp_codes (code_hash,client_id,store_id,user_id,oauth_client_id,redirect_uri,resource,challenge,scope,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .bind(codeHash,me.clientId,selected,userId,values.client_id,values.redirect_uri,values.resource,values.challenge,values.scope,now+300,now).run();
 const back=new URL(values.redirect_uri);back.searchParams.set('code',code);
 if(values.state)back.searchParams.set('state',values.state);
 back.searchParams.set('iss',KUN_MCP_ORIGIN);
 return new Response(null,{status:302,headers:{Location:back.toString(),'Cache-Control':'no-store','Set-Cookie':'__Host-kun_mcp_csrf=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}});
}
async function issue(env,row){
 const access=random(),refresh=random(),now=stamp(),accessHash=await sha256(access),refreshHash=await sha256(refresh);
 const args=[row.client_id,row.store_id,row.user_id,row.oauth_client_id,row.resource,row.scope];
 await env.DB.batch([
  env.DB.prepare('INSERT INTO kun_mcp_access (token_hash,client_id,store_id,user_id,oauth_client_id,resource,scope,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(accessHash,...args,now+3600,now),
  env.DB.prepare('INSERT INTO kun_mcp_refresh (token_hash,client_id,store_id,user_id,oauth_client_id,resource,scope,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(refreshHash,...args,now+2592000,now)
 ]);
 return j({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:SCOPE});
}
async function token(request,env){
 if(request.method!=='POST')return j({error:'invalid_request'},405);
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type')||''))return j({error:'invalid_request'},400);
 const q=new URLSearchParams(await request.text()),clientId=q.get('client_id')||'',resource=q.get('resource')||'';
 if(resource!==KUN_MCP_RESOURCE||!/chatgpt\.com\/oauth\//.test(clientId))return j({error:'invalid_client'},401);
 await ensureKunMcpSchema(env);
 const now=stamp();
 if(q.get('grant_type')==='authorization_code'){
  const code=q.get('code')||'',verifier=q.get('code_verifier')||'',redirect=q.get('redirect_uri')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(code)||!/^[-A-Za-z0-9._~]{43,128}$/.test(verifier))return j({error:'invalid_grant'},400);
  const row=await env.DB.prepare('SELECT * FROM kun_mcp_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?').bind(await sha256(code),now).first();
  if(!row||row.oauth_client_id!==clientId||row.redirect_uri!==redirect||row.resource!==resource||row.challenge!==await sha256(verifier))return j({error:'invalid_grant'},400);
  const consumed=await env.DB.prepare('UPDATE kun_mcp_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?').bind(now,row.code_hash,now).run();
  if(Number(consumed?.meta?.changes||0)!==1)return j({error:'invalid_grant'},400);
  return issue(env,row);
 }
 if(q.get('grant_type')==='refresh_token'){
  const value=q.get('refresh_token')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(value))return j({error:'invalid_grant'},400);
  const hash=await sha256(value);
  const row=await env.DB.prepare('SELECT * FROM kun_mcp_refresh WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(hash,now).first();
  if(!row||row.oauth_client_id!==clientId||row.resource!==resource)return j({error:'invalid_grant'},400);
  const consumed=await env.DB.prepare('UPDATE kun_mcp_refresh SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(now,hash,now).run();
  if(Number(consumed?.meta?.changes||0)!==1)return j({error:'invalid_grant'},400);
  return issue(env,row);
 }
 return j({error:'unsupported_grant_type'},400);
}
export async function verifyKunMcpBearer(request,env){
 const auth=request.headers.get('Authorization')||'',match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth);
 if(!match)return null;
 await ensureKunMcpSchema(env);
 const row=await env.DB.prepare('SELECT * FROM kun_mcp_access WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND resource=? AND scope=?')
  .bind(await sha256(match[1]),stamp(),KUN_MCP_RESOURCE,SCOPE).first();
 if(!row)return null;
 // Each request rechecks tenant ownership and store activity; never accept
 // caller-supplied clientId or storeId in a tool payload.
 const store=await env.DB.prepare("SELECT id,name,status FROM stores WHERE id=? AND client_id=? AND status='active'").bind(row.store_id,row.client_id).first();
 if(!store)return null;
 const owner=await env.DB.prepare("SELECT id,status,role FROM users WHERE id=? AND client_id=?").bind(row.user_id,row.client_id).first();
 if(!owner||owner.role!=='client'||(owner.status&&owner.status!=='active'))return null;
 return {clientId:row.client_id,storeId:row.store_id,storeName:store.name,userId:row.user_id};
}
export const mcpChallenge=()=>j({error:'unauthorized',message:'اربط حساب كن أونلاين عبر ChatGPT أولًا'},401,{'WWW-Authenticate':'Bearer resource_metadata="'+KUN_MCP_ORIGIN+'/.well-known/oauth-protected-resource", scope="'+SCOPE+'"'});
async function integrationSettings(request,env,delegate){
 const me=await meFromDelegate(request,delegate);
 if(!me)return j({error:'محتاج تسجل دخول',code:'AUTH_REQUIRED'},401);
 if(request.method==='GET'){
  const {stores=[]}=await listMyStores(env,me,me.clientId);await ensureKunMcpSchema(env);
  const {results=[]}=await env.DB.prepare('SELECT store_id,COUNT(*) active_links FROM kun_mcp_refresh WHERE client_id=? AND user_id=? AND revoked_at IS NULL AND expires_at>? GROUP BY store_id').bind(me.clientId,String(me.uid||me.id||''),stamp()).all();
  return j({ok:true,endpoint:KUN_MCP_RESOURCE,chatgptConnectionAvailability:'workspace_or_published_plugin',stores:stores.map(s=>({id:s.id,name:s.name,linked:results.some(r=>r.store_id===s.id&&r.active_links>0)}))});
 }
 if(request.method==='POST'){
  const origin=request.headers.get('Origin');if(origin&&origin!==KUN_MCP_ORIGIN)return j({error:'مصدر الطلب غير معتمد'},403);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return j({error:'JSON مطلوب'},415);
  const body=await request.json().catch(()=>({})),storeId=String(body.storeId||''),{stores=[]}=await listMyStores(env,me,me.clientId);
  if(!stores.some(s=>String(s.id)===storeId))return j({error:'المتجر غير مصرح به'},403);
  await ensureKunMcpSchema(env);const now=stamp(),userId=String(me.uid||me.id||'');
  await env.DB.batch([
   env.DB.prepare('UPDATE kun_mcp_access SET revoked_at=? WHERE client_id=? AND store_id=? AND user_id=? AND revoked_at IS NULL').bind(now,me.clientId,storeId,userId),
   env.DB.prepare('UPDATE kun_mcp_refresh SET revoked_at=? WHERE client_id=? AND store_id=? AND user_id=? AND revoked_at IS NULL').bind(now,me.clientId,storeId,userId)
  ]);
  return j({ok:true,revoked:true});
 }
 return j({error:'method_not_allowed'},405);
}
export async function handleKunMcpOAuth({request,env,delegate}){
 const url=new URL(request.url),p=url.pathname;
 const handled=p==='/oauth/authorize'||p==='/oauth/token'||p==='/api/integrations/chatgpt'||p==='/.well-known/oauth-protected-resource'||p==='/.well-known/oauth-protected-resource/mcp'||p==='/.well-known/oauth-authorization-server';
 if(!handled)return null;
 try{
  if(p==='/.well-known/oauth-protected-resource'||p==='/.well-known/oauth-protected-resource/mcp')return j({resource:KUN_MCP_RESOURCE,authorization_servers:[KUN_MCP_ORIGIN],scopes_supported:[SCOPE],resource_documentation:KUN_MCP_ORIGIN+'/v2/'});
  if(p==='/.well-known/oauth-authorization-server')return j({issuer:KUN_MCP_ORIGIN,authorization_endpoint:KUN_MCP_ORIGIN+'/oauth/authorize',token_endpoint:KUN_MCP_ORIGIN+'/oauth/token',client_id_metadata_document_supported:true,authorization_response_iss_parameter_supported:true,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],scopes_supported:[SCOPE],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  if(p==='/oauth/authorize')return authorize(request,env,delegate);
  if(p==='/oauth/token')return token(request,env);
  return integrationSettings(request,env,delegate);
 }catch(error){return j({error:error?.message||'خطأ في ربط حساب ChatGPT',code:error?.code||'MCP_OAUTH_ERROR'},error?.status||500);}
}
