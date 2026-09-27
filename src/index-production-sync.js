import app from './index-commerce-v38.js';
import {easyOrdersRecoveryStatus} from './easyorders-order-reconciliation.js';

const BUILD='production-sync-v3-2026-09-28-preview-parity-backfill';
const SHORT_ORDER_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/short/';
const ORDER_BY_ID_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/';
const MAX_REQUESTS_PER_RUN=30;
const MAX_REQUESTS_PER_CLIENT=10;
const CATCHUP_REQUESTS_PER_CLIENT=30;
const LEGACY_BACKFILL_LOOKBACK=80;
const CURRENT_RESERVE_DURING_BACKFILL=5;
const IMMEDIATE_WINDOW=3;
const FAR_WINDOW=3;
const MAX_FAR_OFFSET=210;

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Sync-Build':BUILD}});
const text=v=>String(v??'').trim();
const positiveInt=v=>{const n=Math.floor(Number(v));return Number.isFinite(n)&&n>0?n:0;};
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

/*
 * Compatibility fallback for legacy Production accounts that still keep Easy
 * Orders credentials in state.clients instead of store_connections. It now uses
 * the same 80-short-id historical recovery window as the canonical v38 path,
 * then keeps a progressive forward cursor so gaps larger than ten ids cannot
 * permanently stall Production again.
 */
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

async function reconcileClient(env,client,progress={},requestBudget=MAX_REQUESTS_PER_CLIENT){
  const previousBackfillComplete=progress.backfillComplete===true;
  const budget=Math.min(previousBackfillComplete?MAX_REQUESTS_PER_CLIENT:CATCHUP_REQUESTS_PER_CLIENT,positiveInt(requestBudget));
  const cachedBase=positiveInt(progress.previousBase);
  const result={status:'healthy',requests:0,recovered:0,updated:0,baseShortId:cachedBase,highestFoundShortId:0,nextBaseShortId:cachedBase,forwardCursor:positiveInt(progress.forwardCursor),backfillCursor:positiveInt(progress.backfillCursor),backfillFloor:positiveInt(progress.backfillFloor),backfillComplete:previousBackfillComplete,backfillRemaining:0,seedSource:cachedBase?'cache':'orders',error:null};
  if(!budget){result.status='budget_exhausted';return result;}
  try{
    const apiKey=text(await decryptSecret(client.easyOrdersToken,env));
    if(!apiKey)throw new Error('Easy Orders API key is missing or cannot be decrypted');
    if(!text(client.storeId))throw new Error('Easy Orders Store ID is not configured');

    let base=cachedBase;
    if(!base){
      const recent=await latestEasyOrdersRows(env,client.id);
      const seedLimit=Math.min(5,budget);
      for(const row of recent){
        if(result.requests>=seedLimit)break;
        const fetched=await fetchById(apiKey,row.id);result.requests++;
        if(fetched.kind==='rate_limited'){result.status='rate_limited';return result;}
        if(fetched.kind!=='found')continue;
        const shortId=positiveInt(fetched.data?.short_id||fetched.data?.shortId);
        if(shortId){base=shortId;break;}
      }
    }
    if(!base){result.status='waiting_for_seed';return result;}

    result.baseShortId=base;result.nextBaseShortId=base;
    if(!result.backfillFloor)result.backfillFloor=Math.max(1,base-LEGACY_BACKFILL_LOOKBACK);
    if(!result.backfillComplete&&!result.backfillCursor)result.backfillCursor=Math.max(result.backfillFloor,base-1);

    const ingestIfOurs=async(fetched,requestedShortId)=>{
      if(fetched.kind!=='found')return {providerFound:false,ours:false,actual:requestedShortId};
      const order=fetched.data||{},actual=positiveInt(order.short_id||order.shortId)||requestedShortId;
      result.highestFoundShortId=Math.max(result.highestFoundShortId,actual);
      const ours=text(order.store_id||order.storeId)===text(client.storeId);
      if(ours){
        const before=await existingOrder(env,order.id),ingest=await ingestViaExistingWebhook(env,order);
        if(ingest?.id||ingest?.event){if(before)result.updated++;else result.recovered++;}
      }
      return {providerFound:true,ours,actual};
    };

    if(!result.backfillComplete){
      const reserve=Math.min(CURRENT_RESERVE_DURING_BACKFILL,budget),backfillLimit=Math.max(0,budget-reserve);
      let used=0;
      while(result.backfillCursor>=result.backfillFloor&&result.requests<budget&&used<backfillLimit){
        const shortId=result.backfillCursor,fetched=await fetchByShort(apiKey,shortId);result.requests++;used++;result.backfillCursor=shortId-1;
        if(fetched.kind==='rate_limited'){result.status='rate_limited';break;}
        await ingestIfOurs(fetched,shortId);
      }
      if(result.backfillCursor<result.backfillFloor)result.backfillComplete=true;
    }
    result.backfillRemaining=result.backfillComplete?0:Math.max(0,result.backfillCursor-result.backfillFloor+1);
    if(result.status==='rate_limited'){return result;}

    let currentBase=result.nextBaseShortId||base,foundCurrent=false;
    for(let delta=1;delta<=IMMEDIATE_WINDOW&&result.requests<budget;delta++){
      const shortId=currentBase+delta,fetched=await fetchByShort(apiKey,shortId);result.requests++;
      if(fetched.kind==='rate_limited'){result.status='rate_limited';break;}
      const seen=await ingestIfOurs(fetched,shortId);
      if(seen.providerFound){result.nextBaseShortId=Math.max(result.nextBaseShortId,seen.actual);foundCurrent=true;}
    }
    if(result.status==='rate_limited')return result;

    if(foundCurrent){
      result.forwardCursor=(result.nextBaseShortId||currentBase)+IMMEDIATE_WINDOW+1;
    }else{
      const minFar=currentBase+IMMEDIATE_WINDOW+1,maxFar=currentBase+MAX_FAR_OFFSET;
      let cursor=positiveInt(result.forwardCursor);if(!cursor||cursor<minFar||cursor>maxFar)cursor=minFar;
      let farScanned=0,farFound=false;
      while(result.requests<budget&&farScanned<FAR_WINDOW){
        const shortId=cursor,fetched=await fetchByShort(apiKey,shortId);result.requests++;farScanned++;cursor++;
        if(fetched.kind==='rate_limited'){result.status='rate_limited';break;}
        const seen=await ingestIfOurs(fetched,shortId);
        if(seen.providerFound){result.nextBaseShortId=Math.max(result.nextBaseShortId,seen.actual);farFound=true;}
      }
      if(farFound)cursor=(result.nextBaseShortId||currentBase)+IMMEDIATE_WINDOW+1;
      if(cursor>maxFar)cursor=minFar;
      result.forwardCursor=cursor;
    }

    if(result.status!=='rate_limited')result.status=result.backfillComplete?'healthy':'catching_up';
    return result;
  }catch(error){result.status='error';result.error=String(error?.message||error).slice(0,400);return result;}
}

