import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');if(!base)throw new Error('Usage: node scripts/live-preview-admin-client-command-center-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;if(!accountId||!token)throw new Error('Admin Command Center QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];if(!databaseId)throw new Error('Preview database_id missing');
const nonce=randomBytes(5).toString('hex').toUpperCase(),clientId=`QA-ADM-${nonce}`,storeId=`QA-ADM-ST-${nonce}`,adminId=`QA-ADM-US-${nonce}`,ownerId=`QA-ADM-OW-${nonce}`,productId=`QA-ADM-PR-${nonce}`,campaignId=`QA-ADM-CA-${nonce}`,subscriptionId=`QA-ADM-SUB-${nonce}`;
const adminEmail=`qa-admin-command-${nonce.toLowerCase()}@example.test`,ownerEmail=`qa-owner-command-${nonce.toLowerCase()}@example.test`,adminPassword=`AdminCommand!${randomBytes(8).toString('hex')}Aa1`,ownerPassword=`OwnerCommand!${randomBytes(8).toString('hex')}Bb2`;
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
function cairoDate(offset=0){const d=new Date(Date.now()+offset*86400000),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),g=t=>parts.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
const today=cairoDate(),yesterday=cairoDate(-1),ts=new Date().toISOString();
async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,900)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function login(email,password){const r=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}),text=await r.text();if(!r.ok)throw new Error(`Login ${email} failed ${r.status}: ${text.slice(0,600)}`);const cookie=(r.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error(`Login cookie missing for ${email}`);return cookie;}
async function api(cookie,path,{ok=[200]}={}){const r=await fetch(`${base}${path}`,{headers:{...(cookie?{Cookie:cookie}:{})}}),text=await r.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}}if(!ok.includes(r.status))throw new Error(`GET ${path} expected ${ok.join('/')}, got ${r.status}: ${text.slice(0,900)}`);return {status:r.status,data};}
async function cleanup(){for(const [sql,params] of [
  ['DELETE FROM order_attribution WHERE client_id=?',[clientId]],['DELETE FROM campaign_daily_metrics WHERE client_id=?',[clientId]],['DELETE FROM marketing_campaigns WHERE client_id=?',[clientId]],['DELETE FROM transactions WHERE client_id=?',[clientId]],['DELETE FROM order_item_stock_allocations WHERE client_id=?',[clientId]],['DELETE FROM order_items WHERE client_id=?',[clientId]],['DELETE FROM order_stock_allocations WHERE client_id=?',[clientId]],['DELETE FROM orders WHERE client_id=?',[clientId]],['DELETE FROM products WHERE client_id=?',[clientId]],['DELETE FROM platform_client_notes WHERE client_id=?',[clientId]],['DELETE FROM wallet_topup_requests WHERE client_id=?',[clientId]],['DELETE FROM wallet_log WHERE client_id=?',[clientId]],['DELETE FROM wallet_accounts WHERE client_id=?',[clientId]],['DELETE FROM tenant_modules WHERE client_id=?',[clientId]],['DELETE FROM subscriptions WHERE client_id=?',[clientId]],['DELETE FROM user_store_access WHERE client_id=?',[clientId]],['DELETE FROM users WHERE client_id=?',[clientId]],['DELETE FROM stores WHERE client_id=?',[clientId]],['DELETE FROM tenant_settings WHERE client_id=?',[clientId]],['DELETE FROM login_attempts WHERE email=?',[ownerEmail]],['DELETE FROM login_attempts WHERE email=?',[adminEmail]],['DELETE FROM users WHERE id=?',[adminId]]
]){try{await d1(sql,params)}catch{}}}
let error=null;
try{
  await cleanup();const [adminHash,ownerHash]=await Promise.all([hashPassword(adminPassword),hashPassword(ownerPassword)]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminId,adminEmail,'QA Command Admin',adminHash,'admin','active',ts]);
  await d1('INSERT INTO tenant_settings (client_id,display_name,timezone,currency,locale,plan,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[clientId,'QA Client Command Center','Africa/Cairo','EGP','ar-EG','growth','active',ts,ts]);
  await d1('INSERT INTO subscriptions (id,client_id,plan,status,billing_cycle,amount,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[subscriptionId,clientId,'growth','active','monthly',500,'EGP',ts,ts]);
  await d1('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[storeId,clientId,'QA Command Store','MAIN','EGP','Africa/Cairo','active',1,ts,ts]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,?,?,?,NULL)',[ownerId,ownerEmail,'صاحب حساب QA',ownerHash,'client',clientId,'active',ts]);
  await d1('INSERT INTO user_store_access (id,client_id,user_id,store_id,role,created_at) VALUES (?,?,?,?,?,?)',[`QA-USA-${nonce}`,clientId,ownerId,storeId,'owner',ts]);
  await d1('INSERT INTO wallet_accounts (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[clientId,900,'EGP',2,0,0,0,'v27',0,'active',ts]);
  await d1('INSERT INTO products (id,client_id,store_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[productId,clientId,storeId,'QA Command Product',`ADM-${nonce}`,'QA',600,250,1,2,3,ts]);
  const orderSql='INSERT INTO orders (id,client_id,store_id,date,name,phone,product,product_id,qty,total,state,collected_amount,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
  await d1(orderSql,[`QA-ADM-O1-${nonce}`,clientId,storeId,today,'عميل اليوم 1','01011111111','QA Command Product',productId,1,600,'collected',550,ts]);
  await d1(orderSql,[`QA-ADM-O2-${nonce}`,clientId,storeId,today,'عميل اليوم 2','01022222222','QA Command Product',productId,1,400,'pending',null,ts]);
  await d1(orderSql,[`QA-ADM-OP-${nonce}`,clientId,storeId,yesterday,'عميل أمس','01033333333','QA Command Product',productId,1,300,'signed',null,ts]);
  await d1('INSERT INTO transactions (id,type,date,category,amount,currency,method,client_id,store_id,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[`QA-TXI-${nonce}`,'income',today,'QA',200,'EGP','cash',clientId,storeId,'QA income',adminId,ts]);
  await d1('INSERT INTO transactions (id,type,date,category,amount,currency,method,client_id,store_id,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[`QA-TXE-${nonce}`,'expense',today,'QA',50,'EGP','cash',clientId,storeId,'QA expense',adminId,ts]);
  await d1('INSERT INTO marketing_campaigns (id,client_id,store_id,platform,external_campaign_id,name,objective,status,currency,budget,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[campaignId,clientId,storeId,'meta',`EXT-${nonce}`,'QA Admin Campaign','sales','active','EGP',1000,ts,ts]);
  await d1('INSERT INTO campaign_daily_metrics (client_id,store_id,campaign_id,metric_date,spend,impressions,reach,clicks,conversions,revenue,orders_count,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[clientId,storeId,campaignId,today,100,10000,8000,200,2,1000,2,ts]);

  await api('',`/api/admin/client-command-center?preset=today`,{ok:[401]});
  const ownerCookie=await login(ownerEmail,ownerPassword);await api(ownerCookie,`/api/admin/client-command-center?preset=today`,{ok:[403]});
  const adminCookie=await login(adminEmail,adminPassword),home=(await api(adminCookie,`/api/admin/client-command-center?preset=today`)).data;
  const card=(home.clients||[]).find(x=>String(x.clientId)===clientId);if(!card)throw new Error('Admin home did not include QA subscribed client');
  if(card.orders?.total!==2||Number(card.orders?.gmv)!==1000||card.orders?.delivered!==1||Number(card.orders?.collectedAmount)!==550)throw new Error(`Admin home order/COD metrics invalid: ${JSON.stringify(card.orders)}`);
  if(Number(card.marketing?.spend)!==100||Number(card.marketing?.realRoas)!==6)throw new Error(`Admin home ad metrics invalid: ${JSON.stringify(card.marketing)}`);
  if(card.inventory?.lowStock!==1)throw new Error(`Admin home inventory warning missing: ${JSON.stringify(card.inventory)}`);
  if(!home.period||home.period.preset!=='today'||home.totals?.clients<1)throw new Error(`Admin home period/totals invalid: ${JSON.stringify(home.period)}`);

  const detail=(await api(adminCookie,`/api/admin/clients/${encodeURIComponent(clientId)}/command-brief?preset=today`)).data;
  if(detail.client?.name!=='QA Client Command Center'||detail.client?.ownerEmail!==ownerEmail)throw new Error(`Client identity missing from detail: ${JSON.stringify(detail.client)}`);
  if(detail.current?.commerce?.total!==2||Number(detail.current?.commerce?.gmv)!==1000||Number(detail.current?.metrics?.finance?.net)!==150)throw new Error(`Current brief metrics invalid: ${JSON.stringify(detail.current)}`);
  if(detail.previous?.commerce?.total!==1||Number(detail.previous?.commerce?.gmv)!==300)throw new Error(`Previous-period brief invalid: ${JSON.stringify(detail.previous)}`);
  if(Number(detail.comparison?.ordersPct)!==100)throw new Error(`Previous-period comparison missing: ${JSON.stringify(detail.comparison)}`);
  if(!(detail.current?.recommendations||[]).length)throw new Error('Business recommendations missing');
  if(!(detail.stores||[]).some(x=>String(x.id)===storeId))throw new Error('Client stores missing from full brief');
  const custom=(await api(adminCookie,`/api/admin/clients/${encodeURIComponent(clientId)}/command-brief?preset=custom&from=${today}&to=${today}`)).data;if(custom.period?.preset!=='custom'||custom.current?.commerce?.total!==2)throw new Error('Custom period brief failed');
  console.log('Live Admin Client Command Center QA passed: Admin-only all-client cards expose orders/GMV/COD/ads/inventory, full per-client briefs support period comparisons and custom ranges, and tenant users are denied.');
}catch(e){error=e;}finally{await cleanup();}
if(error)throw error;
