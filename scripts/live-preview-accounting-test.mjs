import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';
import {reconcileAutomaticManagementFees} from '../src/index-commerce-v30.js';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-accounting-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;if(!accountId||!token)throw new Error('Preview Accounting QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,nonce=randomBytes(5).toString('hex').toUpperCase(),clientId=`QA-ACC-${nonce}`,storeId=`QA-STORE-${nonce}`,store2Id=`QA-STORE2-${nonce}`,order1=`QA-ORD-A-${nonce}`,order2=`QA-ORD-B-${nonce}`,order3=`QA-ORD-C-${nonce}`,order4=`QA-ORD-D-${nonce}`,adminEmail=`qa-accounting-admin-${nonce.toLowerCase()}@example.test`,accountantEmail=`qa-accountant-${nonce.toLowerCase()}@example.test`,adminId=`QA-ACC-ADMIN-${nonce}`,accountantId=`QA-ACCOUNTANT-${nonce}`,adminPassword=`Admin!${randomBytes(12).toString('hex')}Aa1`,accountantPassword=`Accountant!${randomBytes(12).toString('hex')}Aa1`,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=today.slice(0,7);
let adminCookie='',accountantCookie='',entryId='',incomeEntryId='',store2ExpenseId='';
async function d1Raw(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,1000)}`);return x||{results:[],meta:{}};}
async function d1(sql,params=[]){return (await d1Raw(sql,params)).results||[];}
const remoteDb={prepare(sql){return {bind(...params){return {async all(){return {results:(await d1Raw(sql,params)).results||[]};},async first(){return ((await d1Raw(sql,params)).results||[])[0]||null;},async run(){const x=await d1Raw(sql,params);return {meta:x.meta||{}};}};}};}};
const remoteEnv={DB:remoteDb};
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function login(email,password){const r=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}),t=await r.text();if(!r.ok)throw new Error(`Accounting login failed ${r.status}: ${t.slice(0,500)}`);const c=(r.headers.get('set-cookie')||'').split(';')[0];if(!c)throw new Error('Accounting login cookie missing');return c;}
async function api(path,{method='GET',body,cookie=adminCookie,ok=[200]}={}){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),t=await r.text();let data={};try{data=JSON.parse(t)}catch{data={raw:t}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${t.slice(0,1200)}`);return {status:r.status,data};}
async function cleanup(){for(const [sql,params] of [
  ['DELETE FROM transactions WHERE client_id=?',[clientId]],['DELETE FROM order_management_fees WHERE client_id=?',[clientId]],['DELETE FROM orders WHERE client_id=?',[clientId]],['DELETE FROM user_store_access WHERE client_id=?',[clientId]],['DELETE FROM stores WHERE client_id=?',[clientId]],['DELETE FROM login_attempts WHERE email IN (?,?)',[adminEmail,accountantEmail]],['DELETE FROM users WHERE id IN (?,?)',[adminId,accountantId]]
]){try{await d1(sql,params)}catch{}}}
function eq(actual,expected,label){if(Math.abs(Number(actual)-Number(expected))>0.01)throw new Error(`${label}: expected ${expected}, got ${actual}`);}
async function feeRows(){return (await api(`/api/accounting/management-fees?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&from=${today}&to=${today}`)).data.entries||[];}
async function patchOrder(id,state,extra={}){return api(`/api/orders/${encodeURIComponent(id)}?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state,...extra}});}
async function monthly(store=null,cookie=adminCookie){return (await api(`/api/accounting/monthly?clientId=${encodeURIComponent(clientId)}${store?`&storeId=${encodeURIComponent(store)}`:''}&month=${month}`,{cookie})).data;}

let error=null;
try{
  await cleanup();const ts=new Date().toISOString(),adminHash=await hashPassword(adminPassword),accountantHash=await hashPassword(accountantPassword);
  await d1('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at,management_fee_pct) VALUES (?,?,?,?,?,?,?,?,?,?,0)',[storeId,clientId,'QA Accounting Store',`ACC-${nonce}`,'EGP','Africa/Cairo','active',1,ts,ts]);
  await d1('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at,management_fee_pct) VALUES (?,?,?,?,?,?,?,?,?,?,0)',[store2Id,clientId,'QA Accounting Store 2',`ACC2-${nonce}`,'EGP','Africa/Cairo','active',0,ts,ts]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminId,adminEmail,'QA Accounting Admin',adminHash,'admin','active',ts]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,?,?,?,NULL)',[accountantId,accountantEmail,'QA Accountant',accountantHash,'accountant',clientId,'active',ts]);
  await d1('INSERT INTO user_store_access (id,client_id,user_id,store_id,role,created_at) VALUES (?,?,?,?,?,?)',[`USA-${nonce}`,clientId,accountantId,storeId,'member',ts]);
  for(const [id,total] of [[order1,1000],[order2,1000],[order3,500],[order4,700]])await d1("INSERT INTO orders (id,client_id,store_id,date,name,phone,total,state,checkpoint,history,created_at) VALUES (?,?,?,?,?,?,?,'pending','جاري التأكيد','[]',?)",[id,clientId,storeId,today,`Customer ${id}`,'01000000000',total,ts]);
  adminCookie=await login(adminEmail,adminPassword);accountantCookie=await login(accountantEmail,accountantPassword);

  const set10=(await api(`/api/admin/stores/${encodeURIComponent(storeId)}/management-fee`,{method:'PATCH',body:{clientId,managementFeePct:10}})).data;eq(set10.managementFeePct,10,'store rate 10%');
  if((await feeRows()).length!==0)throw new Error('Pending orders must not have management fees');
  await patchOrder(order1,'confirmed');if((await feeRows()).length!==0)throw new Error('Confirmed order must not have management fee before shipping');
  await patchOrder(order1,'shipped');let rows=await feeRows(),a=rows.find(x=>x.orderId===order1);if(!a||a.status!=='active')throw new Error('Shipped order management fee was not activated');eq(a.ratePct,10,'order1 rate');eq(a.amount,100,'order1 fee');
  await patchOrder(order1,'signed');rows=await feeRows();a=rows.find(x=>x.orderId===order1);eq(a.amount,100,'signed must not duplicate/reprice fee');

  let dashboard=(await api(`/api/dashboard?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&from=${today}&to=${today}`)).data;eq(dashboard.accounting?.managementFees,100,'dashboard management fee');eq(dashboard.finance?.expenseBreakdown?.managementFees,100,'dashboard expense breakdown management fee');

  await patchOrder(order1,'returned',{returnType:'full',refundAmount:1000});rows=await feeRows();a=rows.find(x=>x.orderId===order1);if(!a||a.status!=='reversed')throw new Error('Returned order management fee was not reversed');dashboard=(await api(`/api/dashboard?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&from=${today}&to=${today}`)).data;eq(dashboard.accounting?.managementFees,0,'returned fee must disappear from dashboard expense');
  await patchOrder(order1,'shipped');rows=await feeRows();a=rows.find(x=>x.orderId===order1);if(a.status!=='active')throw new Error('Corrected returned order fee did not reactivate');eq(a.amount,100,'reactivated fee keeps historical amount');

  const set20=(await api(`/api/admin/stores/${encodeURIComponent(storeId)}/management-fee`,{method:'PATCH',body:{clientId,managementFeePct:20}})).data;eq(set20.managementFeePct,20,'store rate 20%');rows=await feeRows();a=rows.find(x=>x.orderId===order1);eq(a.amount,100,'historical fee must not be repriced after store rate change');eq(a.ratePct,10,'historical rate must remain immutable');
  await patchOrder(order2,'shipped');rows=await feeRows();let b=rows.find(x=>x.orderId===order2);if(!b||b.status!=='active')throw new Error('Second shipped order fee missing');eq(b.ratePct,20,'new order uses new rate');eq(b.amount,200,'second order fee');
  await patchOrder(order3,'cancelled');rows=await feeRows();if(rows.some(x=>x.orderId===order3))throw new Error('Order cancelled before shipping must never be charged management fee');

  const overview=(await api(`/api/accounting/overview?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&from=${today}&to=${today}`)).data;eq(overview.managementFees,300,'accounting overview management fees');if(overview.currency!=='EGP')throw new Error(`Accounting currency should be EGP, got ${overview.currency}`);

  const write=(await api('/api/accounting/entries',{method:'POST',cookie:accountantCookie,ok:[201],body:{clientId,storeId,type:'expense',category:'مصاريف إدارية',amount:50,currency:'EGP',method:'bank',date:today,counterparty:'QA Vendor',documentNo:'QA-INV-1',taxAmount:7.5,referenceType:'order',referenceId:order2,note:'QA accounting expense'}})).data;entryId=write.id;if(!entryId)throw new Error('Accountant expense entry id missing');
  const income=(await api('/api/accounting/entries',{method:'POST',cookie:accountantCookie,ok:[201],body:{clientId,storeId,type:'income',category:'أخرى',amount:25,currency:'EGP',method:'bank',date:today,counterparty:'QA Other Income',documentNo:'QA-INCOME-1',note:'QA accounting other income'}})).data;incomeEntryId=income.id;if(!incomeEntryId)throw new Error('Accountant income entry id missing');
  const store2Expense=(await api('/api/accounting/entries',{method:'POST',ok:[201],body:{clientId,storeId:store2Id,type:'expense',category:'مصاريف إدارية',amount:30,currency:'EGP',method:'cash',date:today,counterparty:'QA Store 2 Vendor',documentNo:'QA-STORE2-1',note:'QA second-store expense'}})).data;store2ExpenseId=store2Expense.id;if(!store2ExpenseId)throw new Error('Second-store expense id missing');

  const entries=(await api(`/api/accounting/entries?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&from=${today}&to=${today}`,{cookie:accountantCookie})).data.entries||[],entry=entries.find(x=>x.id===entryId);if(!entry)throw new Error('Accountant-created entry not listed');if(entry.documentNo!=='QA-INV-1'||entry.counterparty!=='QA Vendor'||entry.referenceId!==order2)throw new Error('Accounting document/counterparty/reference metadata not preserved');eq(entry.taxAmount,7.5,'accounting tax amount');

  const storeMonthly=await monthly(storeId,accountantCookie);eq(storeMonthly.manual.expenses,50,'monthly store manual expenses');eq(storeMonthly.manual.income,25,'monthly store other income');eq(storeMonthly.profit.accountingNetProfit,Number(storeMonthly.profit.operatingNetProfit)+25,'monthly accounting net adds other income once');eq(storeMonthly.cash.manualExpenses,50,'monthly store cash expense');
  const allMonthly=await monthly(null,adminCookie);eq(allMonthly.manual.expenses,80,'all-store monthly manual expenses aggregate');eq(allMonthly.manual.income,25,'all-store monthly income aggregate');if(allMonthly.storeId!==null||allMonthly.storeName!=='كل المتاجر')throw new Error(`All-store monthly scope incorrect: ${JSON.stringify({storeId:allMonthly.storeId,storeName:allMonthly.storeName})}`);
  if(!(allMonthly.manual.categories||[]).some(x=>x.type==='expense'&&x.category==='مصاريف إدارية'&&Number(x.amount)>=80))throw new Error('All-store monthly category breakdown did not aggregate manual expenses');

  await api(`/api/admin/stores/${encodeURIComponent(storeId)}/management-fee`,{method:'PATCH',cookie:accountantCookie,body:{clientId,managementFeePct:30},ok:[403]});

  // Simulate a shipping/tracking provider changing state directly, bypassing the normal order PATCH route.
  await d1("UPDATE orders SET state='returned' WHERE id=? AND client_id=?",[order2,clientId]);
  let externalReconcile=await reconcileAutomaticManagementFees(remoteEnv);if(externalReconcile.reversed<1||externalReconcile.failed)throw new Error(`Automatic external-return reconciliation failed: ${JSON.stringify(externalReconcile)}`);
  rows=await feeRows();b=rows.find(x=>x.orderId===order2);if(!b||b.status!=='reversed')throw new Error('External returned state did not reverse management fee');eq(b.amount,200,'external return keeps historical fee amount for audit');

  const set0=(await api(`/api/admin/stores/${encodeURIComponent(storeId)}/management-fee`,{method:'PATCH',body:{clientId,managementFeePct:0}})).data;eq(set0.managementFeePct,0,'store rate 0%');
  await d1("UPDATE orders SET state='shipped' WHERE id=? AND client_id=?",[order2,clientId]);
  externalReconcile=await reconcileAutomaticManagementFees(remoteEnv);if(externalReconcile.active<1||externalReconcile.failed)throw new Error(`Historical fee reactivation after external correction failed: ${JSON.stringify(externalReconcile)}`);
  rows=await feeRows();b=rows.find(x=>x.orderId===order2);if(!b||b.status!=='active')throw new Error('External correction did not reactivate historical fee');eq(b.ratePct,20,'historical rate survives current store rate 0%');eq(b.amount,200,'historical amount survives current store rate 0%');

  await d1("UPDATE orders SET state='shipped' WHERE id=? AND client_id=?",[order4,clientId]);
  externalReconcile=await reconcileAutomaticManagementFees(remoteEnv);if(externalReconcile.failed)throw new Error(`Zero-rate reconciliation reported failure: ${JSON.stringify(externalReconcile)}`);
  rows=await feeRows();if(rows.some(x=>x.orderId===order4))throw new Error('New externally-shipped order at 0% must not create a zero-value management fee row');

  for(const [id,store] of [[entryId,storeId],[incomeEntryId,storeId],[store2ExpenseId,store2Id]])if(id)await api(`/api/accounting/entries/${encodeURIComponent(id)}`,{method:'DELETE',body:{clientId,storeId:store}});
  entryId=incomeEntryId=store2ExpenseId='';
  console.log('Live Accounting QA passed: monthly system accounts aggregate across stores, manual expenses hit operating P&L once, other income adjusts accounting net once, cash stays separate, management fees reconcile correctly, accountant writes are scoped, historical rates stay immutable.');
}catch(e){error=e;}finally{await cleanup();}
if(error)throw error;
