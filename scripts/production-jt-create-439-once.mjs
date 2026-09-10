import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=String(process.env.PROD_BASE||'https://app.kun-online.com').replace(/\/$/,'');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Cloudflare credentials are required');
const config=await readFile(new URL('../wrangler.production.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Production database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const resultPath=process.env.RESULT_PATH||'/tmp/jt-result.json';
const tempId=`QA-PROD-JT-${Date.now()}-${randomBytes(3).toString('hex')}`;
const email=`qa-prod-jt-${Date.now()}-${randomBytes(4).toString('hex')}@example.test`;
const password=`ProdJt!${randomBytes(18).toString('hex')}Aa1`;
let cookie='';

async function d1(sql,params=[]){
  const response=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({}));
  const result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Production D1 query failed (${response.status})`);
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
  const text=await response.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text.slice(0,200)}}
  if(!ok.includes(response.status)){const code=String(data?.code||'HTTP_ERROR');throw Object.assign(new Error(`${method} ${path.split('?')[0]} failed (${response.status}/${code})`),{httpStatus:response.status,code,data});}
  return {response,data};
}
function clean(value){return String(value??'').trim();}
function orderData(details={},fallback={}){
  const o=details.order||{},c=details.customer||{},a=details.address||{},s=details.summary||{},items=Array.isArray(details.items)?details.items:[],first=items[0]||{};
  return {
    ref:clean(o.ref||o.reference||o.orderNumber||o.id||fallback.id),
    name:clean(c.name||o.name),phone:clean(c.phone||o.phone),phone2:clean(c.phone2||c.secondaryPhone),
    province:clean(a.government||a.governorate||o.gov),city:clean(a.city),area:clean(a.area||a.district),street:clean(a.street||a.address||o.address),
    itemName:clean(items.map(x=>x.name||x.productName).filter(Boolean).join(' + ')||first.name||o.product||'Goods'),
    quantity:Number(s.quantity)||items.reduce((n,x)=>n+(Number(x.quantity)||1),0)||Number(o.qty)||1,
    total:Number(s.total??o.total??fallback.total)||0,
    storeId:clean(fallback.store_id||o.storeId),
    note:clean([o.productNote,o.customerNote].filter(Boolean).join(' — '))
  };
}
async function selectTarget(){
  const failedConnections=await d1("SELECT client_id FROM store_connections WHERE provider='jt' AND lower(COALESCE(last_error,'')) LIKE '%customer code is illegal%' ORDER BY updated_at DESC LIMIT 3");
  const preferred=clean(failedConnections[0]?.client_id);
  const params=preferred?[preferred]:[];
  const scope=preferred?' AND client_id=?':'';
  const candidates=await d1(`SELECT id,client_id,store_id,total,state,awb FROM orders WHERE state='confirmed' AND (awb IS NULL OR trim(awb)='') AND abs(CAST(total AS REAL)-439.0)<0.001${scope} ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 3`,params);
  if(candidates.length!==1)throw Object.assign(new Error(`Target guard stopped: expected exactly one confirmed/unshipped 439 EGP order, found ${candidates.length}. No J&T request was sent.`),{code:'TARGET_NOT_UNIQUE'});
  return candidates[0];
}

let target=null;
try{
  target=await selectTarget();
  const hash=await hashPassword(password);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[tempId,email,'Production J&T one-shot',hash,'admin','active',new Date().toISOString()]);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const loginText=await login.text();if(!login.ok)throw new Error(`Temporary admin login failed (${login.status})`);
  cookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw new Error('Temporary admin login returned no session cookie');

  const q=`clientId=${encodeURIComponent(target.client_id)}${target.store_id?`&storeId=${encodeURIComponent(target.store_id)}`:''}`;
  const details=(await api(`/api/orders/${encodeURIComponent(target.id)}/details?${q}`)).data;
  const d=orderData(details,target);
  const required=['ref','name','phone','province','city','area','street','itemName','storeId'];
  const missing=required.filter(k=>!clean(d[k]));
  if(missing.length)throw Object.assign(new Error(`Shipping data guard stopped before J&T: missing ${missing.join(', ')}. No carrier request was sent.`),{code:'SHIPPING_FIELDS_MISSING',missing});
  if(Math.abs(d.total-439)>0.001)throw new Error('COD guard failed: target total changed from 439');

  const body={clientId:target.client_id,storeId:d.storeId,receiverName:d.name,countryCode:'+20',receiverPhone:d.phone,receiverPhone2:d.phone2,province:d.province,city:d.city,area:d.area,street:d.street,customerOrderNo:d.ref,itemType:'Other',itemName:d.itemName,weight:1,quantity:d.quantity,productType:'Standard',currency:'EGP',codAmount:439,insured:'No',pickupInfo:'',notes:d.note};
  const created=(await api(`/api/jt/shipments/${encodeURIComponent(target.id)}?${q}`,{method:'POST',body,ok:[200,201]})).data;
  if(!created?.ok||!clean(created.awb))throw new Error('J&T route returned no AWB');
  const persisted=(await d1('SELECT state,awb FROM orders WHERE id=? AND client_id=?',[target.id,target.client_id]))[0];
  if(clean(persisted?.awb)!==clean(created.awb))throw new Error('Production persistence guard failed: AWB mismatch');
  await writeFile(resultPath,JSON.stringify({ok:true,orderId:target.id,awb:created.awb,sortingCode:created.sortingCode||'',state:persisted?.state||created.state||'',idempotent:Boolean(created.idempotent),stateHandoffPending:Boolean(created.stateHandoffPending)},null,2));
  console.log(`Production J&T one-shot succeeded. AWB persisted; state=${persisted?.state||created.state||'unknown'}.`);
}catch(error){
  await writeFile(resultPath,JSON.stringify({ok:false,code:error?.code||'PRODUCTION_JT_ONESHOT_FAILED',message:String(error?.message||error).slice(0,500),missing:Array.isArray(error?.missing)?error.missing:undefined},null,2)).catch(()=>{});
  throw error;
}finally{
  await d1('DELETE FROM login_attempts WHERE email=?',[email]).catch(()=>{});
  await d1('DELETE FROM users WHERE id=?',[tempId]).catch(()=>{});
}
