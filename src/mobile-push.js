import {handleMobileStoreOptions} from './mobile-store-options.js';

/**
 * FCM is a wake-up hint only. Never include customer/order data in the message.
 * Disabled by default; draft migrations 0100/0101 and FCM credentials required.
 */
const respond=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'
}});
const clean=x=>String(x??'').trim();
const encoder=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const timestamp=()=>new Date().toISOString();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0));
const base64url=b=>b64(b).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const pushEnabled=env=>env?.ORDER_FCM_ENABLED==='1'&&env?.ORDER_CHANGE_FEED_ENABLED==='1';
export const tokenFormatValid=token=>/^[A-Za-z0-9_.:\-]{30,4096}$/.test(token);
export const installFormatValid=id=>/^[A-Za-z0-9_\-]{20,128}$/.test(id);
export const invalidationData=({clientId,storeId,seq})=>({
  kind:'orders_changed',clientId:clean(clientId),storeId:clean(storeId),seq:String(seq)
});
export function shouldNotifyOrderWrite(request,response){
  if(!pushEnabledMarker(request) || !response?.ok)return false;
  const path=new URL(request.url).pathname.toLowerCase();
  return /^\/api\/(orders(?:\/|$)|customer-service(?:\/|$)|jnt(?:\/|$)|jt(?:\/|$))/.test(path)
    || /^\/webhooks?\/easyorders(?:\/|$)/.test(path);
}
function pushEnabledMarker(request){
  return ['POST','PUT','PATCH','DELETE'].includes(request.method);
}
async function tokenKey(secret,usage){
  const hash=await crypto.subtle.digest('SHA-256',encoder.encode('kun-fcm-v1:'+secret));
  return crypto.subtle.importKey('raw',hash,{name:'AES-GCM'},false,usage);
}
async function digest(secret,kind,value){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(kind+'|'+value)));
}
async function encrypt(secret,token){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await tokenKey(secret,['encrypt']);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(token));
  return 'v1:'+b64(iv)+':'+b64(cipher);
}
async function decrypt(secret,encoded){
  const parts=clean(encoded).split(':');
  if(parts.length!==3||parts[0]!=='v1')throw Error('Bad ciphertext');
  const key=await tokenKey(secret,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(parts[1])},key,fromB64(parts[2]));
  return new TextDecoder().decode(plain);
}
async function identity(request,delegate){
  const url=new URL('/api/me',request.url);
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}));
  if(!response.ok)return null;
  const body=await response.json().catch(()=>null);
  const id=clean(body?.uid||body?.id);
  return id&&body?.role?{id,role:clean(body.role),clientId:clean(body.clientId||body.client_id)}:null;
}
async function authorizedStores(request,env,delegate){
  const url=new URL('/api/mobile/store-options',request.url);
  const response=await handleMobileStoreOptions({
    request:new Request(url,{method:'GET',headers:request.headers}),env,delegate
  });
  if(!response?.ok)return null;
  const data=await response.json().catch(()=>null);
  return Array.isArray(data?.stores)?data.stores.filter(s=>clean(s.clientId)&&clean(s.storeId)):null;
}

