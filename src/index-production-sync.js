import app from './index.js';

const BUILD='production-sync-free-tier-safe-2026-09-06';
const SHORT_ORDER_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/short/';
const ORDER_BY_ID_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/';
const MAX_REQUESTS_PER_RUN=30;
const MAX_REQUESTS_PER_CLIENT=10;
const IMMEDIATE_WINDOW=10;
const FAR_WINDOW=20;
const MAX_FAR_OFFSET=210;

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Sync-Build':BUILD}});
const text=v=>String(v??'').trim();
const positiveInt=v=>{const n=Math.floor(Number(v));return Number.isFinite(n)&&n>0?n:0;};
const toB64=bytes=>btoa(String.fromCharCode(...bytes));
const fromB64=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));

async function encKeyFrom(env){
  if(!env.TOKEN_ENC_KEY)return null;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.TOKEN_ENC_KEY));
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['decrypt']);
}
async function decryptSecret(value,env){
  if(!value||!String(value).startsWith('enc$'))return value;
  const parts=String(value).split('$');if(parts.length!==3)return null;
  const key=await encKeyFrom(env);if(!key)return null;
  try{
    const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(parts[1])},key,fromB64(parts[2]));
    return new TextDecoder().decode(buf);
  }catch{return null;}
}
function parseState(row){try{return JSON.parse(row?.json||'{}')}catch{return {};}}
async function rawState(env){return parseState(await env.DB.prepare('SELECT json FROM state WHERE id=1').first());}
function providerSaysMissing(data){
  const message=text(typeof data==='string'?data:(data?.message||data?.error||data?.detail)).toLowerCase();
  return message.includes('record not found')||message==='not found'||message.includes('order not found');
}
async function easyGet(url,apiKey){
  const response=await fetch(url,{method:'GET',headers:{Accept:'application/json','Api-Key':apiKey}});
  if(response.status===429)return {kind:'rate_limited',status:429,data:null};
  const raw=await response.text().catch(()=>''),data=(()=>{if(!raw)return null;try{return JSON.parse(raw)}catch{return raw}})();
  if(response.status===404||providerSaysMissing(data))return {kind:'missing',status:response.status,data:null};
  if(!response.ok){const error=new Error((typeof data==='string'?data:null)||data?.message||data?.error||`Easy Orders HTTP ${response.status}`);error.status=response.status;throw error;}
  return {kind:'found',status:response.status,data};
}
async function fetchById(apiKey,id){return easyGet(`${ORDER_BY_ID_BASE}${encodeURIComponent(text(id))}`,apiKey);}
async function fetchByShort(apiKey,id){return easyGet(`${SHORT_ORDER_BASE}${encodeURIComponent(String(id))}`,apiKey);}

async function latestEasyOrdersRows(env,clientId){
  const {results=[]}=await env.DB.prepare("SELECT id,date,created_at FROM orders WHERE client_id=? AND source='المتجر (إيزي أوردرز)' ORDER BY created_at DESC LIMIT 5").bind(clientId).all();
  return results;
}
async function ingestViaExistingWebhook(env,order){
  const headers={'Content-Type':'application/json'};
  if(env.EASYORDERS_WEBHOOK_SECRET)headers.secret=env.EASYORDERS_WEBHOOK_SECRET;
  const request=new Request('https://production.internal/webhooks/easyorders',{method:'POST',headers,body:JSON.stringify(order)});
  const response=await app.fetch(request,env,{}),body=await response.clone().json().catch(()=>({}));
  if(!response.ok)throw new Error(`Production webhook ingest failed HTTP ${response.status}: ${JSON.stringify(body).slice(0,300)}`);
  return body;
}
async function existingOrder(env,id){return env.DB.prepare('SELECT id FROM orders WHERE id=? LIMIT 1').bind(text(id)).first();}

function nextFarOffset(previous,found){
  if(found)return IMMEDIATE_WINDOW;
  const current=Math.max(IMMEDIATE_WINDOW,positiveInt(previous)||IMMEDIATE_WINDOW);
  return current>=MAX_FAR_OFFSET?IMMEDIATE_WINDOW:current+FAR_WINDOW;
}
function scanIds(base,farOffset){
  const ids=[];
  for(let i=1;i<=IMMEDIATE_WINDOW;i++)ids.push(base+i);
  const start=Math.max(IMMEDIATE_WINDOW,positiveInt(farOffset)||IMMEDIATE_WINDOW)+1;
  for(let i=0;i<FAR_WINDOW;i++)ids.push(base+start+i);
  return [...new Set(ids)].slice(0,30);
}

