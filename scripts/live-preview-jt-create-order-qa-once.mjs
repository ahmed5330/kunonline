import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'https://kunonline-preview.mr-a-mnaa.workers.dev').replace(/\/$/,'');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Cloudflare Preview credentials are required');

const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function d1(sql,params=[]){
  const response=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({}));
  const result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Preview D1 query failed (${response.status}): ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,900)}`);
  return result?.results||[];
}
async function safeD1(sql,params=[]){try{return await d1(sql,params);}catch{return [];}}
async function hashPassword(value){
  const salt=randomBytes(16);
  const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}
function cairoDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

const connections=await d1("SELECT id,client_id,status FROM store_connections WHERE provider='jt' ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'configured' THEN 1 ELSE 2 END,updated_at DESC,created_at DESC LIMIT 1");
if(!connections.length)throw new Error('No J&T connection exists in Preview');
const connection=connections[0];
const nonce=randomBytes(5).toString('hex');
const orderId=`QA-JT-${Date.now()}-${nonce}`;
const orderRef=`QA-JT-${Date.now()}`;
const email=`qa-jt-create-${nonce}@example.test`;
const userId=`QA-JT-CREATE-${nonce}`;
const password=`JtCreate!${randomBytes(12).toString('hex')}Aa1`;
const now=new Date().toISOString();
let storeId='';
let keepOrder=false;
let logged=false;

try{
  const orderSchema=await d1('PRAGMA table_info(orders)');
  const columns=new Set(orderSchema.map(row=>String(row.name)));
  if(columns.has('store_id')){
    const storeRows=await safeD1('SELECT id FROM stores WHERE client_id=? ORDER BY created_at ASC LIMIT 1',[connection.client_id]);
    storeId=String(storeRows?.[0]?.id||'');
    if(!storeId){
      const prior=await safeD1("SELECT store_id FROM orders WHERE client_id=? AND store_id IS NOT NULL AND TRIM(store_id)<>'' ORDER BY created_at DESC LIMIT 1",[connection.client_id]);
      storeId=String(prior?.[0]?.store_id||'');
    }
  }

  const values={
    id:orderId,client_id:connection.client_id,store_id:storeId||null,ref:orderRef,date:cairoDate(),name:'Kun Online J&T QA',phone:'01000000000',gov:'القاهرة',address:'مدينة نصر، الحي السابع، شارع الاختبار 1',product:'QA Test Parcel',qty:1,total:1,source:'qa_jt_live',note:'ONE-TIME PREVIEW J&T QA — DO NOT FULFILL',awb:null,state:'confirmed',checkpoint:'QA J&T Create Order test',contact_log:'[]',history:JSON.stringify([{state:'confirmed',at:now,type:'qa_jt_create_test'}]),created_at:now
  };
  const insertCols=Object.keys(values).filter(key=>columns.has(key));
  const missingRequired=orderSchema.filter(row=>Number(row.notnull)===1&&row.dflt_value==null&&!insertCols.includes(String(row.name))&&Number(row.pk)!==1).map(row=>String(row.name));
  if(missingRequired.length)throw new Error(`QA order insert missing required columns: ${missingRequired.join(', ')}`);
  await d1(`INSERT INTO orders (${insertCols.join(',')}) VALUES (${insertCols.map(()=>'?').join(',')})`,insertCols.map(key=>values[key]));

  await d1('DELETE FROM login_attempts WHERE email=?',[email]).catch(()=>{});
  await d1('DELETE FROM users WHERE email=?',[email]).catch(()=>{});
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'J&T Create Order QA',await hashPassword(password),'admin','active',now]);

  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(20000)});
  const loginText=await login.text();
  if(!login.ok)throw new Error(`Preview login failed ${login.status}: ${loginText.slice(0,400)}`);
  const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
  if(!cookie)throw new Error('Preview login did not return a session cookie');
  logged=true;

  const requestBody={
    clientId:connection.client_id,
    ...(storeId?{storeId}:{}),
    customerOrderNo:orderRef,
    receiverName:'Kun Online QA',
    receiverPhone:'01000000000',
    countryCode:'EGY',
    province:'القاهرة',
    city:'مدينة نصر',
    area:'الحي السابع',
    street:'شارع الاختبار 1',
    itemName:'QA Test Parcel',
    itemType:'Goods',
    weight:0.1,
    quantity:1,
    codAmount:1,
    currency:'EGP',
    notes:'ONE-TIME PREVIEW J&T QA — DO NOT FULFILL'
  };

  let status=0,text='',timedOut=false;
  try{
    const response=await fetch(`${base}/api/jt/shipments/${encodeURIComponent(orderId)}`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(90000)});
    status=response.status;text=await response.text();
  }catch(error){timedOut=error?.name==='TimeoutError'||error?.name==='AbortError';text=`${error?.name||'Error'}: ${error?.message||error}`;}

  if(timedOut){await sleep(5000);}
  const orderRows=await d1('SELECT id,state,awb,checkpoint FROM orders WHERE id=? AND client_id=?',[orderId,connection.client_id]);
  const current=orderRows[0]||{};
  const errorRows=await safeD1('SELECT last_error FROM store_connections WHERE id=? AND client_id=?',[connection.id,connection.client_id]);
  const lastError=String(errorRows?.[0]?.last_error||'');
  const hasAwb=Boolean(String(current.awb||'').trim());
  keepOrder=hasAwb||timedOut;

  console.log('JT_CREATE_QA_ORDER_ID',orderId);
  console.log('JT_CREATE_QA_HTTP',status||'NO_HTTP_RESPONSE');
  console.log('JT_CREATE_QA_RESPONSE',text.slice(0,4000));
  console.log('JT_CREATE_QA_AWB',current.awb||'');
  console.log('JT_CREATE_QA_STATE',current.state||'');
  console.log('JT_CREATE_QA_LAST_ERROR',lastError.slice(0,2000));
  console.log('JT_CREATE_QA_RESULT',hasAwb?'AWB_CREATED':timedOut?'TIMEOUT_UNCERTAIN':status>=200&&status<300?'HTTP_SUCCESS_NO_AWB':'JNT_REJECTED_OR_APP_ERROR');

  if(hasAwb){
    await d1('UPDATE orders SET checkpoint=?,note=? WHERE id=? AND client_id=?',['QA J&T shipment created — cancel/test only','ONE-TIME PREVIEW J&T QA — TEST SHIPMENT; DO NOT FULFILL',orderId,connection.client_id]).catch(()=>{});
  }
}finally{
  if(logged||email){await d1('DELETE FROM login_attempts WHERE email=?',[email]).catch(()=>{});await d1('DELETE FROM users WHERE email=?',[email]).catch(()=>{});}
  if(!keepOrder)await d1('DELETE FROM orders WHERE id=? AND client_id=?',[orderId,connection.client_id]).catch(()=>{});
}
