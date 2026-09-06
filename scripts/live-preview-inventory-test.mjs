import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-inventory-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Inventory QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,nonce=randomBytes(5).toString('hex').toUpperCase(),clientId=`QA-INV-${nonce}`,storeId=`QA-INV-ST-${nonce}`,productId=`QA-INV-PR-${nonce}`,userId=`QA-INV-US-${nonce}`,email=`qa-inventory-${nonce.toLowerCase()}@example.test`,password=`Inventory!${randomBytes(12).toString('hex')}Aa1`,historicDate='2026-08-15';
let cookie='';

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,900)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,{method='GET',body,ok=[200]}={}){const options={method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)},safeRetry=method==='GET',attempts=safeRetry?5:1;let last;for(let attempt=1;attempt<=attempts;attempt++){try{const r=await fetch(`${base}${path}`,options),txt=await r.text();if(safeRetry&&[502,503,504].includes(r.status)&&attempt<attempts){last=new Error(`${method} ${path} transient ${r.status}: ${txt.slice(0,300)}`);await sleep(2000);continue;}let data={};try{data=JSON.parse(txt)}catch{data={raw:txt}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${txt.slice(0,900)}`);return {status:r.status,data};}catch(error){last=error;if(!safeRetry||attempt===attempts)throw error;await sleep(2000);}}throw last||new Error(`${method} ${path} failed`);}
async function cleanup(){for(const [sql,params] of [
  ['DELETE FROM order_item_stock_allocations WHERE client_id=?',[clientId]],
  ['DELETE FROM order_stock_allocations WHERE client_id=?',[clientId]],
  ['DELETE FROM order_items WHERE client_id=?',[clientId]],
  ['DELETE FROM orders WHERE client_id=?',[clientId]],
  ['DELETE FROM customers WHERE client_id=?',[clientId]],
  ['DELETE FROM inventory_batch_items WHERE client_id=?',[clientId]],
  ['DELETE FROM inventory_batches WHERE client_id=?',[clientId]],
  ['DELETE FROM stock_log WHERE client_id=?',[clientId]],
  ['DELETE FROM products WHERE client_id=?',[clientId]],
  ['DELETE FROM stores WHERE client_id=?',[clientId]],
  ['DELETE FROM login_attempts WHERE email=?',[email]],
  ['DELETE FROM users WHERE id=?',[userId]]
]){try{await d1(sql,params)}catch{}}}
function cairoToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>parts.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}

let error=null;
try{
  await cleanup();const ts=new Date().toISOString(),hash=await hashPassword(password);
  await d1('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[storeId,clientId,'QA Inventory Store',`INV-${nonce}`,'EGP','Africa/Cairo','active',1,ts,ts]);
  await d1('INSERT INTO products (id,client_id,store_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[productId,clientId,storeId,'QA Dated Stock Product',`SKU-${nonce}`,'QA',100,40,1,10,2,ts]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'QA Inventory Admin',hash,'admin','active',ts]);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}),loginText=await login.text();if(!login.ok)throw new Error(`Inventory admin login failed ${login.status}: ${loginText.slice(0,500)}`);cookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Inventory admin cookie missing');

  const dated=(await api('/api/inventory/stock-adjust',{method:'POST',body:{clientId,storeId,productId,delta:7,stockDate:historicDate,note:'QA historical stock date'}})).data;
  if(dated.stockDate!==historicDate||Number(dated.newStock)!==17)throw new Error(`Dated stock adjustment result invalid: ${JSON.stringify(dated)}`);
  let product=(await d1('SELECT stock FROM products WHERE id=? AND client_id=?',[productId,clientId]))[0];if(Number(product?.stock)!==17)throw new Error(`Product stock after dated adjustment must be 17, got ${product?.stock}`);
  let log=(await api(`/api/inventory/stock-log?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&limit=20`)).data.entries||[],datedRow=log.find(x=>x.id===dated.id);
  if(!datedRow||datedRow.stock_date!==historicDate||Number(datedRow.delta)!==7||Number(datedRow.new_stock)!==17)throw new Error(`Stock history did not preserve selected business date: ${JSON.stringify(datedRow)}`);
  if(String(datedRow.created_at||'').slice(0,10)===historicDate)throw new Error('Business stock date must remain separate from the actual entry timestamp');

  const auto=(await api('/api/inventory/stock-adjust',{method:'POST',body:{clientId,storeId,productId,delta:3,note:'QA default stock date'}})).data;
  if(auto.stockDate!==cairoToday()||Number(auto.newStock)!==20)throw new Error(`Default Cairo stock date failed: ${JSON.stringify(auto)}`);
  log=(await api(`/api/inventory/stock-log?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&limit=20`)).data.entries||[];const autoRow=log.find(x=>x.id===auto.id);if(!autoRow||autoRow.stock_date!==cairoToday())throw new Error('Default stock date was not persisted in history');

  const before=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0]?.stock;
  await api('/api/inventory/stock-adjust',{method:'POST',ok:[400],body:{clientId,storeId,productId,delta:5,stockDate:'2026-99-99',note:'must fail'}});
  const after=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0]?.stock;if(Number(before)!==Number(after))throw new Error('Invalid stock date mutated inventory');

  const batch=(await api('/api/inventory/batches',{method:'POST',ok:[201],body:{clientId,storeId,name:'أول استوك QA',stockDate:historicDate,note:'QA named batch',items:[{productId,qty:5}]}})).data;
  if(!batch.id||batch.name!=='أول استوك QA'||batch.stockDate!==historicDate||Number(batch.totalQty)!==5)throw new Error(`Named stock batch create invalid: ${JSON.stringify(batch)}`);
  product=(await d1('SELECT stock FROM products WHERE id=? AND client_id=?',[productId,clientId]))[0];if(Number(product?.stock)!==25)throw new Error(`Named batch must add to general stock: expected 25, got ${product?.stock}`);
  let batches=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches||[],listed=batches.find(x=>x.id===batch.id);
  if(!listed||listed.stockDate!==historicDate||Number(listed.totalInitial)!==5||Number(listed.totalRemaining)!==5||Number(listed.items?.[0]?.remainingQty)!==5)throw new Error(`Named batch listing invalid: ${JSON.stringify(listed)}`);
  await api(`/api/products/${encodeURIComponent(productId)}?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'DELETE',ok:[409]});

  const order1=(await api('/api/orders',{method:'POST',body:{clientId,storeId,name:'QA Batch Customer 1',phone:'01000000001',gov:'القاهرة',address:'QA',product:'QA Dated Stock Product',productId,qty:2,total:200,state:'pending'}})).data.order;
  if(!order1?.id)throw new Error('Failed to create first batch allocation order');
  await api(`/api/customer-service/orders/${encodeURIComponent(order1.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'confirmed'}});
  let allocation=(await d1('SELECT batch_id,qty,status FROM order_stock_allocations WHERE order_id=?',[order1.id]))[0];if(allocation?.batch_id!==batch.id||Number(allocation?.qty)!==2||allocation?.status!=='allocated')throw new Error(`Confirmation allocation missing: ${JSON.stringify(allocation)}`);
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==3)throw new Error(`Batch remaining after confirmation must be 3: ${JSON.stringify(listed)}`);
  product=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0];if(Number(product?.stock)!==23)throw new Error(`General stock after confirmation must be 23, got ${product?.stock}`);

  await api(`/api/customer-service/orders/${encodeURIComponent(order1.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'shipped'}});
  allocation=(await d1('SELECT batch_id,qty,status FROM order_stock_allocations WHERE order_id=?',[order1.id]))[0];if(allocation?.batch_id!==batch.id||Number(allocation?.qty)!==2||allocation?.status!=='allocated')throw new Error(`Shipping must preserve confirmation allocation: ${JSON.stringify(allocation)}`);
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==3)throw new Error('Moving to shipping must not change named-batch remaining stock');
  product=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0];if(Number(product?.stock)!==23)throw new Error(`Moving to shipping must not change general stock; got ${product?.stock}`);

  const missingReason=await api(`/api/customer-service/orders/${encodeURIComponent(order1.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',ok:[400],body:{clientId,storeId,state:'returned'}});
  if(missingReason.data?.code!=='ORDER_OUTCOME_REASON_REQUIRED')throw new Error(`Return without reason must be rejected: ${JSON.stringify(missingReason.data)}`);
  await api(`/api/customer-service/orders/${encodeURIComponent(order1.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'returned',returnType:'full',reason:'QA inventory return reason',outcomeReason:'QA inventory return reason',sourceSection:'customer-service'}});
  allocation=(await d1('SELECT status FROM order_stock_allocations WHERE order_id=?',[order1.id]))[0];if(allocation?.status!=='returned')throw new Error('Returned order must restore named batch allocation');
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==5)throw new Error('Returned order must restore named batch quantity to 5');
  product=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0];if(Number(product?.stock)!==25)throw new Error(`Reasoned return + batch restore must leave general stock at 25, got ${product?.stock}`);

  await api(`/api/customer-service/orders/${encodeURIComponent(order1.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'confirmed'}});
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==3)throw new Error('Re-confirming returned order must reserve 2 again from FIFO stock');
  product=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0];if(Number(product?.stock)!==23)throw new Error(`Re-confirming returned order must deduct general stock once; got ${product?.stock}`);
  await api(`/api/customer-service/orders/${encodeURIComponent(order1.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'shipped'}});
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==3)throw new Error('Re-shipping after re-confirmation must not consume stock again');
  product=(await d1('SELECT stock FROM products WHERE id=?',[productId]))[0];if(Number(product?.stock)!==23)throw new Error(`Re-shipping after re-confirmation must not double-deduct general stock; got ${product?.stock}`);

  const order2=(await api('/api/orders',{method:'POST',body:{clientId,storeId,name:'QA Batch Customer 2',phone:'01000000002',gov:'القاهرة',address:'QA',product:'QA Dated Stock Product',productId,qty:3,total:300,state:'pending'}})).data.order;
  await api(`/api/customer-service/orders/${encodeURIComponent(order2.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'confirmed'}});
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==0||listed?.status!=='depleted')throw new Error(`Batch must become depleted at zero on confirmation: ${JSON.stringify(listed)}`);
  await api(`/api/customer-service/orders/${encodeURIComponent(order2.id)}/state?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'PATCH',body:{clientId,storeId,state:'shipped'}});
  listed=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`)).data.batches.find(x=>x.id===batch.id);if(Number(listed?.totalRemaining)!==0)throw new Error('Shipping a confirmed order must leave depleted batch unchanged');
  const active=(await api(`/api/inventory/batches?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}&activeOnly=1`)).data.batches||[];if(active.some(x=>x.id===batch.id))throw new Error('Depleted named batch must disappear from Customer Service active batch choices');

  console.log('Live Inventory QA passed: historic dates, named batches, product-delete stock guard, reservation on confirmation, state-only shipping, mandatory return reason, return restore, re-confirmation and depleted-batch hiding.');
}catch(e){error=e;}finally{await cleanup();}
if(error)throw error;