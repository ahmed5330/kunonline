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
let cookie='',stateSnapshot=null,walletSnapshot=null,hadWallet=false,createdOrderId=null;

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
async function restore(){
  const errors=[];
  for(const fn of [
    cleanupOrders,
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
  console.log(`Live Preview QA passed: missing-date Order creation, Store B/A isolation, status, note/contact and timeline (${createdOrderId}).`);
}catch(error){primaryError=error;
}finally{
  try{await restore()}catch(cleanupError){if(primaryError)primaryError=new Error(`${primaryError.message}; ${cleanupError.message}`);else primaryError=cleanupError;}
}
if(primaryError)throw primaryError;
