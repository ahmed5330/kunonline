import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-functional-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview live QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const clientId='PREVIEW-STORE-001',storeA='STR-CD14EDC5',storeB='STR-EEA6FD86';
const email='qa-ci-v27-live@example.test',userId='QA-CI-V27-LIVE',source='ci_live_qa_v27',phone='00000000000',name='CI v27 Live QA';
const createdAt=new Date().toISOString();
const password=`Live!${randomBytes(18).toString('hex')}Aa1`;
let cookie='',stateSnapshot=null,walletSnapshot=null,hadWallet=false,createdOrderId=null,createdClientId=null,createdClientStoreId=null;
const onboardingEmail=`qa-ci-v27-onboard-${randomBytes(5).toString('hex')}@example.test`;
const onboardingPassword=`Onboard!${randomBytes(12).toString('hex')}Aa1`;
const onboardingPassword2=`Reset!${randomBytes(12).toString('hex')}Bb2`;

async function d1(sql,params=[]){
  const response=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({}));
  const result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Preview D1 query failed (${response.status}): ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,800)}`);
  return result?.results||[];
}
async function hashPassword(value){
  const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}
async function api(path,{method='GET',body,ok=[200]}={}){
  const headers={'Content-Type':'application/json'};if(cookie)headers.Cookie=cookie;
  const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'follow'});
  const text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}}
  if(!ok.includes(response.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${response.status}: ${text.slice(0,600)}`);
  return {response,data};
}
async function cleanupOrders(){
  const rows=await d1('SELECT id FROM orders WHERE client_id=? AND store_id=? AND source=? AND name=?',[clientId,storeB,source,name]);
  for(const row of rows){
    const id=row.id;
    await d1('DELETE FROM order_notes WHERE order_id=?',[id]);
    await d1('DELETE FROM order_events WHERE order_id=?',[id]);
    await d1('DELETE FROM order_attribution WHERE order_id=?',[id]);
    await d1('DELETE FROM order_billing WHERE order_id=?',[id]);
    await d1('DELETE FROM whatsapp_outbox WHERE order_id=?',[id]);
    await d1('DELETE FROM wallet_log WHERE order_id=?',[id]);
    await d1('DELETE FROM audit_log WHERE entity_id=?',[id]);
    await d1('DELETE FROM orders WHERE id=?',[id]);
  }
}

async function cleanupCreatedClient(){
  if(!createdClientId)return;
  const cid=createdClientId;
  for(const [sql,params] of [
    ['DELETE FROM order_notes WHERE client_id=?',[cid]],['DELETE FROM order_events WHERE client_id=?',[cid]],['DELETE FROM order_attribution WHERE client_id=?',[cid]],['DELETE FROM order_billing WHERE client_id=?',[cid]],['DELETE FROM whatsapp_outbox WHERE client_id=?',[cid]],['DELETE FROM wallet_log WHERE client_id=?',[cid]],['DELETE FROM wallet_topup_requests WHERE client_id=?',[cid]],['DELETE FROM platform_client_notes WHERE client_id=?',[cid]],['DELETE FROM customers WHERE client_id=?',[cid]],['DELETE FROM products WHERE client_id=?',[cid]],['DELETE FROM orders WHERE client_id=?',[cid]],['DELETE FROM user_store_access WHERE client_id=?',[cid]],['DELETE FROM store_connections WHERE client_id=?',[cid]],['DELETE FROM tenant_modules WHERE client_id=?',[cid]],['DELETE FROM subscriptions WHERE client_id=?',[cid]],['DELETE FROM wallet_accounts WHERE client_id=?',[cid]],['DELETE FROM audit_log WHERE client_id=?',[cid]],['DELETE FROM users WHERE client_id=?',[cid]],['DELETE FROM stores WHERE client_id=?',[cid]],['DELETE FROM tenant_settings WHERE client_id=?',[cid]]
  ])await d1(sql,params);
  await d1('DELETE FROM login_attempts WHERE email=?',[onboardingEmail]);
}

async function restore(){
  const errors=[];
  for(const fn of [
    cleanupOrders,
    cleanupCreatedClient,
    async()=>{if(stateSnapshot)await d1('UPDATE state SET json=?,updated_at=? WHERE id=1',[stateSnapshot.json,stateSnapshot.updated_at]);},
    async()=>{if(hadWallet&&walletSnapshot)await d1('UPDATE wallet_accounts SET balance=?,status=?,updated_at=? WHERE client_id=?',[walletSnapshot.balance,walletSnapshot.status,walletSnapshot.updated_at,clientId]);else if(!hadWallet)await d1('DELETE FROM wallet_accounts WHERE client_id=?',[clientId]);},
    async()=>{await d1('DELETE FROM login_attempts WHERE email=?',[email]);await d1('DELETE FROM users WHERE email=?',[email]);}
  ]){try{await fn()}catch(error){errors.push(String(error?.message||error));}}
  if(errors.length)throw new Error(`Preview live QA cleanup failed: ${errors.join(' | ')}`);
}