async function persistHealth(env,health){
  try{
    await env.DB.prepare("UPDATE state SET json=json_set(json,'$.easyOrdersRecovery',json(?)),updated_at=? WHERE id=1").bind(JSON.stringify(health),new Date().toISOString()).run();
  }catch(error){console.error('easyOrders recovery health persist failed',error);}
}
async function runRecovery(env){
  const state=await rawState(env),clients=(state.clients||[]).filter(c=>text(c.storeId)&&c.easyOrdersToken),previous=state.easyOrdersRecovery||{};
  const backfillCursors={...(previous.backfillCursors||{})},backfillFloors={...(previous.backfillFloors||{})},backfillComplete={...(previous.backfillComplete||{})},forwardCursors={...(previous.forwardCursors||{})},baseShortIds={...(previous.baseShortIds||{})};
  const health={build:BUILD,lastRunAt:new Date().toISOString(),status:'healthy',connectedClients:clients.length,checkedClients:0,requests:0,requestLimit:MAX_REQUESTS_PER_RUN,remainingRequests:MAX_REQUESTS_PER_RUN,recovered:0,updated:0,rateLimited:false,errors:0,budgetExhausted:false,backfillPendingClients:0,backfillCompleteClients:0,backfillRemainingApprox:0,baseShortIds,backfillCursors,backfillFloors,backfillComplete,forwardCursors,results:[]};
  let remaining=MAX_REQUESTS_PER_RUN;
  for(let i=0;i<clients.length;i++){
    if(remaining<=0){health.budgetExhausted=true;break;}
    const client=clients[i],id=client.id,alreadyComplete=backfillComplete[id]===true,clientsLeft=Math.max(1,clients.length-i),fairShare=Math.max(1,Math.floor(remaining/clientsLeft)),clientCap=alreadyComplete?MAX_REQUESTS_PER_CLIENT:CATCHUP_REQUESTS_PER_CLIENT;
    const r=await reconcileClient(env,client,{previousBase:baseShortIds[id],forwardCursor:forwardCursors[id],backfillCursor:backfillCursors[id],backfillFloor:backfillFloors[id],backfillComplete:alreadyComplete},Math.min(clientCap,fairShare,remaining));
    health.checkedClients++;health.requests+=r.requests;health.recovered+=r.recovered;health.updated+=r.updated;if(r.status==='rate_limited')health.rateLimited=true;if(r.status==='error')health.errors++;
    remaining=Math.max(0,remaining-r.requests);
    if(r.nextBaseShortId)baseShortIds[id]=r.nextBaseShortId;if(r.forwardCursor)forwardCursors[id]=r.forwardCursor;if(r.backfillFloor)backfillFloors[id]=r.backfillFloor;backfillCursors[id]=r.backfillCursor||0;backfillComplete[id]=r.backfillComplete===true;
    if(r.backfillComplete)health.backfillCompleteClients++;else {health.backfillPendingClients++;health.backfillRemainingApprox+=Number(r.backfillRemaining||0);}
    health.results.push({clientId:id,status:r.status,requests:r.requests,recovered:r.recovered,updated:r.updated,baseShortId:r.baseShortId,nextBaseShortId:r.nextBaseShortId,highestFoundShortId:r.highestFoundShortId,forwardCursor:r.forwardCursor,backfillCursor:r.backfillCursor,backfillFloor:r.backfillFloor,backfillComplete:r.backfillComplete,backfillRemaining:r.backfillRemaining,seedSource:r.seedSource,error:r.error});
  }
  if(remaining<=0&&health.checkedClients<clients.length)health.budgetExhausted=true;
  health.remainingRequests=remaining;
  health.status=health.errors?'error':health.rateLimited?'rate_limited':!clients.length?'no_connections':health.backfillPendingClients?'catching_up':'healthy';
  await persistHealth(env,health);
  console.log(`Easy Orders legacy parity recovery: clients=${health.connectedClients} checked=${health.checkedClients} requests=${health.requests}/${MAX_REQUESTS_PER_RUN} recovered=${health.recovered} updated=${health.updated} backfillPending=${health.backfillPendingClients} backfillRemaining≈${health.backfillRemainingApprox} status=${health.status}`);
  return health;
}

