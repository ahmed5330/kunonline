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
async function api(path,{method='GET',body,ok=[200]}={}){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),txt=await r.text();let data={};try{data=JSON.parse(txt)}catch{data={raw:txt}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${txt.slice(0,900)}`);return {status:r.status,data};}
async function cleanup(){for(const [sql,params] of [
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

  console.log('Live Inventory QA passed: user-selected stock date, Cairo-today default, visible history, actual entry timestamp separation, store scope and invalid-date no-mutation guard.');
}catch(e){error=e;}finally{await cleanup();}
if(error)throw error;
