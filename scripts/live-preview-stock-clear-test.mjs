import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-stock-clear-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Stock Clear QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const nonce=randomBytes(5).toString('hex').toUpperCase(),clientId=`QA-CLR-${nonce}`,storeId=`QA-CLR-ST-${nonce}`,productId=`QA-CLR-PR-${nonce}`,variantA=`QA-CLR-VA-${nonce}`,variantB=`QA-CLR-VB-${nonce}`,staleProductId=`QA-CLR-OLD-${nonce}`,userId=`QA-CLR-US-${nonce}`,email=`qa-stock-clear-${nonce.toLowerCase()}@example.test`,password=`StockClear!${randomBytes(12).toString('hex')}Aa1`,historicDate='2026-08-20';
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;let cookie='';

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,900)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function api(path,{method='GET',body,ok=[200]}={}){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),txt=await r.text();let data={};try{data=JSON.parse(txt)}catch{data={raw:txt}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${txt.slice(0,900)}`);return {status:r.status,data};}
async function cleanup(){for(const [sql,params] of [
  ['DELETE FROM order_stock_allocations WHERE client_id=?',[clientId]],['DELETE FROM orders WHERE client_id=?',[clientId]],['DELETE FROM inventory_batch_items WHERE client_id=?',[clientId]],['DELETE FROM inventory_batches WHERE client_id=?',[clientId]],['DELETE FROM stock_log WHERE client_id=?',[clientId]],['DELETE FROM product_variants WHERE client_id=?',[clientId]],['DELETE FROM products WHERE client_id=?',[clientId]],['DELETE FROM stores WHERE client_id=?',[clientId]],['DELETE FROM login_attempts WHERE email=?',[email]],['DELETE FROM users WHERE id=?',[userId]]
]){try{await d1(sql,params)}catch{}}}

let error=null;
try{
  await cleanup();const ts=new Date().toISOString(),hash=await hashPassword(password);
  await d1('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[storeId,clientId,'QA Stock Clear Store',`CLR-${nonce}`,'EGP','Africa/Cairo','active',1,ts,ts]);
  await d1('INSERT INTO products (id,client_id,store_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[productId,clientId,storeId,'QA Variant Clear Product',`CLR-${nonce}`,'QA',100,40,1,0,2,ts]);
  await d1('INSERT INTO product_variants (id,product_id,client_id,store_id,name,sku,stock,price,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[variantA,productId,clientId,storeId,'أبيض',`CLR-W-${nonce}`,0,100,1,ts]);
  await d1('INSERT INTO product_variants (id,product_id,client_id,store_id,name,sku,stock,price,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[variantB,productId,clientId,storeId,'أسود',`CLR-B-${nonce}`,0,100,1,ts]);
  await d1('INSERT INTO products (id,client_id,store_id,name,sku,category,price,cost,active,stock,low_stock_threshold,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[staleProductId,clientId,storeId,'QA Stale Named Stock Product',`OLD-${nonce}`,'QA',100,40,1,0,2,ts]);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'QA Stock Clear Admin',hash,'admin','active',ts]);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}),loginText=await login.text();if(!login.ok)throw new Error(`Stock Clear admin login failed ${login.status}: ${loginText.slice(0,500)}`);cookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Stock Clear admin cookie missing');

  const variantBatch=(await api('/api/inventory/batches',{method:'POST',ok:[201],body:{clientId,storeId,name:'QA متغيرات',stockDate:historicDate,note:'QA clear variants',items:[{productId,variantId:variantA,qty:4},{productId,variantId:variantB,qty:6}]}})).data;
  if(!variantBatch.id||Number(variantBatch.totalQty)!==10)throw new Error(`Variant named batch create failed: ${JSON.stringify(variantBatch)}`);
  let variants=await d1('SELECT id,stock FROM product_variants WHERE product_id=? ORDER BY id',[productId]);if(variants.reduce((s,x)=>s+Number(x.stock||0),0)!==10)throw new Error(`Variant stock must total 10 before clear: ${JSON.stringify(variants)}`);
  const cleared=(await api(`/api/inventory/products/${encodeURIComponent(productId)}/clear?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'POST',body:{clientId,storeId}})).data;
  if(Number(cleared.clearedQty)!==10||Number(cleared.variantCount)!==2||Number(cleared.affectedBatches)!==1)throw new Error(`Clear-all result invalid: ${JSON.stringify(cleared)}`);
  variants=await d1('SELECT id,stock FROM product_variants WHERE product_id=? ORDER BY id',[productId]);if(variants.some(x=>Number(x.stock||0)!==0))throw new Error(`All variant stock must be zero after clear: ${JSON.stringify(variants)}`);
  const remaining=await d1('SELECT remaining_qty FROM inventory_batch_items WHERE batch_id=?',[variantBatch.id]);if(remaining.some(x=>Number(x.remaining_qty||0)!==0))throw new Error(`All named batch variant quantities must be zero after clear: ${JSON.stringify(remaining)}`);
  const batchState=(await d1('SELECT status FROM inventory_batches WHERE id=?',[variantBatch.id]))[0];if(batchState?.status!=='depleted')throw new Error(`Cleared variant batch must be depleted: ${JSON.stringify(batchState)}`);
  const clearLog=(await d1("SELECT delta,new_stock,note FROM stock_log WHERE client_id=? AND product_id=? AND note LIKE '%تصفير%' ORDER BY created_at DESC LIMIT 1",[clientId,productId]))[0];if(Number(clearLog?.delta)!==-10||Number(clearLog?.new_stock)!==0)throw new Error(`Clear-all audit log invalid: ${JSON.stringify(clearLog)}`);

  const staleBatch=(await api('/api/inventory/batches',{method:'POST',ok:[201],body:{clientId,storeId,name:'QA رصيد قديم',stockDate:historicDate,note:'QA stale delete reconcile',items:[{productId:staleProductId,qty:5}]}})).data;
  if(!staleBatch.id)throw new Error('Failed to create stale named batch');
  await d1('UPDATE products SET stock=0 WHERE id=? AND client_id=?',[staleProductId,clientId]);
  const staleBefore=(await d1('SELECT remaining_qty FROM inventory_batch_items WHERE batch_id=? AND product_id=?',[staleBatch.id,staleProductId]))[0];if(Number(staleBefore?.remaining_qty)!==5)throw new Error('Stale bug setup failed: named batch must still hold 5 while product counter is zero');
  await api(`/api/products/${encodeURIComponent(staleProductId)}?clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`,{method:'DELETE',ok:[200,204]});
  const staleProduct=await d1('SELECT id FROM products WHERE id=?',[staleProductId]);if(staleProduct.length)throw new Error('Product delete must succeed after automatic stale named-stock reconciliation');
  const staleAfter=(await d1('SELECT remaining_qty FROM inventory_batch_items WHERE batch_id=? AND product_id=?',[staleBatch.id,staleProductId]))[0];if(Number(staleAfter?.remaining_qty)!==0)throw new Error(`Stale named stock must auto-reconcile to zero before delete: ${JSON.stringify(staleAfter)}`);
  const staleBatchState=(await d1('SELECT status FROM inventory_batches WHERE id=?',[staleBatch.id]))[0];if(staleBatchState?.status!=='depleted')throw new Error(`Stale batch must become depleted during delete reconciliation: ${JSON.stringify(staleBatchState)}`);

  console.log('Live Stock Clear QA passed: full variant stock clearing zeros counters + named batches with audit history, and product deletion auto-reconciles stale named stock when the actual product stock is already zero.');
}catch(e){error=e;}finally{await cleanup();}
if(error)throw error;
