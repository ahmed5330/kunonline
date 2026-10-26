import {readConnectionSecrets} from './integration-provider-validation.js';
import {easyOrdersWebhookPath,handleEasyOrdersWebhook} from './commerce-order-sync.js';
import {mutateEasyOrdersConfig,mergeEasyOrdersRecoveryPatch} from './easyorders-connection-config.js';

const text=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const SHORT_ORDER_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/short/';
const ORDER_BY_ID_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/';
const DEFAULT_LOOKBACK=80;
const DEFAULT_MAX_REQUESTS=30;
const MAX_AHEAD_MISSES=30;

function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
function positiveInt(value){const n=Math.floor(Number(value));return Number.isFinite(n)&&n>0?n:0;}
function bounded(value,fallback,min,max){const n=Math.floor(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function providerSaysMissing(data){const message=text(typeof data==='string'?data:(data?.message||data?.error||data?.detail)).toLowerCase();return message.includes('record not found')||message==='not found'||message.includes('order not found');}
function recoveryState(config={}){
  const highestShortId=positiveInt(config.easyOrdersRecoveryHighestShortId),nextShortId=positiveInt(config.easyOrdersRecoveryCursor),lastError=text(config.easyOrdersRecoveryLastError),explicit=text(config.easyOrdersRecoveryLastStatus);
  const estimatedRemaining=highestShortId&&nextShortId&&nextShortId<=highestShortId?highestShortId-nextShortId+1:0;
  // Checking only the contiguous cursor hides delayed provider Short IDs:
  // an ahead scan can have completed while unresolved 404s remain queued.
  const unresolvedAheadCount=Array.isArray(config.easyOrdersRecoveryPendingShortIds)
    ?config.easyOrdersRecoveryPendingShortIds.length:0;
  let status='waiting_for_short_id';
  if(explicit==='error'&&lastError)status='error';
  else if(explicit==='rate_limited')status='rate_limited';
  else if(highestShortId&&(estimatedRemaining>0||unresolvedAheadCount>0||explicit==='catching_up'))
    status='catching_up';
  else if(explicit==='waiting_for_provider_order')status='waiting_for_provider_order';
  else if(highestShortId&&nextShortId>highestShortId)status='healthy';
  else if(highestShortId&&!nextShortId)status='catching_up';
  return {status,highestShortId,nextShortId,estimatedRemaining,
    unresolvedAheadCount,
    lastError:lastError||null,lastRunAt:text(config.easyOrdersRecoveryLastRunAt)||null,lastCronAt:text(config.easyOrdersRecoveryLastCronAt)||null,lastRequests:positiveInt(config.easyOrdersRecoveryLastRequests),lastRecovered:positiveInt(config.easyOrdersRecoveryLastRecovered),recoveredTotal:positiveInt(config.easyOrdersRecoveryRecoveredCount),webhookLastShortId:positiveInt(config.webhookLastShortId||config.webhookLastShortID||config.webhook_last_short_id)};
}
function aggregateRecovery(results=[]){
  const statuses=results.map(x=>x.status),error=statuses.includes('error'),rateLimited=statuses.includes('rate_limited'),catchingUp=statuses.includes('catching_up'),providerWaiting=statuses.includes('waiting_for_provider_order'),waiting=statuses.includes('waiting_for_short_id');
  return {status:error?'error':rateLimited?'rate_limited':catchingUp?'catching_up':providerWaiting?'waiting_for_provider_order':waiting?'waiting_for_short_id':'healthy',healthyConnections:results.filter(x=>x.status==='healthy').length,catchingUpConnections:results.filter(x=>x.status==='catching_up').length,waitingConnections:results.filter(x=>['waiting_for_short_id','waiting_for_provider_order'].includes(x.status)).length,waitingForProviderConnections:results.filter(x=>x.status==='waiting_for_provider_order').length,errorConnections:results.filter(x=>x.status==='error').length,estimatedRemaining:results.reduce((sum,x)=>sum+positiveInt(x.estimatedRemaining),0),unresolvedAheadCount:results.reduce((sum,x)=>sum+positiveInt(x.unresolvedAheadCount),0),recoveredTotal:results.reduce((sum,x)=>sum+positiveInt(x.recoveredTotal||x.cumulativeRecovered),0)};
}

async function patchConfig(env,connection,patch){
  return mutateEasyOrdersConfig(env,connection,
    current=>mergeEasyOrdersRecoveryPatch(current,patch));
}

async function easyOrdersGet(fetcher,url,apiKey){
  const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json','Api-Key':apiKey}});
  if(response.status===429)return {kind:'rate_limited',data:null,status:429};
  const raw=await response.text().catch(()=>''),data=(()=>{if(!raw)return null;try{return JSON.parse(raw)}catch{return raw}})();
  // An upstream 5xx/401/403 cannot prove the order is missing even if its
  // error body happens to contain "record not found". Only an actual HTTP
  // 404 or a SUCCESS response with an explicit not-found result may advance
  // the recovery cursor; anything else must fail closed and retry the ID.
  if(response.status===404||(response.ok&&providerSaysMissing(data)))
    return {kind:'missing',data:null,status:response.status};
  if(!response.ok){
    const error=new Error((typeof data==='string'?data:null)||data?.message||data?.error||`Easy Orders HTTP ${response.status}`);
    error.status=response.status;
    error.code=response.status===401||response.status===403?'EASYORDERS_ORDERS_READ_FORBIDDEN':'EASYORDERS_RECONCILIATION_PROVIDER_ERROR';
    throw error;
  }
  return {kind:'found',data,status:response.status};
}

async function fetchOrderById(fetcher,apiKey,orderId){
  if(!text(orderId))return {kind:'missing',data:null,status:404};
  return easyOrdersGet(fetcher,`${ORDER_BY_ID_BASE}${encodeURIComponent(text(orderId))}`,apiKey);
}
async function fetchOrderByShortId(fetcher,apiKey,shortId){
  return easyOrdersGet(fetcher,`${SHORT_ORDER_BASE}${encodeURIComponent(String(shortId))}`,apiKey);
}

async function existingOrder(env,connection,order){
  const id=text(order?.id),config=parseConfig(connection),storeId=text(config.kunStoreId||config.storeId);
  if(!id||!storeId)return null;
  // Provider IDs are shared between Easy Orders stores; only same-store
  // orders count as previously ingested, otherwise fee reconciliation and
  // recovered order reporting silently miss new orders.
  return env.DB.prepare('SELECT id FROM orders WHERE client_id=? AND (id=? OR ref=?) AND (store_id=? OR store_id IS NULL) LIMIT 1')
    .bind(connection.client_id,id,`easyorders:${id}`,storeId).first();
}

async function ingestThroughCanonicalWebhook(env,connection,secrets,order){
  const path=await easyOrdersWebhookPath(env,connection),routeToken=decodeURIComponent(path.split('/').filter(Boolean).at(-1)||'');
  const headers={'Content-Type':'application/json'};
  const webhookSecret=text(secrets.webhook_secret||env.EASYORDERS_WEBHOOK_SECRET);if(webhookSecret)headers.secret=webhookSecret;
  const request=new Request(`https://kun-reconciliation.internal${path}`,{method:'POST',headers,body:JSON.stringify(order)});
  return handleEasyOrdersWebhook(request,env,{connectionId:connection.id,routeToken});
}

async function bootstrapFromLastWebhook(env,connection,{apiKey,fetcher,lookback}){
  let config=parseConfig(connection),highest=positiveInt(config.easyOrdersRecoveryHighestShortId),requests=0;
  if(highest)return {config,highest,cursor:positiveInt(config.easyOrdersRecoveryCursor)||Math.max(1,highest-lookback),requests,seeded:true,rateLimited:false};
  const webhookShortId=positiveInt(config.webhookLastShortId||config.webhookLastShortID||config.webhook_last_short_id);
  if(webhookShortId){
    const cursor=Math.max(1,webhookShortId-lookback);
    config=await patchConfig(env,connection,{easyOrdersRecoveryHighestShortId:webhookShortId,easyOrdersRecoveryCursor:cursor,easyOrdersRecoverySeedOrderId:text(config.webhookLastOrderId)||null,easyOrdersRecoverySeededAt:now(),easyOrdersRecoveryLastError:null});
    return {config,highest:webhookShortId,cursor,requests,seeded:true,rateLimited:false};
  }
  const lastOrderId=text(config.webhookLastOrderId);
  if(!lastOrderId)return {config,highest:0,cursor:0,requests,seeded:false,rateLimited:false};
  let fetched;
  if(/^\d+$/.test(lastOrderId))fetched=await fetchOrderByShortId(fetcher,apiKey,positiveInt(lastOrderId));
  else fetched=await fetchOrderById(fetcher,apiKey,lastOrderId);
  requests++;
  if(fetched.kind==='rate_limited')return {config,highest:0,cursor:0,requests,seeded:false,rateLimited:true};
  if(fetched.kind==='missing')return {config,highest:0,cursor:0,requests,seeded:false,rateLimited:false};
  const shortId=positiveInt(fetched.data?.short_id||fetched.data?.shortId);
  if(!shortId)return {config,highest:0,cursor:0,requests,seeded:false,rateLimited:false};
  const cursor=Math.max(1,shortId-lookback);
  config=await patchConfig(env,connection,{webhookLastShortId:shortId,easyOrdersRecoveryHighestShortId:shortId,easyOrdersRecoveryCursor:cursor,easyOrdersRecoverySeedOrderId:text(fetched.data?.id)||lastOrderId,easyOrdersRecoverySeededAt:now(),easyOrdersRecoveryLastError:null});
  return {config,highest:shortId,cursor,requests,seeded:true,rateLimited:false};
}

async function reconcileConnection(env,connection,{maxRequests,lookback,fetcher}){
  const out={connectionId:connection.id,clientId:connection.client_id,storeId:null,requests:0,recovered:0,updated:0,missing:0,foreignStoreSkipped:0,seeded:false,rateLimited:false,highestShortId:0,nextShortId:0,estimatedRemaining:0,cumulativeRecovered:0,status:'waiting_for_short_id',recoveredOrderIds:[],error:null};
  try{
    const secrets=await readConnectionSecrets(env,connection.client_id,connection.id),apiKey=text(secrets.api_key);
    if(!apiKey)throw Object.assign(new Error('مفتاح Easy Orders API غير موجود؛ لا يمكن إصلاح فجوات الطلبات تلقائيًا'),{status:409,code:'EASYORDERS_API_KEY_MISSING'});
    let config=parseConfig(connection);out.storeId=text(config.kunStoreId||config.storeId)||null;out.cumulativeRecovered=positiveInt(config.easyOrdersRecoveryRecoveredCount);
    const seed=await bootstrapFromLastWebhook(env,connection,{apiKey,fetcher,lookback});
    config=seed.config;out.requests+=seed.requests;out.seeded=seed.seeded;out.rateLimited=seed.rateLimited;
    let highest=seed.highest,cursor=seed.cursor;out.highestShortId=highest;out.nextShortId=cursor;
    if(out.rateLimited){
      out.status='rate_limited';
      await patchConfig(env,connection,{easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:'rate_limited',easyOrdersRecoveryLastRequests:out.requests,easyOrdersRecoveryLastRecovered:0,easyOrdersRecoveryLastError:null});
      return out;
    }
    if(!highest){
      out.status='waiting_for_short_id';
      await patchConfig(env,connection,{easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:'waiting_for_short_id',easyOrdersRecoveryLastRequests:out.requests,easyOrdersRecoveryLastRecovered:0,easyOrdersRecoveryLastError:null});
      return out;
    }
    const inspect=async shortId=>{
      if(out.requests>=maxRequests)return {kind:'budget'};
      // Count the HTTP attempt BEFORE awaiting it: failed requests consume
      // provider quota too. Otherwise one failed call per connection can
      // bypass the global 30-request Cron ceiling.
      out.requests++;
      const fetched=await fetchOrderByShortId(fetcher,apiKey,shortId);
      if(fetched.kind==='rate_limited'){out.rateLimited=true;return fetched;}
      if(fetched.kind==='missing'){out.missing++;return fetched;}
      const order=fetched.data||{},actualShort=positiveInt(order.short_id||order.shortId)||shortId;
      const incomingStore=text(order.store_id||order.storeId);
      const boundStore=text(connection.external_store_id);
      const verifiedStore=boundStore&&!/^CON-/i.test(boundStore)&&boundStore!==text(connection.id);
      if(!verifiedStore){
        throw Object.assign(new Error('Easy Orders store identity must be verified by the connected webhook before recovery'),{
          status:409,code:'EASYORDERS_RECOVERY_EXTERNAL_STORE_UNBOUND'});
      }
      if(!incomingStore||!text(order.id)){
        throw Object.assign(new Error('Easy Orders recovery response is missing order or store identity'),{
          status:502,code:'EASYORDERS_RECOVERY_PAYLOAD_INVALID'});
      }
      if(incomingStore!==boundStore){
        // A token may list orders from multiple external storefronts. Do not
        // ingest the other shop into this Kun store or halt its entire scan.
        out.foreignStoreSkipped++;
        return {kind:'foreign_store',shortId};
      }
      const before=await existingOrder(env,connection,order),result=await ingestThroughCanonicalWebhook(env,connection,secrets,order);
      if(result?.id){
        if(before)out.updated++;else {out.recovered++;out.recoveredOrderIds.push(result.id);}
      }
      highest=Math.max(highest,actualShort);
      return {kind:'found',order,result,shortId:actualShort};
    };

    while(cursor>0&&cursor<=highest&&out.requests<maxRequests&&!out.rateLimited){
      const inspected=await inspect(cursor);
      // A 429 is NOT a missing order. Do not checkpoint the next Short ID
      // until the current ID has been read (or explicitly returned 404).
      // Otherwise the throttled order can be permanently skipped in all
      // future scheduled runs.
      if(inspected.kind==='rate_limited'||inspected.kind==='budget')break;
      cursor++;
    }

    if(cursor>highest&&out.requests<maxRequests&&!out.rateLimited){
      let probe=highest+1,misses=0;
      while(out.requests<maxRequests&&misses<MAX_AHEAD_MISSES&&!out.rateLimited){
        const found=await inspect(probe);
        if(found.kind==='found'){
          highest=Math.max(highest,positiveInt(found.shortId)||probe);
          probe=highest+1;misses=0;
        }else if(found.kind==='missing'||found.kind==='foreign_store'){
          misses++;probe++;
        }else break;
      }
      cursor=highest+1;
    }

    const cumulative=positiveInt(config.easyOrdersRecoveryRecoveredCount)+out.recovered,estimatedRemaining=cursor<=highest?highest-cursor+1:0;
    const status=out.rateLimited?'rate_limited':(estimatedRemaining>0?'catching_up':'healthy');
    const saved=await patchConfig(env,connection,{easyOrdersRecoveryHighestShortId:highest,easyOrdersRecoveryCursor:cursor,easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:status,easyOrdersRecoveryLastRequests:out.requests,easyOrdersRecoveryLastRecovered:out.recovered,easyOrdersRecoveryRecoveredCount:cumulative,easyOrdersRecoveryLastError:null});
    out.highestShortId=positiveInt(saved.easyOrdersRecoveryHighestShortId);out.nextShortId=positiveInt(saved.easyOrdersRecoveryCursor);out.estimatedRemaining=Math.max(0,out.highestShortId-out.nextShortId+1);out.cumulativeRecovered=positiveInt(saved.easyOrdersRecoveryRecoveredCount);out.status=saved.easyOrdersRecoveryLastStatus||status;
    return out;
  }catch(error){
    out.error=error?.message||String(error);out.status='error';
    await patchConfig(env,connection,{easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:'error',easyOrdersRecoveryLastError:out.error.slice(0,500)}).catch(()=>{});
    return out;
  }
}

function selectConnections(results,storeId){return results.filter(row=>{if(!storeId)return true;const c=parseConfig(row);return text(c.kunStoreId||c.storeId)===text(storeId);});}
async function connectionRows(env,{clientId=null,connectionId=null}={}){
  const where=["provider='easyorders'","status='connected'"],binds=[];
  if(clientId){where.push('client_id=?');binds.push(clientId);}if(connectionId){where.push('id=?');binds.push(connectionId);}
  const {results=[]}=await env.DB.prepare(`SELECT * FROM store_connections WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`).bind(...binds).all();
  return results;
}

export async function easyOrdersRecoveryStatus(env,{clientId=null,storeId=null,connectionId=null}={}){
  const rows=selectConnections(await connectionRows(env,{clientId,connectionId}),storeId),results=rows.map(row=>{const config=parseConfig(row),state=recoveryState(config);return {connectionId:row.id,clientId:row.client_id,storeId:text(config.kunStoreId||config.storeId)||null,...state};});
  return {ok:true,connections:results.length,...aggregateRecovery(results),results};
}

// Global five-minute recovery uses a bounded request budget. Scheduling by
// updated_at can starve stores indefinitely: every inspected connection gets
// updated_at refreshed and stays at the front. Use least-recently-checked
// order so stores with an old/no recovery run are served first.
export function fairEasyOrdersRecoveryOrder(connections=[]){
  return [...connections].sort((a,b)=>{
    const x=text(parseConfig(a).easyOrdersRecoveryLastRunAt);
    const y=text(parseConfig(b).easyOrdersRecoveryLastRunAt);
    return x.localeCompare(y)||text(a.id).localeCompare(text(b.id));
  });
}
export async function reconcileEasyOrdersOrders(env,{clientId=null,storeId=null,connectionId=null,maxRequests=DEFAULT_MAX_REQUESTS,lookback=DEFAULT_LOOKBACK,fetcher=fetch}={}){
  const cap=bounded(maxRequests,DEFAULT_MAX_REQUESTS,1,30),back=bounded(lookback,DEFAULT_LOOKBACK,10,250),
    selected=fairEasyOrdersRecoveryOrder(selectConnections(await connectionRows(env,{clientId,connectionId}),storeId));
  const out={ok:true,connections:selected.length,requests:0,recovered:0,updated:0,missing:0,foreignStoreSkipped:0,seeded:0,rateLimited:false,recoveredOrderIds:[],results:[]};
  let remaining=cap;
  for(let i=0;i<selected.length&&remaining>0;i++){
    const fairShare=Math.max(3,Math.floor(remaining/Math.max(1,selected.length-i))),result=await reconcileConnection(env,selected[i],{maxRequests:Math.min(remaining,fairShare),lookback:back,fetcher});
    remaining-=result.requests;out.requests+=result.requests;out.recovered+=result.recovered;out.updated+=result.updated;out.missing+=result.missing;out.foreignStoreSkipped+=result.foreignStoreSkipped;if(result.seeded)out.seeded++;if(result.rateLimited)out.rateLimited=true;out.recoveredOrderIds.push(...result.recoveredOrderIds);out.results.push(result);
  }
  Object.assign(out,aggregateRecovery(out.results));
  // Do not claim a globally successful recovery when a connection failed or
  // upstream throttled it. The 5-minute scheduler may be limited to 30
  // requests; expose deferred work without treating an ordinary budget
  // rotation as a provider error.
  out.checkedConnections=out.results.length;
  out.uncheckedConnections=Math.max(0,selected.length-out.checkedConnections);
  out.failedConnections=out.results.filter(row=>row.status==='error').length;
  out.rateLimitedConnections=out.results.filter(row=>row.status==='rate_limited').length;
  out.completedAllConnections=out.uncheckedConnections===0;
  out.ok=out.failedConnections===0&&out.rateLimitedConnections===0;
  return out;
}

export const easyOrdersReconciliationDefaults=Object.freeze({maxRequests:DEFAULT_MAX_REQUESTS,lookback:DEFAULT_LOOKBACK,aheadMisses:MAX_AHEAD_MISSES});
