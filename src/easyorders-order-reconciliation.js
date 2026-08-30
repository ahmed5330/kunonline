import {readConnectionSecrets} from './integration-provider-validation.js';
import {easyOrdersWebhookPath,handleEasyOrdersWebhook} from './commerce-order-sync.js';

const text=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const SHORT_ORDER_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/short/';
const ORDER_BY_ID_BASE='https://api.easy-orders.net/api/v1/external-apps/orders/';
const DEFAULT_LOOKBACK=80;
const DEFAULT_MAX_REQUESTS=30;
const MAX_AHEAD_MISSES=3;

function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
function positiveInt(value){const n=Math.floor(Number(value));return Number.isFinite(n)&&n>0?n:0;}
function bounded(value,fallback,min,max){const n=Math.floor(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function providerSaysMissing(data){const message=text(typeof data==='string'?data:(data?.message||data?.error||data?.detail)).toLowerCase();return message.includes('record not found')||message==='not found'||message.includes('order not found');}

async function patchConfig(env,connection,patch){
  const fresh=await env.DB.prepare('SELECT config_json FROM store_connections WHERE id=? AND client_id=?').bind(connection.id,connection.client_id).first();
  const config={...parseConfig(fresh||connection),...patch};
  const ts=now();
  await env.DB.prepare('UPDATE store_connections SET config_json=?,updated_at=? WHERE id=? AND client_id=?').bind(JSON.stringify(config),ts,connection.id,connection.client_id).run();
  connection.config_json=JSON.stringify(config);
  return config;
}

async function easyOrdersGet(fetcher,url,apiKey){
  const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json','Api-Key':apiKey}});
  if(response.status===429)return {kind:'rate_limited',data:null,status:429};
  const raw=await response.text().catch(()=>''),data=(()=>{if(!raw)return null;try{return JSON.parse(raw)}catch{return raw}})();
  if(response.status===404||providerSaysMissing(data))return {kind:'missing',data:null,status:response.status};
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
  const id=text(order?.id);if(!id)return null;
  return env.DB.prepare('SELECT id FROM orders WHERE client_id=? AND (id=? OR ref=?) LIMIT 1').bind(connection.client_id,id,`easyorders:${id}`).first();
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
  const out={connectionId:connection.id,clientId:connection.client_id,storeId:null,requests:0,recovered:0,updated:0,missing:0,seeded:false,rateLimited:false,highestShortId:0,nextShortId:0,recoveredOrderIds:[],error:null};
  try{
    const secrets=await readConnectionSecrets(env,connection.client_id,connection.id),apiKey=text(secrets.api_key);
    if(!apiKey)throw Object.assign(new Error('مفتاح Easy Orders API غير موجود؛ لا يمكن إصلاح فجوات الطلبات تلقائيًا'),{status:409,code:'EASYORDERS_API_KEY_MISSING'});
    let config=parseConfig(connection);out.storeId=text(config.kunStoreId||config.storeId)||null;
    const seed=await bootstrapFromLastWebhook(env,connection,{apiKey,fetcher,lookback});
    config=seed.config;out.requests+=seed.requests;out.seeded=seed.seeded;out.rateLimited=seed.rateLimited;
    let highest=seed.highest,cursor=seed.cursor;
    if(out.rateLimited)return out;
    if(!highest){
      await patchConfig(env,connection,{easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:'waiting_for_short_id',easyOrdersRecoveryLastError:null});
      return out;
    }
    const inspect=async shortId=>{
      if(out.requests>=maxRequests)return {kind:'budget'};
      const fetched=await fetchOrderByShortId(fetcher,apiKey,shortId);out.requests++;
      if(fetched.kind==='rate_limited'){out.rateLimited=true;return fetched;}
      if(fetched.kind==='missing'){out.missing++;return fetched;}
      const order=fetched.data||{},actualShort=positiveInt(order.short_id||order.shortId)||shortId;
      const before=await existingOrder(env,connection,order),result=await ingestThroughCanonicalWebhook(env,connection,secrets,order);
      if(result?.id){
        if(before)out.updated++;else {out.recovered++;out.recoveredOrderIds.push(result.id);}
      }
      highest=Math.max(highest,actualShort);
      return {kind:'found',order,result,shortId:actualShort};
    };

    while(cursor>0&&cursor<=highest&&out.requests<maxRequests&&!out.rateLimited){
      await inspect(cursor);cursor++;
    }

    if(cursor>highest&&out.requests<maxRequests&&!out.rateLimited){
      let probe=highest+1,misses=0;
      while(out.requests<maxRequests&&misses<MAX_AHEAD_MISSES&&!out.rateLimited){
        const found=await inspect(probe);
        if(found.kind==='found'){
          highest=Math.max(highest,positiveInt(found.shortId)||probe);
          probe=highest+1;misses=0;
        }else if(found.kind==='missing'){
          misses++;probe++;
        }else break;
      }
      cursor=highest+1;
    }

    const cumulative=positiveInt(config.easyOrdersRecoveryRecoveredCount)+out.recovered;
    const status=out.rateLimited?'rate_limited':(cursor<=highest?'catching_up':'healthy');
    await patchConfig(env,connection,{easyOrdersRecoveryHighestShortId:highest,easyOrdersRecoveryCursor:cursor,easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:status,easyOrdersRecoveryLastRequests:out.requests,easyOrdersRecoveryLastRecovered:out.recovered,easyOrdersRecoveryRecoveredCount:cumulative,easyOrdersRecoveryLastError:null});
    out.highestShortId=highest;out.nextShortId=cursor;
    return out;
  }catch(error){
    out.error=error?.message||String(error);
    await patchConfig(env,connection,{easyOrdersRecoveryLastRunAt:now(),easyOrdersRecoveryLastStatus:'error',easyOrdersRecoveryLastError:out.error.slice(0,500)}).catch(()=>{});
    return out;
  }
}

export async function reconcileEasyOrdersOrders(env,{clientId=null,storeId=null,connectionId=null,maxRequests=DEFAULT_MAX_REQUESTS,lookback=DEFAULT_LOOKBACK,fetcher=fetch}={}){
  const cap=bounded(maxRequests,DEFAULT_MAX_REQUESTS,1,30),back=bounded(lookback,DEFAULT_LOOKBACK,10,250),where=["provider='easyorders'","status='connected'"],binds=[];
  if(clientId){where.push('client_id=?');binds.push(clientId);}if(connectionId){where.push('id=?');binds.push(connectionId);}
  const {results=[]}=await env.DB.prepare(`SELECT * FROM store_connections WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`).bind(...binds).all();
  const selected=results.filter(row=>{if(!storeId)return true;const c=parseConfig(row);return text(c.kunStoreId||c.storeId)===text(storeId);});
  const out={ok:true,connections:selected.length,requests:0,recovered:0,updated:0,missing:0,seeded:0,rateLimited:false,recoveredOrderIds:[],results:[]};
  let remaining=cap;
  for(let i=0;i<selected.length&&remaining>0;i++){
    const fairShare=Math.max(3,Math.floor(remaining/Math.max(1,selected.length-i))),result=await reconcileConnection(env,selected[i],{maxRequests:Math.min(remaining,fairShare),lookback:back,fetcher});
    remaining-=result.requests;out.requests+=result.requests;out.recovered+=result.recovered;out.updated+=result.updated;out.missing+=result.missing;if(result.seeded)out.seeded++;if(result.rateLimited)out.rateLimited=true;out.recoveredOrderIds.push(...result.recoveredOrderIds);out.results.push(result);
  }
  return out;
}

export const easyOrdersReconciliationDefaults=Object.freeze({maxRequests:DEFAULT_MAX_REQUESTS,lookback:DEFAULT_LOOKBACK,aheadMisses:MAX_AHEAD_MISSES});