async function canonicalHealth(env){
  try{
    const h=await easyOrdersRecoveryStatus(env);
    return {ok:true,status:h.status||'unknown',connections:Number(h.connections||0),healthyConnections:Number(h.healthyConnections||0),catchingUpConnections:Number(h.catchingUpConnections||0),waitingConnections:Number(h.waitingConnections||0),errorConnections:Number(h.errorConnections||0),estimatedRemaining:Number(h.estimatedRemaining||0),recoveredTotal:Number(h.recoveredTotal||0)};
  }catch(error){return {ok:false,status:'unavailable',error:text(error?.message||error).slice(0,300)};}
}
async function healthPayload(env){
  const state=await rawState(env),legacy=state.easyOrdersRecovery||{},canonical=await canonicalHealth(env),canonicalActive=canonical.ok&&canonical.connections>0;
  return {ok:true,service:'easyorders-production-sync',build:BUILD,mode:'canonical-v38-with-legacy-parity-fallback',status:canonicalActive?canonical.status:(legacy.status||'not_run'),scheduler:{easyOrdersRecovery:'every-5-minutes-canonical-first',metaNearLive:'every-15-minutes',deepSync:'every-2-hours'},canonical,legacyFallback:{active:!canonicalActive,status:legacy.status||'not_run',lastRunAt:legacy.lastRunAt||null,connectedClients:Number(legacy.connectedClients||0),checkedClients:Number(legacy.checkedClients||0),requests:Number(legacy.requests||0),requestLimit:Number(legacy.requestLimit||MAX_REQUESTS_PER_RUN),remainingRequests:Number(legacy.remainingRequests??MAX_REQUESTS_PER_RUN),recovered:Number(legacy.recovered||0),updated:Number(legacy.updated||0),backfillPendingClients:Number(legacy.backfillPendingClients||0),backfillCompleteClients:Number(legacy.backfillCompleteClients||0),backfillRemainingApprox:Number(legacy.backfillRemainingApprox||0),rateLimited:!!legacy.rateLimited,budgetExhausted:!!legacy.budgetExhausted,errors:Number(legacy.errors||0)}};
}

async function delegateScheduled(event,env,ctx,cronOverride=null){
  if(typeof app.scheduled!=='function')return null;
  const controller=cronOverride?{cron:cronOverride,scheduledTime:event?.scheduledTime||Date.now()}:event;
  const delegated=app.scheduled(controller,env,ctx);
  return delegated&&typeof delegated.then==='function'?await delegated:delegated;
}
async function runFiveMinute(event,env,ctx){
  let canonical=null,canonicalError=null;
  try{canonical=await delegateScheduled(event,env,ctx);}catch(error){canonicalError=text(error?.message||error).slice(0,400);console.error('Canonical Easy Orders recovery failed; checking legacy fallback',error);}
  const status=text(canonical?.status),connections=Number(canonical?.connections||0);
  const needsLegacy=!canonical||connections===0||status==='waiting_for_short_id'||status==='error';
  if(!needsLegacy){
    console.log(`Easy Orders canonical recovery: connections=${connections} requests=${Number(canonical.requests||0)} recovered=${Number(canonical.recovered||0)} updated=${Number(canonical.updated||0)} status=${status||'healthy'}`);
    return {ok:true,mode:'canonical',canonical};
  }
  const legacy=await runRecovery(env);
  return {ok:legacy.status!=='error',mode:'canonical-with-legacy-parity-fallback',canonical,canonicalError,legacy};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/health/easyorders-sync'&&request.method==='GET')return json(await healthPayload(env));
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){
    const cron=String(event?.cron||'');
    let task;
    if(cron==='*/5 * * * *')task=runFiveMinute(event,env,ctx);
    else if(cron==='*/15 * * * *')task=delegateScheduled(event,env,ctx,'* * * * *');
    else task=delegateScheduled(event,env,ctx);
    const settled=Promise.resolve(task).catch(error=>{console.error(`Production scheduled task failed for ${cron||'(empty)'}`,error);throw error;});
    ctx?.waitUntil?.(settled);
    return settled;
  }
};
