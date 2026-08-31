import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-team-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview team QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex');
const adminEmail=`qa-v28-team-admin-${nonce}@example.test`,adminId=`QA-V28-ADMIN-${nonce}`;
const ownerEmail=`qa-v28-owner-${nonce}@example.test`,memberEmail=`qa-v28-member-${nonce}@example.test`;
const adminPassword=`Admin!${randomBytes(10).toString('hex')}Aa1`,ownerPassword=`Owner!${randomBytes(10).toString('hex')}Bb2`,memberPassword=`Member!${randomBytes(10).toString('hex')}Cc3`,memberPassword2=`Reset!${randomBytes(10).toString('hex')}Dd4`;
let adminCookie='',ownerCookie='',memberCookie='',clientId=null,storeA=null,storeB=null,memberId=null,productId=null,stateSnapshot=null;

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});const p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,800)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function login(email,password,expected=[200]){const r=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const text=await r.text();if(!expected.includes(r.status))throw new Error(`Login ${email} expected ${expected.join('/')}, got ${r.status}: ${text.slice(0,400)}`);return {status:r.status,cookie:(r.headers.get('set-cookie')||'').split(';')[0],text};}
async function api(cookie,path,{method='GET',body,ok=[200]}={}){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${text.slice(0,600)}`);return {status:r.status,data};}
async function cleanupClient(){if(!clientId)return;for(const [sql,params] of [
  ['DELETE FROM order_management_fees WHERE client_id=?',[clientId]],['DELETE FROM order_notes WHERE client_id=?',[clientId]],['DELETE FROM order_events WHERE client_id=?',[clientId]],['DELETE FROM order_attribution WHERE client_id=?',[clientId]],['DELETE FROM order_billing WHERE client_id=?',[clientId]],['DELETE FROM whatsapp_outbox WHERE client_id=?',[clientId]],['DELETE FROM wallet_log WHERE client_id=?',[clientId]],['DELETE FROM wallet_topup_requests WHERE client_id=?',[clientId]],['DELETE FROM platform_client_notes WHERE client_id=?',[clientId]],['DELETE FROM stock_log WHERE client_id=?',[clientId]],['DELETE FROM product_variants WHERE client_id=?',[clientId]],['DELETE FROM products WHERE client_id=?',[clientId]],['DELETE FROM customers WHERE client_id=?',[clientId]],['DELETE FROM orders WHERE client_id=?',[clientId]],['DELETE FROM user_store_access WHERE client_id=?',[clientId]],['DELETE FROM store_connections WHERE client_id=?',[clientId]],['DELETE FROM tenant_modules WHERE client_id=?',[clientId]],['DELETE FROM subscriptions WHERE client_id=?',[clientId]],['DELETE FROM wallet_accounts WHERE client_id=?',[clientId]],['DELETE FROM audit_log WHERE client_id=?',[clientId]],['DELETE FROM users WHERE client_id=?',[clientId]],['DELETE FROM stores WHERE client_id=?',[clientId]],['DELETE FROM tenant_settings WHERE client_id=?',[clientId]]
]){try{await d1(sql,params)}catch{}}
 for(const e of [ownerEmail,memberEmail])try{await d1('DELETE FROM login_attempts WHERE email=?',[e])}catch{}
}
async function restore(){const errors=[];try{await cleanupClient()}catch(e){errors.push(e.message)}try{if(stateSnapshot)await d1('UPDATE state SET json=?,updated_at=? WHERE id=1',[stateSnapshot.json,stateSnapshot.updated_at])}catch(e){errors.push(e.message)}try{await d1('DELETE FROM login_attempts WHERE email=?',[adminEmail]);await d1('DELETE FROM users WHERE email=?',[adminEmail])}catch(e){errors.push(e.message)}if(errors.length)throw new Error(`Team live cleanup failed: ${errors.join(' | ')}`);}

let primaryError=null;
try{
  stateSnapshot=(await d1('SELECT json,updated_at FROM state WHERE id=1'))[0]||null;
  await d1('DELETE FROM login_attempts WHERE email=?',[adminEmail]);await d1('DELETE FROM users WHERE email=?',[adminEmail]);
  const hash=await hashPassword(adminPassword),ts=new Date().toISOString();
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminId,adminEmail,'CI v28 Team Admin',hash,'admin','active',ts]);
  adminCookie=(await login(adminEmail,adminPassword)).cookie;if(!adminCookie)throw new Error('Temporary admin cookie missing');
  const version=(await api(adminCookie,'/api/preview/version')).data;if(!String(version.build||'').startsWith('preview-v34-')||version.entrypoint!=='index-commerce-v34.js'||version.environment!=='preview')throw new Error(`Expected current v34 Preview, got ${JSON.stringify(version)}`);
  const onboard=(await api(adminCookie,'/api/admin/clients',{method:'POST',ok:[201],body:{businessName:'CI v28 Team Tenant',ownerName:'CI v28 Owner',email:ownerEmail,phone:'01012345678',password:ownerPassword,storeName:'CI Store A',plan:'trial',baseOrderFee:2,modules:{dashboard:{enabled:true},stores:{enabled:true},'store-access':{enabled:true},orders:{enabled:true},catalog:{enabled:true},inventory:{enabled:true},team:{enabled:true},settings:{enabled:true}}}})).data;
  clientId=onboard.clientId;storeA=onboard.storeId;if(!clientId||!storeA)throw new Error('Temporary tenant onboarding failed');
  ownerCookie=(await login(ownerEmail,ownerPassword)).cookie;if(!ownerCookie)throw new Error('Owner cookie missing');
  await api(ownerCookie,'/api/stores',{method:'POST',ok:[200,201],body:{name:'CI Store B'}});
  const second=(await d1('SELECT id FROM stores WHERE client_id=? AND id<>? ORDER BY created_at DESC LIMIT 1',[clientId,storeA]))[0];storeB=second?.id;if(!storeB)throw new Error('Second QA store was not created');
  const catalog=(await api(ownerCookie,'/api/team-role-catalog')).data;if(!catalog.businessRoles?.some(x=>x.id==='ops')||!catalog.storeRoles?.some(x=>x.id==='viewer'))throw new Error('Team role catalog incomplete');
  const created=(await api(ownerCookie,'/api/team-members',{method:'POST',ok:[201],body:{clientId,name:'CI Ops Member',email:memberEmail,password:memberPassword,role:'ops',storeAccess:[{storeId:storeA,role:'manager'}]}})).data;memberId=created.id;if(!memberId)throw new Error('Team member create returned no id');
  const onboarding=(await api(ownerCookie,'/api/onboarding/status')).data;if(!onboarding.checks?.find(x=>x.key==='team')?.done)throw new Error('Onboarding team step did not become complete');
  memberCookie=(await login(memberEmail,memberPassword)).cookie;if(!memberCookie)throw new Error('Member login cookie missing');
  const me=(await api(memberCookie,'/api/me')).data;if(me.role!=='ops'||me.clientId!==clientId)throw new Error(`Member session scope incorrect: ${JSON.stringify(me)}`);
  await api(memberCookie,`/api/products?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeA)}`,{ok:[200]});
  await api(memberCookie,`/api/products?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeB)}`,{ok:[403]});
  const product=(await api(memberCookie,'/api/products',{method:'POST',ok:[200,201],body:{clientId,storeId:storeA,name:'CI Team Product',sku:`TEAM-${nonce}`,price:100,cost:40,stock:5}})).data;productId=product.id||product.product?.id;
  await api(memberCookie,'/api/products',{method:'POST',ok:[403],body:{clientId,storeId:storeB,name:'Cross Store Denied',price:1}});
  await api(ownerCookie,`/api/team-members/${encodeURIComponent(memberId)}`,{method:'PATCH',body:{clientId,role:'viewer',status:'active'}});
  const viewerLogin=await login(memberEmail,memberPassword);memberCookie=viewerLogin.cookie;
  await api(memberCookie,`/api/products?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeA)}`,{ok:[200]});
  await api(memberCookie,'/api/products',{method:'POST',ok:[403],body:{clientId,storeId:storeA,name:'Viewer Write Denied',price:1}});
  await api(ownerCookie,`/api/team-members/${encodeURIComponent(memberId)}/store-access`,{method:'PUT',body:{clientId,storeAccess:[{storeId:storeB,role:'viewer'}]}});
  memberCookie=(await login(memberEmail,memberPassword)).cookie;
  await api(memberCookie,`/api/products?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeA)}`,{ok:[403]});
  await api(memberCookie,`/api/products?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeB)}`,{ok:[200]});
  await api(ownerCookie,`/api/team-members/${encodeURIComponent(memberId)}/reset-password`,{method:'POST',body:{clientId,password:memberPassword2}});
  const newLogin=await login(memberEmail,memberPassword2);if(!newLogin.cookie)throw new Error('Reset team password did not permit login');
  await api(ownerCookie,`/api/team-members/${encodeURIComponent(memberId)}`,{method:'PATCH',body:{clientId,status:'disabled'}});
  await login(memberEmail,memberPassword2,[401,403]);
  await api(ownerCookie,`/api/team-members/${encodeURIComponent(memberId)}`,{method:'PATCH',body:{clientId,status:'active'}});
  if(!(await login(memberEmail,memberPassword2)).cookie)throw new Error('Re-enabled member cannot login');
  await api(ownerCookie,`/api/team-members/${encodeURIComponent(memberId)}`,{method:'DELETE',body:{clientId}});memberId=null;
  await login(memberEmail,memberPassword2,[401,403]);
  const count=(await d1('SELECT COUNT(*) n FROM user_store_access WHERE client_id=? AND user_id IN (SELECT id FROM users WHERE email=?)',[clientId,memberEmail]))[0]?.n||0;if(Number(count)!==0)throw new Error('Deleted member store access was not cleaned');
  console.log(`Live v28 team QA passed on Preview v34: create/login/role change/store A-B isolation/viewer read-only/password reset/disable-enable/delete (${clientId}).`);
}catch(error){primaryError=error;
}finally{try{await restore()}catch(cleanupError){primaryError=primaryError?new Error(`${primaryError.message}; ${cleanupError.message}`):cleanupError;}}
if(primaryError)throw primaryError;
