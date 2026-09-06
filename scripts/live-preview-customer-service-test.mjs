import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(base!=='https://kunonline-preview.mr-a-mnaa.workers.dev')throw new Error('Customer Service QA is restricted to the Kun Online Preview');
if(!base)throw new Error('Usage: node scripts/live-preview-customer-service-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Customer Service QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex');
const adminEmail=`qa-cs-admin-${nonce}@example.test`,ownerEmail=`qa-cs-owner-${nonce}@example.test`,supportEmail=`qa-cs-support-${nonce}@example.test`;
const adminId=`QA-CS-ADMIN-${nonce}`;
const adminPassword=`Admin!${randomBytes(9).toString('hex')}Aa1`,ownerPassword=`Owner!${randomBytes(9).toString('hex')}Bb2`,supportPassword=`Support!${randomBytes(9).toString('hex')}Cc3`;
let clientId=null,storeA=null,storeB=null,storeC=null,supportId=null,orderA=null,orderB=null,orderC=null,orderDelete=null,stateSnapshot=null;

async function d1(sql,params=[]){
  const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const p=await r.json().catch(()=>({})),x=p?.result?.[0];
  if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,800)}`);
  return x?.results||[];
}
async function hashPassword(value){
  const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}
async function login(email,password,expected=[200]){
  const r=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const text=await r.text();
  if(!expected.includes(r.status))throw new Error(`Login ${email} expected ${expected.join('/')}, got ${r.status}: ${text.slice(0,500)}`);
  return {cookie:(r.headers.get('set-cookie')||'').split(';')[0],status:r.status,text};
}
async function api(cookie,path,{method='GET',body,ok=[200]}={}){
  const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${text.slice(0,800)}`);
  return {status:r.status,data};
}
async function cleanupClient(){
  if(!clientId)return;
  for(const [sql,params] of [
    ['DELETE FROM order_notes WHERE client_id=?',[clientId]],
    ['DELETE FROM order_events WHERE client_id=?',[clientId]],
    ['DELETE FROM order_attribution WHERE client_id=?',[clientId]],
    ['DELETE FROM order_billing WHERE client_id=?',[clientId]],
    ['DELETE FROM whatsapp_outbox WHERE client_id=?',[clientId]],
    ['DELETE FROM wallet_log WHERE client_id=?',[clientId]],
    ['DELETE FROM wallet_topup_requests WHERE client_id=?',[clientId]],
    ['DELETE FROM platform_client_notes WHERE client_id=?',[clientId]],
    ['DELETE FROM stock_log WHERE client_id=?',[clientId]],
    ['DELETE FROM product_variants WHERE client_id=?',[clientId]],
    ['DELETE FROM products WHERE client_id=?',[clientId]],
    ['DELETE FROM customers WHERE client_id=?',[clientId]],
    ['DELETE FROM orders WHERE client_id=?',[clientId]],
    ['DELETE FROM user_store_access WHERE client_id=?',[clientId]],
    ['DELETE FROM store_connections WHERE client_id=?',[clientId]],
    ['DELETE FROM tenant_modules WHERE client_id=?',[clientId]],
    ['DELETE FROM subscriptions WHERE client_id=?',[clientId]],
    ['DELETE FROM wallet_accounts WHERE client_id=?',[clientId]],
    ['DELETE FROM audit_log WHERE client_id=?',[clientId]],
    ['DELETE FROM users WHERE client_id=?',[clientId]],
    ['DELETE FROM stores WHERE client_id=?',[clientId]],
    ['DELETE FROM tenant_settings WHERE client_id=?',[clientId]]
  ]){try{await d1(sql,params)}catch{}}
  for(const email of [ownerEmail,supportEmail])try{await d1('DELETE FROM login_attempts WHERE email=?',[email])}catch{}
}
async function restore(){
  const errors=[];
  try{await cleanupClient()}catch(e){errors.push(e.message)}
  try{if(stateSnapshot)await d1('UPDATE state SET json=?,updated_at=? WHERE id=1',[stateSnapshot.json,stateSnapshot.updated_at])}catch(e){errors.push(e.message)}
  try{await d1('DELETE FROM login_attempts WHERE email=?',[adminEmail]);await d1('DELETE FROM users WHERE email=?',[adminEmail])}catch(e){errors.push(e.message)}
  if(errors.length)throw new Error(`Customer Service live cleanup failed: ${errors.join(' | ')}`);
}
function orderIdOf(d){return d?.id||d?.order?.id||d?.orderId||null;}
const qs=(client,store)=>`clientId=${encodeURIComponent(client)}${store?`&storeId=${encodeURIComponent(store)}`:''}`;
function cairoDate(offsetDays=0){
  const date=new Date(Date.now()+(Number(offsetDays)||0)*86400000),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=type=>parts.find(part=>part.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const today=cairoDate(),tomorrow=cairoDate(2);
let primaryError=null;

try{
  stateSnapshot=(await d1('SELECT json,updated_at FROM state WHERE id=1'))[0]||null;
  await d1('DELETE FROM login_attempts WHERE email=?',[adminEmail]);
  await d1('DELETE FROM users WHERE email=?',[adminEmail]);
  const ts=new Date().toISOString(),hash=await hashPassword(adminPassword);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminId,adminEmail,'CI Customer Service Admin',hash,'admin','active',ts]);
  const adminCookie=(await login(adminEmail,adminPassword)).cookie;
  if(!adminCookie)throw new Error('Temporary Customer Service admin cookie missing');

  const onboard=(await api(adminCookie,'/api/admin/clients',{method:'POST',ok:[201],body:{
    businessName:'CI Customer Service Tenant',ownerName:'CI CS Owner',email:ownerEmail,phone:'01012345678',password:ownerPassword,storeName:'CI CS Store A',plan:'trial',baseOrderFee:0,
    modules:{dashboard:{enabled:true},stores:{enabled:true},'store-access':{enabled:true},orders:{enabled:true},customers:{enabled:true},team:{enabled:true},settings:{enabled:true}}
  }})).data;
  clientId=onboard.clientId;storeA=onboard.storeId;
  if(!clientId||!storeA)throw new Error('Customer Service tenant onboarding failed');

  const ownerCookie=(await login(ownerEmail,ownerPassword)).cookie;
  if(!ownerCookie)throw new Error('Customer Service owner login failed');
  await api(ownerCookie,'/api/stores',{method:'POST',ok:[200,201],body:{name:'CI CS Store B'}});
  await api(ownerCookie,'/api/stores',{method:'POST',ok:[200,201],body:{name:'CI CS Store C'}});
  const stores=await d1('SELECT id,name FROM stores WHERE client_id=? ORDER BY created_at,id',[clientId]);
  storeB=stores.find(x=>x.name==='CI CS Store B')?.id;storeC=stores.find(x=>x.name==='CI CS Store C')?.id;
  if(!storeB||!storeC)throw new Error('Customer Service secondary stores missing');

  const member=(await api(ownerCookie,'/api/team-members',{method:'POST',ok:[201],body:{clientId,name:'CI Customer Service Agent',email:supportEmail,password:supportPassword,role:'support',storeAccess:[{storeId:storeA,role:'member'},{storeId:storeB,role:'member'}]}})).data;
  supportId=member.id;
  if(!supportId)throw new Error('Customer Service support member creation failed');

  const makeOrder=async(storeId,name,product)=>orderIdOf((await api(ownerCookie,'/api/orders',{method:'POST',ok:[200,201],body:{clientId,storeId,name,phone:'01000000001',gov:'القاهرة',address:'عنوان QA',product,qty:1,total:650,source:'manual',date:today,state:'pending',note:'ملاحظة العميل الأصلية'}})).data);
  orderA=await makeOrder(storeA,'عميل خدمة A','QA Product A');
  orderB=await makeOrder(storeB,'عميل خدمة B','QA Product B');
  orderC=await makeOrder(storeC,'عميل مخفي C','QA Product C');
  if(!orderA||!orderB||!orderC)throw new Error('Customer Service QA orders were not created');

  // Modern tenant owner bridge: pending -> confirmed must work even if the legacy flag was absent at onboarding.
  await api(ownerCookie,`/api/customer-service/orders/${encodeURIComponent(orderC)}/state?${qs(clientId,storeC)}`,{method:'PATCH',body:{clientId,storeId:storeC,state:'confirmed'}});
  const ownerMoved=(await d1('SELECT state FROM orders WHERE id=? AND client_id=?',[orderC,clientId]))[0];
  if(ownerMoved?.state!=='confirmed')throw new Error(`Tenant owner pending->confirmed bridge failed: ${JSON.stringify(ownerMoved)}`);
  const legacyAfterBridge=(await d1('SELECT json FROM state WHERE id=1'))[0];let legacyClient=null;
  try{legacyClient=JSON.parse(legacyAfterBridge?.json||'{}')?.clients?.find(x=>String(x.id)===String(clientId))}catch{}
  if(legacyClient?.customerServiceEnabled!==true)throw new Error('Modern tenant owner did not repair the legacy customerServiceEnabled bridge');

  // Deletion remains owner-governed and unavailable to support agents.
  orderDelete=await makeOrder(storeA,'عميل حذف QA','QA Delete Product');
  if(!orderDelete)throw new Error('Order delete QA order was not created');
  await api(ownerCookie,`/api/customer-service/orders/${encodeURIComponent(orderDelete)}/delete?${qs(clientId,storeA)}`,{method:'DELETE',body:{clientId,storeId:storeA}});
  if((await d1('SELECT id FROM orders WHERE id=? AND client_id=?',[orderDelete,clientId])).length)throw new Error('Tenant owner order delete did not remove the order');

  const supportCookie=(await login(supportEmail,supportPassword)).cookie;
  if(!supportCookie)throw new Error('Customer Service agent login failed');
  const me=(await api(supportCookie,'/api/me')).data;
  if(me.role!=='support'||String(me.clientId)!==String(clientId))throw new Error(`Support session incorrect: ${JSON.stringify(me)}`);

  // Multi-store agents may work from one combined board, but only for stores explicitly assigned to them.
  const combined=(await api(supportCookie,`/api/customer-service?${qs(clientId,null)}`)).data;
  if(combined.selectedStoreId!==null)throw new Error(`Combined board unexpectedly selected one store: ${JSON.stringify(combined.selectedStoreId)}`);
  if(combined.stores?.length!==2||!combined.stores.some(x=>String(x.id)===String(storeA))||!combined.stores.some(x=>String(x.id)===String(storeB)))throw new Error(`Combined board assignments missing: ${JSON.stringify(combined.stores)}`);
  const combinedIds=new Set((combined.orders||[]).map(x=>String(x.id)));
  if(!combinedIds.has(String(orderA))||!combinedIds.has(String(orderB))||combinedIds.has(String(orderC)))throw new Error(`Combined assigned-store isolation failed: ${JSON.stringify([...combinedIds])}`);

  let boardA=(await api(supportCookie,`/api/customer-service?${qs(clientId,storeA)}`)).data;
  if(boardA.selectedStoreId!==storeA)throw new Error(`Store A was not selected: ${JSON.stringify(boardA.selectedStoreId)}`);
  if(boardA.stores?.length!==2||!boardA.stores.some(x=>String(x.id)===String(storeA))||!boardA.stores.some(x=>String(x.id)===String(storeB)))throw new Error(`Support multi-store assignments missing: ${JSON.stringify(boardA.stores)}`);
  const idsA=new Set((boardA.orders||[]).map(x=>String(x.id)));
  if(!idsA.has(String(orderA))||idsA.has(String(orderB))||idsA.has(String(orderC)))throw new Error(`Store A board isolation failed: ${JSON.stringify([...idsA])}`);
  if(!boardA.stages?.map(x=>x.id).join(',').includes('pending,confirmed,preparing,shipped'))throw new Error('Customer Service four-stage board missing');

  let boardB=(await api(supportCookie,`/api/customer-service?${qs(clientId,storeB)}`)).data;
  if(boardB.selectedStoreId!==storeB)throw new Error(`Store B was not selected: ${JSON.stringify(boardB.selectedStoreId)}`);
  const idsB=new Set((boardB.orders||[]).map(x=>String(x.id)));
  if(!idsB.has(String(orderB))||idsB.has(String(orderA))||idsB.has(String(orderC)))throw new Error(`Store B board isolation failed: ${JSON.stringify([...idsB])}`);

  await api(supportCookie,`/api/customer-service?${qs(clientId,storeC)}`,{ok:[403]});
  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/delete?${qs(clientId,storeA)}`,{method:'DELETE',body:{clientId,storeId:storeA},ok:[403]});
  if(!(await d1('SELECT id FROM orders WHERE id=? AND client_id=?',[orderA,clientId])).length)throw new Error('Customer Service agent unexpectedly deleted an order');

  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/contact?${qs(clientId,storeA)}`,{method:'POST',body:{clientId,storeId:storeA}});
  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/notes?${qs(clientId,storeA)}`,{method:'POST',ok:[201],body:{clientId,storeId:storeA,note:'ملاحظة داخلية QA'}});
  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/contact?${qs(clientId,storeA)}`,{method:'POST',body:{clientId,storeId:storeA,channel:'phone',intent:'call'}});
  const interactionEvents=await d1('SELECT event_type,actor_user_id,created_at,metadata_json FROM order_events WHERE client_id=? AND order_id=? AND source=?',[clientId,orderA,'customer-service']);
  if(interactionEvents.filter(e=>e.event_type==='contact_phone').length!==2||interactionEvents.filter(e=>e.event_type==='note_added').length!==1)throw new Error('Canonical contact/call/note events missing or duplicated');
  if(interactionEvents.some(e=>e.actor_user_id!==supportId||!e.created_at))throw new Error('Interaction actor or timestamp missing');
  if(interactionEvents.filter(e=>JSON.parse(e.metadata_json).intent==='call').length!==1)throw new Error('Call intent was not saved exactly once');
  const canonicalNotes=await d1('SELECT body FROM order_notes WHERE client_id=? AND order_id=?',[clientId,orderA]);
  if(!canonicalNotes.some(n=>n.body==='ملاحظة داخلية QA'))throw new Error('Internal note missing from order_notes');

  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/awb?${qs(clientId,storeA)}`,{method:'PATCH',body:{clientId,storeId:storeA,awb:'QA-AWB-123'}});
  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/whatsapp-log?${qs(clientId,storeA)}`,{method:'POST',body:{clientId,storeId:storeA,template:'confirm'}});
  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/state?${qs(clientId,storeA)}`,{method:'PATCH',body:{clientId,storeId:storeA,state:'confirmed'}});
  const history=(await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderA)}/history?${qs(clientId,storeA)}`)).data.order;
  if(history.customerNote!=='ملاحظة العميل الأصلية'||history.latestInternalNote!=='ملاحظة داخلية QA')throw new Error('Customer note and internal note were not kept separate');
  if(history.awb!=='QA-AWB-123'||Number(history.contactCount)<1)throw new Error('Customer Service AWB/contact persistence failed');
  const audited=history.history||[];
  for(const kind of ['contact','internal_note','awb','whatsapp']){
    const h=audited.find(x=>x.type===kind);
    if(!h||!String(h.by||'').includes(supportEmail))throw new Error(`Audited Customer Service actor missing for ${kind}: ${JSON.stringify(h)}`);
  }
  const stateEvent=[...audited].reverse().find(x=>x.state==='confirmed');
  if(!stateEvent||!String(stateEvent.by||'').includes(supportEmail))throw new Error(`State change actor missing: ${JSON.stringify(stateEvent)}`);

  await api(supportCookie,`/api/customer-service/orders/${encodeURIComponent(orderB)}/state?${qs(clientId,storeB)}`,{method:'PATCH',body:{clientId,storeId:storeB,state:'deferred',deferUntil:tomorrow}});
  boardB=(await api(supportCookie,`/api/customer-service?${qs(clientId,storeB)}`)).data;
  const deferred=boardB.orders.find(x=>String(x.id)===String(orderB));
  if(deferred?.state!=='deferred'||deferred.deferUntil!==tomorrow)throw new Error(`Deferred order not separated correctly: ${JSON.stringify(deferred)}`);

  await d1("UPDATE orders SET state='deferred',checkpoint='مؤجل',defer_until=? WHERE id=? AND client_id=?",[today,orderB,clientId]);
  boardB=(await api(supportCookie,`/api/customer-service?${qs(clientId,storeB)}`)).data;
  const returned=boardB.orders.find(x=>String(x.id)===String(orderB));
  if(returned?.state!=='pending'||returned.returnedFromDeferredToday!==true)throw new Error(`Due deferred order did not return highlighted: ${JSON.stringify(returned)}`);

  console.log(`Live Customer Service QA passed: combined assigned-store board + per-store isolation, hidden C, owner legacy bridge/delete governance, four stages, actor history, contact, AWB, WhatsApp, internal notes and deferred return (${clientId}).`);
}catch(error){
  primaryError=error;
}finally{
  try{await restore()}catch(cleanupError){primaryError=primaryError?new Error(`${primaryError.message}; ${cleanupError.message}`):cleanupError;}
}
if(primaryError)throw primaryError;