let primaryError=null;
try{
  await cleanupOrders();
  await d1('DELETE FROM login_attempts WHERE email=?',[email]);await d1('DELETE FROM users WHERE email=?',[email]);
  const stores=await d1('SELECT id FROM stores WHERE client_id=? AND id IN (?,?) ORDER BY id',[clientId,storeA,storeB]);
  if(stores.length!==2)throw new Error(`Expected Store A/B in Preview; found ${stores.map(x=>x.id).join(',')}`);
  stateSnapshot=(await d1('SELECT json,updated_at FROM state WHERE id=1'))[0]||null;
  if(!stateSnapshot?.json)throw new Error('Preview state row missing');
  const state=JSON.parse(stateSnapshot.json),client=(state.clients||[]).find(x=>String(x.id)===clientId);
  if(!client)throw new Error('PREVIEW-STORE-001 missing from legacy state');
  client.walletFeePerOrder=0;
  await d1('UPDATE state SET json=?,updated_at=? WHERE id=1',[JSON.stringify(state),new Date().toISOString()]);
  walletSnapshot=(await d1('SELECT balance,status,updated_at FROM wallet_accounts WHERE client_id=?',[clientId]))[0]||null;hadWallet=!!walletSnapshot;
  if(hadWallet)await d1("UPDATE wallet_accounts SET status='paused',updated_at=? WHERE client_id=?",[new Date().toISOString(),clientId]);
  const hash=await hashPassword(password);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'CI Preview QA',hash,'admin','active',createdAt]);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const loginText=await login.text();if(!login.ok)throw new Error(`Preview login failed ${login.status}: ${loginText.slice(0,500)}`);
  cookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Preview login did not return session cookie');
  const create=await api('/api/orders',{method:'POST',ok:[200,201],body:{clientId,storeId:storeB,name,phone,address:'Preview live QA',product:'QA Regression',total:0,qty:1,state:'pending',source}});
  createdOrderId=create.data?.order?.id||create.data?.id;if(!createdOrderId)throw new Error(`Order create returned no id: ${JSON.stringify(create.data)}`);
  const orderDate=create.data?.order?.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(String(orderDate||'')))throw new Error(`Missing-date regression failed: normalized date=${orderDate}`);
  const bState=(await api(`/api/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeB)}`)).data;
  if(!(bState.orders||[]).some(x=>String(x.id)===String(createdOrderId)))throw new Error('Store B order is missing from Store B state');
  const aState=(await api(`/api/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeA)}`)).data;
  if((aState.orders||[]).some(x=>String(x.id)===String(createdOrderId)))throw new Error('Store isolation failed: Store B order leaked into Store A');
  await api(`/api/orders/${encodeURIComponent(createdOrderId)}/notes`,{method:'POST',ok:[201],body:{clientId,storeId:storeB,body:'CI live note'}});
  await api(`/api/orders/${encodeURIComponent(createdOrderId)}/contact`,{method:'POST',ok:[201],body:{clientId,storeId:storeB,channel:'phone'}});
  await api(`/api/orders/${encodeURIComponent(createdOrderId)}`,{method:'PATCH',ok:[200],body:{clientId,storeId:storeB,state:'confirmed'}});
  let timeline=null;
  for(let i=0;i<8;i++){
    timeline=(await api(`/api/orders/${encodeURIComponent(createdOrderId)}/timeline?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeB)}`)).data;
    const types=(timeline.events||[]).map(x=>x.type);
    if(types.includes('note_added')&&types.includes('contact_phone')&&types.includes('status_changed'))break;
    await new Promise(r=>setTimeout(r,500));
  }
  const types=(timeline?.events||[]).map(x=>x.type);
  for(const expected of ['note_added','contact_phone','status_changed'])if(!types.includes(expected))throw new Error(`Order timeline missing ${expected}; got ${types.join(',')}`);
  if(timeline?.order?.state!=='confirmed')throw new Error(`Order status did not persist; got ${timeline?.order?.state}`);


  // Full SaaS onboarding: Tenant + owner + store + wallet + modules, then real owner login.
  const onboard=await api('/api/admin/clients',{method:'POST',ok:[201],body:{businessName:'CI Onboarding Store',ownerName:'CI Owner',email:onboardingEmail,phone:'01012345678',password:onboardingPassword,storeName:'CI Main Store',plan:'trial',baseOrderFee:2.5,modules:{orders:{enabled:true},crm:{enabled:true},catalog:{enabled:true},inventory:{enabled:true},wallet:{enabled:true},finance:{enabled:false}}}});
  createdClientId=onboard.data?.clientId;createdClientStoreId=onboard.data?.storeId;
  if(!createdClientId||!createdClientStoreId)throw new Error(`Admin onboarding returned incomplete ids: ${JSON.stringify(onboard.data)}`);
  const listed=(await api('/api/admin/clients')).data;if(!Array.isArray(listed)||!listed.some(x=>x.clientId===createdClientId&&x.ownerEmail===onboardingEmail))throw new Error('New SaaS client is missing from Kun Admin list');
  const tenant=(await d1('SELECT display_name,status,plan FROM tenant_settings WHERE client_id=?',[createdClientId]))[0];if(tenant?.display_name!=='CI Onboarding Store'||tenant?.status!=='active')throw new Error('Tenant settings were not created correctly');
  const wallet=(await d1('SELECT billing_version,base_order_fee,status FROM wallet_accounts WHERE client_id=?',[createdClientId]))[0];if(wallet?.billing_version!=='v27'||Number(wallet?.base_order_fee)!==2.5)throw new Error('Onboarded wallet/billing is incorrect');
  const ownerLogin=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:onboardingEmail,password:onboardingPassword})});
  const ownerLoginText=await ownerLogin.text();if(!ownerLogin.ok)throw new Error(`Onboarded owner login failed ${ownerLogin.status}: ${ownerLoginText.slice(0,400)}`);
  const ownerCookie=(ownerLogin.headers.get('set-cookie')||'').split(';')[0];if(!ownerCookie)throw new Error('Onboarded owner login returned no cookie');
  async function ownerApi(path,{method='GET',body,ok=[200]}={}){const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',Cookie:ownerCookie},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}}if(!ok.includes(response.status))throw new Error(`Owner ${method} ${path} expected ${ok.join('/')}, got ${response.status}: ${text.slice(0,500)}`);return data;}
  const me=await ownerApi('/api/me');if(me.role!=='client'||me.clientId!==createdClientId)throw new Error(`Owner session is not tenant-scoped: ${JSON.stringify(me)}`);
  const features=await ownerApi(`/api/tenant/features?clientId=${encodeURIComponent(createdClientId)}`);if(features.modules?.finance?.enabled!==false||features.modules?.orders?.enabled!==true)throw new Error('Onboarded module entitlements are incorrect');
  const ownerState=await ownerApi(`/api/state?clientId=${encodeURIComponent(createdClientId)}&storeId=${encodeURIComponent(createdClientStoreId)}`);if(!(ownerState.clients||[]).some(x=>String(x.id)===createdClientId))throw new Error('Onboarded client is missing from tenant state');
  const standalone=await ownerApi('/api/customers',{method:'POST',ok:[201],body:{clientId:createdClientId,storeId:createdClientStoreId,name:'CI CRM Customer',phone:'01098765432',gov:'القاهرة',note:'Created from v27 action'}});if(!standalone.id)throw new Error('Standalone CRM customer action failed');
  const customerList=await ownerApi(`/api/customers?clientId=${encodeURIComponent(createdClientId)}`);if(!Array.isArray(customerList)||!customerList.some(x=>x.id===standalone.id))throw new Error('Standalone CRM customer is not readable after creation');
  await api(`/api/admin/clients/${encodeURIComponent(createdClientId)}/notes`,{method:'POST',ok:[201],body:{body:'CI admin note'}});
  await api('/api/wallet/topup',{method:'POST',body:{clientId:createdClientId,amount:10,note:'CI admin credit'}});const credited=(await d1('SELECT balance FROM wallet_accounts WHERE client_id=?',[createdClientId]))[0];if(Number(credited?.balance)!==10)throw new Error('Admin direct wallet credit button/API failed');
  await api(`/api/admin/clients/${encodeURIComponent(createdClientId)}/reset-owner-password`,{method:'POST',body:{password:onboardingPassword2}});
  const resetLogin=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:onboardingEmail,password:onboardingPassword2})});if(!resetLogin.ok)throw new Error(`Owner password reset login failed: ${resetLogin.status}`);
  await api(`/api/admin/clients/${encodeURIComponent(createdClientId)}/status`,{method:'PATCH',body:{status:'suspended'}});const suspended=(await d1('SELECT status FROM users WHERE client_id=? AND role=?',[createdClientId,'client']))[0];if(suspended?.status!=='tenant_suspended')throw new Error('Suspend client action did not suspend owner');
  await api(`/api/admin/clients/${encodeURIComponent(createdClientId)}/status`,{method:'PATCH',body:{status:'active'}});const active=(await d1('SELECT status FROM users WHERE client_id=? AND role=?',[createdClientId,'client']))[0];if(active?.status!=='active')throw new Error('Reactivate client action failed');

  console.log(`Live Preview QA passed: Store B regression + full client onboarding/lifecycle + CRM/wallet/admin actions (${createdOrderId}, ${createdClientId}).`);
}catch(error){primaryError=error;
}finally{
  try{await restore()}catch(cleanupError){if(primaryError)primaryError=new Error(`${primaryError.message}; ${cleanupError.message}`);else primaryError=cleanupError;}
}
if(primaryError)throw primaryError;
