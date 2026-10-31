import {handleMobileStoreOptions} from './mobile-store-options.js';

/**
 * Authenticated durable *invalidation* feed (not a customer-data API).
 * Requires reviewed migration 0100. Consumers re-read the existing
 * authoritative endpoints before showing an order or confirming a mutation.
 * No fallback to an "unchanged" result when the schema is missing.
 */
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
  'Vary':'Cookie, Authorization'
}});
const clean=x=>String(x??'').trim();
const MAX_STORES=200, PAGE=50, CHUNK=40;
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');

async function signer(secret){
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
}
async function signature(key,scope,seq){
  return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`v1|\${scope}|\${seq}`)));
}
function validSeq(value){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0;
}
function scopesFromOptions(data){
  const seen=new Set(),stores=[];
  for(const item of (Array.isArray(data.stores)?data.stores:[])){
    const clientId=clean(item.clientId),storeId=clean(item.storeId);
    if(!clientId||!storeId)continue;
    const key=JSON.stringify([clientId,storeId]);
    if(!seen.has(key)){seen.add(key);stores.push({clientId,storeId});}
  }
  return stores.sort((a,b)=>a.clientId.localeCompare(b.clientId)||a.storeId.localeCompare(b.storeId));
}
async function authenticatedScopes({request,env,delegate}){
  const authUrl=new URL(request.url);
  authUrl.pathname='/api/mobile/store-options';
  authUrl.search='';
  const res=await handleMobileStoreOptions({
    request:new Request(authUrl,{method:'GET',headers:request.headers}),env,delegate
  });
  if(!res||!res.ok)return {response:res||json({ok:false,code:'SCOPE_AUTH_UNAVAILABLE'},503)};
  const body=await res.json();
  if(!body.ok)return {response:json({ok:false,code:'SCOPE_AUTH_UNAVAILABLE'},503)};
  const stores=scopesFromOptions(body);
  if(stores.length>MAX_STORES)return {response:json({ok:false,code:'SYNC_TOO_MANY_STORES'},503)};
  const wantedClient=clean(new URL(request.url).searchParams.get('clientId'));
  const wantedStore=clean(new URL(request.url).searchParams.get('storeId'));
  // Never treat a caller-provided tenant/store identifier as an access grant.
  const selected=stores.filter(s=>(!wantedClient||s.clientId===wantedClient)&&(!wantedStore||s.storeId===wantedStore));
  if((wantedClient||wantedStore)&&!selected.length)
    return {response:json({ok:false,code:'STORE_ACCESS_DENIED'},403)};
  return {stores:selected};
}
function normalizedRow(x){
  return {seq:Number(x.seq),clientId:clean(x.client_id),storeId:clean(x.store_id),
    orderId:clean(x.order_id),operation:clean(x.operation)};
}
export async function handleMobileOrderChanges({request,env,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/mobile/order-changes')return null;
  if(request.method!=='GET')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  const result=await authenticatedScopes({request,env,delegate});
  if(result.response)return result.response;
  const stores=result.stores;
  const secret=clean(env.SESSION_SECRET);
  if(!secret||!env.DB)return json({ok:false,code:'SYNC_NOT_CONFIGURED'},503);
  const key=await signer(secret);
  const identity=JSON.stringify([request.headers.get('Cookie'),request.headers.get('Authorization'),
    request.headers.get('X-Kun-Mobile'),stores]);
  const scope=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)));
  const token=url.searchParams.get('cursor')||'';
  if(token.length>220)return json({ok:false,code:'INVALID_CURSOR'},400);
  try{
    // Read high-water mark FIRST. New commits after it belong to the next poll.
    const max=Number((await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM order_change_log').first())?.n||0);
    const min=Number((await env.DB.prepare('SELECT COALESCE(MIN(seq),0) AS n FROM order_change_log').first())?.n||0);
    if(!validSeq(max)||!validSeq(min))return json({ok:false,code:'SYNC_BAD_JOURNAL'},503);
    const cursorFor=async seq=>`v1.${seq}.${await signature(key,scope,seq)}`;
    const reset=async()=>json({ok:true,protocol:1,mode:'reset',cursor:await cursorFor(max),
      // Force a full server-verified state read. A snapshot MUST succeed before
      // the mobile client is allowed to commit this cursor.
      resetRequired:true,changes:[]});
    if(!token)return reset();
    const match=/^v1\.(0|[1-9]\d*)\.([a-f0-9]{64})$/.exec(token);
    if(!match||!validSeq(match[1])||await signature(key,scope,Number(match[1]))!==match[2])
      return reset(); // includes session/tenant/store ACL changes
    const after=Number(match[1]);
    if(after>max || (min&&after<min-1))return reset();
    if(after===max||!stores.length)
      return json({ok:true,protocol:1,mode:'unchanged',cursor:await cursorFor(max),changes:[],hasMore:false});
    const results=[];
    for(let i=0;i<stores.length;i+=CHUNK){
      const chunk=stores.slice(i,i+CHUNK);
      const conditions=chunk.map(()=>'(client_id=? AND store_id=?)').join(' OR ');
      const sql=`SELECT seq,client_id,store_id,order_id,operation FROM order_change_log
        WHERE seq>? AND seq<=? AND (${conditions}) ORDER BY seq ASC LIMIT ${PAGE+1}`;
      const binds=[after,max,...chunk.flatMap(x=>[x.clientId,x.storeId])];
      const page=await env.DB.prepare(sql).bind(...binds).all();
      results.push(...(page.results||[]).map(normalizedRow));
    }
    results.sort((a,b)=>a.seq-b.seq);
    const changes=results.slice(0,PAGE);
    const hasMore=results.length>PAGE;
    const next=hasMore?changes.at(-1).seq:max;
    return json({ok:true,protocol:1,mode:changes.length?'changes':'unchanged',
      cursor:await cursorFor(next),changes,hasMore});
  }catch(_e){
    // Missing/unapplied migration -> 503; never make a client silently miss orders.
    return json({ok:false,code:'SYNC_JOURNAL_UNAVAILABLE',resetRequired:true},503);
  }
}
