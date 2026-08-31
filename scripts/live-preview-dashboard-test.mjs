import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-dashboard-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Dashboard QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex'),email=`qa-dashboard-${nonce}@example.test`,userId=`QA-DASH-${nonce}`,password=`Dashboard!${randomBytes(12).toString('hex')}Aa1`;
let cookie='';

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});const p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,800)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function api(path,ok=[200]){const r=await fetch(`${base}${path}`,{headers:{...(cookie?{Cookie:cookie}:{})}}),txt=await r.text();let data={};try{data=JSON.parse(txt)}catch{data={raw:txt}}if(!ok.includes(r.status))throw new Error(`GET ${path} expected ${ok.join('/')}, got ${r.status}: ${txt.slice(0,1200)}`);return {status:r.status,data};}
async function cleanup(){try{await d1('DELETE FROM login_attempts WHERE email=?',[email])}catch{}try{await d1('DELETE FROM users WHERE email=?',[email])}catch{}}
function finite(value,label){if(!Number.isFinite(Number(value)))throw new Error(`Dashboard ${label} must be numeric; got ${JSON.stringify(value)}`);}
function assertShape(data,label){
  if(data?.ok!==true)throw new Error(`${label}: dashboard ok flag missing`);
  for(const key of ['overview','finance','ads','rates','provinces','recommendations','trend'])if(data[key]===undefined)throw new Error(`${label}: missing ${key}`);
  for(const key of ['totalOrders','actualOrderCost','expectedRevenue','expectedProfit','profitMargin','adSpend','otherExpenses'])finite(data.overview?.[key],`${label}.overview.${key}`);
  for(const key of ['periodOrders','allOrders','customerServiceActive'])finite(data.overview?.[key],`${label}.overview.${key}`);
  for(const key of ['expenses','grossProfit','productCost','revenue','netProfit'])finite(data.finance?.[key],`${label}.finance.${key}`);
  for(const key of ['systemCpp','cpc','cpm','cac','ctr','platformRoas','realRoas','cpa'])finite(data.ads?.[key],`${label}.ads.${key}`);
  for(const w of ['d7','d30'])for(const key of ['confirmationRate','deliveryRate','returnRate','returnOfShippedRate'])finite(data.rates?.[w]?.[key],`${label}.rates.${w}.${key}`);
  if(!Array.isArray(data.provinces)||!Array.isArray(data.recommendations)||!Array.isArray(data.trend?.points))throw new Error(`${label}: dashboard list shape invalid`);
  if(!['day','week','month'].includes(data.trend?.granularity))throw new Error(`${label}: invalid trend granularity ${data.trend?.granularity}`);
  if(!data.overview?.details?.actualOrderCost||!data.overview?.details?.expectedRevenue||!data.overview?.details?.margin||!data.overview?.details?.orders)throw new Error(`${label}: KPI drill-down details missing`);
  if(data.orderCountSemantics?.canonical!==true)throw new Error(`${label}: canonical order-count semantics missing`);
}
function cairoToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>parts.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
function addDays(date,delta){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);}
async function checkRange(candidate,from,to,label){const q=`clientId=${encodeURIComponent(candidate.client_id)}&storeId=${encodeURIComponent(candidate.store_id)}`,data=(await api(`/api/dashboard?${q}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).data;assertShape(data,label);if(data.from!==from||data.to!==to)throw new Error(`${label}: range mismatch ${data.from}..${data.to}, expected ${from}..${to}`);return data;}
async function canonicalCounts(candidate){const rows=await d1(`SELECT COUNT(*) total,SUM(CASE WHEN state IN ('pending','confirmed','preparing','shipped','deferred') THEN 1 ELSE 0 END) customer_service_active FROM orders WHERE client_id=? AND store_id=?`,[candidate.client_id,candidate.store_id]);return {total:Number(rows[0]?.total)||0,customerServiceActive:Number(rows[0]?.customer_service_active)||0};}
function assertCanonical(data,counts,label){if(Number(data.overview.totalOrders)!==counts.total||Number(data.overview.allOrders)!==counts.total)throw new Error(`${label}: dashboard total ${data.overview.totalOrders}/${data.overview.allOrders} does not match Orders D1 count ${counts.total}`);if(Number(data.overview.customerServiceActive)!==counts.customerServiceActive)throw new Error(`${label}: dashboard Customer Service active count ${data.overview.customerServiceActive} does not match D1 ${counts.customerServiceActive}`);}

let error=null;
try{
  await cleanup();
  let candidates=await d1("SELECT s.client_id,s.id store_id,COUNT(o.id) order_count FROM stores s LEFT JOIN orders o ON o.client_id=s.client_id AND o.store_id=s.id WHERE s.status='active' GROUP BY s.client_id,s.id ORDER BY order_count DESC,s.created_at LIMIT 8");
  if(!candidates.length)candidates=await d1("SELECT client_id,id store_id,0 order_count FROM stores WHERE status='active' ORDER BY created_at LIMIT 1");
  if(!candidates[0]?.client_id||!candidates[0]?.store_id)throw new Error('No active Preview store available for Dashboard live QA');
  const hash=await hashPassword(password),ts=new Date().toISOString();await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'CI Dashboard Admin',hash,'admin','active',ts]);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const loginText=await login.text();if(!login.ok)throw new Error(`Dashboard admin login failed ${login.status}: ${loginText.slice(0,500)}`);cookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Dashboard admin cookie missing');
  const today=cairoToday(),weekFrom=addDays(today,-6),monthFrom=addDays(today,-29);
  for(const [i,candidate] of candidates.entries()){
    const counts=await canonicalCounts(candidate);
    const daily=await checkRange(candidate,today,today,`store-${i+1}-daily`);
    const weekly=await checkRange(candidate,weekFrom,today,`store-${i+1}-7d`);
    const monthly=await checkRange(candidate,monthFrom,today,`store-${i+1}-30d`);
    assertCanonical(daily,counts,`store-${i+1}-daily`);assertCanonical(weekly,counts,`store-${i+1}-7d`);assertCanonical(monthly,counts,`store-${i+1}-30d`);
    if(Number(weekly.overview.periodOrders)>Number(monthly.overview.periodOrders))throw new Error(`store-${i+1}: 7-day period order count cannot exceed 30-day count`);
    if(Number(daily.overview.periodOrders)>Number(weekly.overview.periodOrders))throw new Error(`store-${i+1}: daily period order count cannot exceed 7-day count`);
  }
  const candidate=candidates[0],q=`clientId=${encodeURIComponent(candidate.client_id)}&storeId=${encodeURIComponent(candidate.store_id)}`;
  const all=(await api(`/api/dashboard?${q}&from=beginning&to=${today}`)).data;assertShape(all,'all-time');assertCanonical(all,await canonicalCounts(candidate),'all-time');if(!/^\d{4}-\d{2}-\d{2}$/.test(String(all.from||''))||all.from>today)throw new Error(`All-time dashboard did not resolve a real first date: ${all.from}`);
  await api(`/api/dashboard?${q}&from=${today}&to=2026-01-01`,[400]);
  console.log(`Live Dashboard QA passed across ${candidates.length} active Preview store(s): dashboard total equals canonical Orders D1 count, Customer Service active count matches operational states, period counts remain date-scoped, plus KPI/finance/ads/rates/provinces/AI/trend checks.`);
}catch(e){error=e;}finally{await cleanup();}
if(error)throw error;
await import('./live-preview-inventory-test.mjs');
await import('./live-preview-order-sheet-import-test.mjs');