async function reconcileClient(env,client,previousOffset,requestBudget){
  const budget=Math.max(1,Math.min(MAX_REQUESTS_PER_CLIENT,positiveInt(requestBudget)||1));
  const result={status:'healthy',requests:0,recovered:0,updated:0,baseShortId:0,highestFoundShortId:0,nextFarOffset:IMMEDIATE_WINDOW,error:null,budget};
  try{
    const apiKey=text(await decryptSecret(client.easyOrdersToken,env));
    if(!apiKey)throw new Error('Easy Orders API key is missing or cannot be decrypted');
    if(!text(client.storeId))throw new Error('Easy Orders Store ID is not configured');
    const recent=await latestEasyOrdersRows(env,client.id);
    let base=0;
    for(const row of recent){
      if(result.requests>=Math.min(3,budget))break;
      const fetched=await fetchById(apiKey,row.id);result.requests++;
      if(fetched.kind==='rate_limited'){result.status='rate_limited';return result;}
      if(fetched.kind!=='found')continue;
      const shortId=positiveInt(fetched.data?.short_id||fetched.data?.shortId);
      if(shortId){base=shortId;break;}
    }
    if(!base){result.status='waiting_for_seed';result.nextFarOffset=IMMEDIATE_WINDOW;return result;}
    result.baseShortId=base;
    let foundAny=false;
    for(const shortId of scanIds(base,previousOffset)){
      if(result.requests>=budget)break;
      const fetched=await fetchByShort(apiKey,shortId);result.requests++;
      if(fetched.kind==='rate_limited'){result.status='rate_limited';break;}
      if(fetched.kind!=='found')continue;
      const order=fetched.data||{};
      if(text(order.store_id||order.storeId)!==text(client.storeId))continue;
      const before=await existingOrder(env,order.id);
      const ingest=await ingestViaExistingWebhook(env,order);
      if(ingest?.id||ingest?.event){if(before)result.updated++;else result.recovered++;}
      const actual=positiveInt(order.short_id||order.shortId)||shortId;
      result.highestFoundShortId=Math.max(result.highestFoundShortId,actual);
      foundAny=true;
    }
    result.nextFarOffset=nextFarOffset(previousOffset,foundAny);
    return result;
  }catch(error){result.status='error';result.error=String(error?.message||error).slice(0,400);result.nextFarOffset=nextFarOffset(previousOffset,false);return result;}
}

async function persistHealth(env,health){
  try{
    await env.DB.prepare("UPDATE state SET json=json_set(json,'$.easyOrdersRecovery',json(?)),updated_at=? WHERE id=1").bind(JSON.stringify(health),new Date().toISOString()).run();
  }catch(error){console.error('easyOrders recovery health persist failed',error);}
}
async function runRecovery(env){
  const state=await rawState(env),clients=(state.clients||[]).filter(c=>text(c.storeId)&&c.easyOrdersToken),previous=state.easyOrdersRecovery?.probeOffsets||{};
  const health={build:BUILD,lastRunAt:new Date().toISOString(),status:'healthy',connectedClients:clients.length,checkedClients:0,skippedClients:0,requests:0,requestLimit:MAX_REQUESTS_PER_RUN,recovered:0,updated:0,rateLimited:false,errors:0,probeOffsets:{},results:[]};
  let remaining=MAX_REQUESTS_PER_RUN;
  for(let i=0;i<clients.length&&remaining>0;i++){
    const client=clients[i],left=clients.length-i,fairShare=Math.max(1,Math.floor(remaining/Math.max(1,left))),budget=Math.min(MAX_REQUESTS_PER_CLIENT,fairShare,remaining);
    const r=await reconcileClient(env,client,previous?.[client.id],budget);health.checkedClients++;remaining=Math.max(0,remaining-r.requests);health.requests+=r.requests;health.recovered+=r.recovered;health.updated+=r.updated;if(r.status==='rate_limited')health.rateLimited=true;if(r.status==='error')health.errors++;
    health.probeOffsets[client.id]=r.nextFarOffset;
    health.results.push({status:r.status,requests:r.requests,budget:r.budget,recovered:r.recovered,updated:r.updated,baseShortId:r.baseShortId,highestFoundShortId:r.highestFoundShortId,error:r.error});
  }
  health.skippedClients=Math.max(0,clients.length-health.checkedClients);
  health.status=health.errors?'error':health.rateLimited?'rate_limited':health.skippedClients?'budget_limited':clients.length?'healthy':'no_connections';
  await persistHealth(env,health);
  console.log(`Easy Orders production recovery: clients=${health.connectedClients} checked=${health.checkedClients} requests=${health.requests}/${MAX_REQUESTS_PER_RUN} recovered=${health.recovered} updated=${health.updated} status=${health.status}`);
  return health;
}
async function healthPayload(env){
  const state=await rawState(env),h=state.easyOrdersRecovery||{};
  return {ok:true,service:'easyorders-production-sync',build:BUILD,status:h.status||'not_run',lastRunAt:h.lastRunAt||null,connectedClients:Number(h.connectedClients||0),checkedClients:Number(h.checkedClients||0),skippedClients:Number(h.skippedClients||0),requests:Number(h.requests||0),requestLimit:Number(h.requestLimit||MAX_REQUESTS_PER_RUN),recovered:Number(h.recovered||0),updated:Number(h.updated||0),rateLimited:!!h.rateLimited,errors:Number(h.errors||0)};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/health/easyorders-sync'&&request.method==='GET')return json(await healthPayload(env));
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){
    const cron=String(event?.cron||'');
    const tasks=[];
    if(cron==='*/5 * * * *')tasks.push(runRecovery(env));
    if(cron!=='*/5 * * * *'&&typeof app.scheduled==='function'){
      try{const delegated=app.scheduled(event,env,ctx);if(delegated)tasks.push(Promise.resolve(delegated));}catch(error){tasks.push(Promise.reject(error));}
    }
    const task=Promise.allSettled(tasks);
    ctx?.waitUntil?.(task);
    return task;
  }
};