export async function handleMobilePushDevices({request,env,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/mobile/push-devices')return null;
  if(!pushEnabled(env))return respond({ok:false,code:'PUSH_DISABLED'},404);
  if(!env.DB||!env.PUSH_TOKEN_ENC_KEY||!env.FIREBASE_SERVICE_ACCOUNT_JSON)
    return respond({ok:false,code:'PUSH_NOT_CONFIGURED'},503);
  if(!['POST','DELETE'].includes(request.method))
    return respond({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  const current=await identity(request,delegate);
  if(!current)return respond({ok:false,code:'AUTH_REQUIRED'},401);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>5000) return respond({ok:false,code:'PAYLOAD_TOO_LARGE'},413);
    body=JSON.parse(raw);
  }catch{return respond({ok:false,code:'INVALID_JSON'},400);}
  const installationId=clean(body?.installationId);
  if(!installFormatValid(installationId))return respond({ok:false,code:'INVALID_INSTALLATION'},400);
  const installationHash=await digest(env.PUSH_TOKEN_ENC_KEY,'installation',installationId);
  try{
    if(request.method==='DELETE'){
      await env.DB.prepare('DELETE FROM mobile_push_devices WHERE installation_hash=? AND user_id=?')
        .bind(installationHash,current.id).run();
      return respond({ok:true,revoked:true});
    }
    const token=clean(body?.token);
    if(!tokenFormatValid(token))return respond({ok:false,code:'INVALID_TOKEN'},400);
    const stores=await authorizedStores(request,env,delegate);
    if(stores===null)return respond({ok:false,code:'STORE_SCOPE_UNAVAILABLE'},503);
    if(stores.length>200)return respond({ok:false,code:'TOO_MANY_STORES'},409);
    // No client-supplied store/tenant assignments are accepted.
    const seen=new Set(),valid=[];
    for(const s of stores){
      const clientId=clean(s.clientId),storeId=clean(s.storeId);
      const key=JSON.stringify([clientId,storeId]);
      if(!seen.has(key)){seen.add(key);valid.push({clientId,storeId});}
    }
    const old=await env.DB.prepare('SELECT client_id,store_id,last_seq,token_hash FROM mobile_push_devices WHERE installation_hash=? AND user_id=?')
      .bind(installationHash,current.id).all();
    const existing=new Map((old.results||[]).map(s=>[JSON.stringify([s.client_id,s.store_id]),s]));
    const high=Number((await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM order_change_log').first())?.n||0);
    if(!Number.isSafeInteger(high)||high<0)throw Error('Invalid journal');
    const tokenHash=await digest(env.PUSH_TOKEN_ENC_KEY,'token',token);
    const ciphertext=await encrypt(env.PUSH_TOKEN_ENC_KEY,token);
    const date=timestamp();
    // D1 batch is an atomic transaction. Never delete grants and leave a
    // partially registered installation after a write failure.
    const statements=[env.DB.prepare('DELETE FROM mobile_push_devices WHERE installation_hash=?')
      .bind(installationHash)];
    for(const {clientId,storeId} of valid){
      const oldRow=existing.get(JSON.stringify([clientId,storeId]));
      const last=oldRow?.token_hash===tokenHash?Math.min(high,Number(oldRow.last_seq)||0):high;
      const id=await digest(env.PUSH_TOKEN_ENC_KEY,'row',installationHash+'|'+clientId+'|'+storeId);
      statements.push(env.DB.prepare(`INSERT INTO mobile_push_devices
        (id,installation_hash,user_id,client_id,store_id,token_hash,token_ciphertext,last_seq,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,installationHash,current.id,clientId,storeId,
        tokenHash,ciphertext,last,date,date));
    }
    await env.DB.batch(statements);
    return respond({ok:true,storeCount:valid.length});
  }catch{
    // Missing migration or unavailable D1 is a hard failure, never a fake
    // successful registration. Do not leak token, credentials or SQL errors.
    return respond({ok:false,code:'PUSH_STORAGE_UNAVAILABLE'},503);
  }
}

function serviceAccount(env){
  const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||'{}');
  if(!/^[a-z0-9-]{4,80}$/.test(clean(account.project_id))||
     !/^[\w.+-]+@[\w.-]+$/.test(clean(account.client_email))||
     !clean(account.private_key).includes('BEGIN PRIVATE KEY'))throw Error('Invalid service account');
  return account;
}
// Per-isolate short-lived cache: avoid signing OAuth JWT for every order
// update in a burst. Only cached for real fetch; injected test transports
// remain isolated, and the expiry has a safety margin.
let oauthCache=null;
async function accessToken(account,http){
  if(http===fetch&&oauthCache?.project===account.project_id&&
     oauthCache.expiresAt>Date.now()+60_000)return oauthCache.value;
  const pem=account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',fromB64(pem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const epoch=Math.floor(Date.now()/1000);
  const segments=[
    base64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),
    base64url(encoder.encode(JSON.stringify({iss:account.client_email,
      scope:'https://www.googleapis.com/auth/firebase.messaging',
      aud:'https://oauth2.googleapis.com/token',iat:epoch,exp:epoch+3500})))
  ];
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(segments.join('.')));
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:segments.join('.')+'.'+base64url(signature)});
  const res=await http('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  if(!res.ok)throw Error('OAuth token request failed');
  const result=await res.json();
  if(!result.access_token)throw Error('Missing OAuth access token');
  if(http===fetch){
    const seconds=Number(result.expires_in)||3600;
    oauthCache={project:account.project_id,value:result.access_token,
      expiresAt:Date.now()+Math.max(60,Math.min(3300,seconds-120))*1000};
  }
  return result.access_token;
}

export async function sendFcmInvalidation({account,accessTokenValue,token,scope,http=fetch}){
  const message={message:{token,data:invalidationData(scope),android:{
    priority:'HIGH',ttl:'60s',collapse_key:'kun_orders_changed'
  }}};
  const result=await http('https://fcm.googleapis.com/v1/projects/'+account.project_id+'/messages:send',{
    method:'POST',headers:{Authorization:'Bearer '+accessTokenValue,'Content-Type':'application/json'},
    body:JSON.stringify(message)
  });
  if(result.ok)return {ok:true,unregistered:false};
  const error=await result.json().catch(()=>({}));
  const dead=Array.isArray(error?.error?.details)&&error.error.details.some(x=>
    x?.errorCode==='UNREGISTERED'
  );
  return {ok:false,unregistered:dead};
}
async function stillAllowed(db,row){
  const user=await db.prepare('SELECT id,client_id,role,status FROM users WHERE id=?').bind(row.user_id).first();
  if(!user||user.status!=='active')return false;
  const store=await db.prepare("SELECT id FROM stores WHERE id=? AND client_id=? AND status='active'")
    .bind(row.store_id,row.client_id).first();
  if(!store)return false;
  if(user.role==='client'||user.role==='admin')return user.client_id===row.client_id;
  const grant=await db.prepare('SELECT 1 AS ok FROM user_store_access WHERE user_id=? AND client_id=? AND store_id=?')
    .bind(row.user_id,row.client_id,row.store_id).first();
  return !!grant?.ok;
}
export async function dispatchOrderChangePush(env,{http=fetch,limit=50,immediate=false}={}){
  if(!pushEnabled(env)||!env.DB||!env.PUSH_TOKEN_ENC_KEY||!env.FIREBASE_SERVICE_ACCOUNT_JSON)
    return {enabled:false,sent:0};
  const account=serviceAccount(env);
  const due=timestamp(),metrics={enabled:true,checked:0,sent:0,revoked:0,failed:0};
  const maxDevices=Math.min(100,Math.max(1,limit));
  const dueQuery=immediate
    ? "SELECT * FROM mobile_push_devices ORDER BY COALESCE(last_attempt_at,'') ASC LIMIT ?"
    : "SELECT * FROM mobile_push_devices WHERE retry_after IS NULL OR retry_after<=? ORDER BY COALESCE(last_attempt_at,'') ASC LIMIT ?";
  const rows=(await env.DB.prepare(dueQuery)
    .bind(...(immediate?[maxDevices]:[due,maxDevices])).all()).results||[];
  let auth=null;
  for(const row of rows){
    metrics.checked++;
    const next=new Date(Date.now()+60_000).toISOString();
    const update=async seq=>env.DB.prepare(
      'UPDATE mobile_push_devices SET last_seq=?,last_attempt_at=?,retry_after=? WHERE id=? AND last_seq<?'
    ).bind(seq,due,next,row.id,seq).run();
    try{
      if(!await stillAllowed(env.DB,row)){
        await env.DB.prepare('DELETE FROM mobile_push_devices WHERE id=?').bind(row.id).run();
        metrics.revoked++;continue;
      }
      const changed=await env.DB.prepare(
        'SELECT MAX(seq) AS n FROM order_change_log WHERE client_id=? AND store_id=? AND seq>?'
      ).bind(row.client_id,row.store_id,row.last_seq).first();
      const seq=Number(changed?.n||0);
      if(!seq){
        await env.DB.prepare('UPDATE mobile_push_devices SET last_attempt_at=?,retry_after=? WHERE id=?')
          .bind(due,next,row.id).run();
        continue;
      }
      if(!auth)auth=await accessToken(account,http);
      const token=await decrypt(env.PUSH_TOKEN_ENC_KEY,row.token_ciphertext);
      const status=await sendFcmInvalidation({
        account,accessTokenValue:auth,token,
        scope:{clientId:row.client_id,storeId:row.store_id,seq},http
      });
      if(status.ok){await update(seq);metrics.sent++;}
      else if(status.unregistered){
        await env.DB.prepare('DELETE FROM mobile_push_devices WHERE id=?').bind(row.id).run();
        metrics.revoked++;
      }else{
        metrics.failed++;
        await env.DB.prepare('UPDATE mobile_push_devices SET last_attempt_at=?,retry_after=? WHERE id=?')
          .bind(due,new Date(Date.now()+120_000).toISOString(),row.id).run();
      }
    }catch{
      metrics.failed++;
      await env.DB.prepare('UPDATE mobile_push_devices SET last_attempt_at=?,retry_after=? WHERE id=?')
        .bind(due,new Date(Date.now()+120_000).toISOString(),row.id).run().catch(()=>{});
    }
  }
  // Delivers on the existing cron only; not a claim of instant FCM delivery.
  return metrics;
}
