import commerceV30 from './index-commerce-v30.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {easyOrdersWebhookPath} from './commerce-order-sync.js';
import {readConnectionSecrets} from './integration-provider-validation.js';

const BUILD='preview-v31-2026-08-28';
const text=v=>String(v??'').trim(),now=()=>new Date().toISOString();
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...extra}});
const safeEqual=(a,b)=>{a=text(a);b=text(b);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
async function hmacHex(value,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function expectedRouteToken(env,connection){const secret=text(env.EASYORDERS_WEBHOOK_ROUTE_SECRET||env.SESSION_SECRET);if(!secret)throw Object.assign(new Error('Webhook route secret غير متاح'),{status:500,code:'EASYORDERS_WEBHOOK_ROUTE_SECRET_MISSING'});return hmacHex(`easyorders:${connection.client_id}:${connection.id}`,secret);}
async function connectionById(env,id){return env.DB.prepare("SELECT * FROM store_connections WHERE id=? AND provider='easyorders' AND status='connected'").bind(id).first();}

export function normalizeEasyOrdersWebhookPayload(input){
  const root=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const candidates=[root.data?.order,root.order,root.payload?.order,root.payload,root.data];
  const nested=candidates.find(x=>x&&typeof x==='object'&&!Array.isArray(x));
  const p={...(nested||root)};
  if(root.event_type&&!p.event_type)p.event_type=root.event_type;
  if(root.eventType&&!p.event_type)p.event_type=root.eventType;
  if(p.eventType&&!p.event_type)p.event_type=p.eventType;
  if(root.store_id&&!p.store_id)p.store_id=root.store_id;
  if(root.storeId&&!p.store_id)p.store_id=root.storeId;
  if(p.orderId&&!p.order_id)p.order_id=p.orderId;
  if(p.oldStatus&&!p.old_status)p.old_status=p.oldStatus;
  if(p.newStatus&&!p.new_status)p.new_status=p.newStatus;
  if(p.storeId&&!p.store_id)p.store_id=p.storeId;
  if(p.cartItems&&!p.cart_items)p.cart_items=p.cartItems;
  if(p.fullName&&!p.full_name)p.full_name=p.fullName;
  if(p.shippingCost!==undefined&&p.shipping_cost===undefined)p.shipping_cost=p.shippingCost;
  if(p.totalCost!==undefined&&p.total_cost===undefined)p.total_cost=p.totalCost;
  if(p.createdAt&&!p.created_at)p.created_at=p.createdAt;
  if(p.updatedAt&&!p.updated_at)p.updated_at=p.updatedAt;
  if(!p.store_id&&Array.isArray(p.cart_items)){
    const first=p.cart_items[0]||{};
    p.store_id=first.store_id||first.storeId||first.product?.store_id||first.product?.storeId||null;
  }
  return p;
}

async function currentUser(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceV30.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx),d=await r.json().catch(()=>({}));
  if(!r.ok||!d?.role)throw Object.assign(new Error(d?.error||'محتاج تسجّل دخول'),{status:r.status||401,code:'AUTH_REQUIRED'});
  return d;
}
async function patchHealth(env,connection,{status,code,httpStatus,orderId,externalStoreId,error,probe=false}){
  const fresh=await env.DB.prepare('SELECT config_json FROM store_connections WHERE id=? AND client_id=?').bind(connection.id,connection.client_id).first();
  const config=parseConfig(fresh||connection),ts=now();
  if(probe){
    config.webhookLastProbeAt=ts;
    await env.DB.prepare('UPDATE store_connections SET config_json=?,updated_at=? WHERE id=? AND client_id=?').bind(JSON.stringify(config),ts,connection.id,connection.client_id).run();
    return;
  }
  config.webhookLastReceivedAt=ts;
  config.webhookLastStatus=status||'received';
  config.webhookLastCode=code||null;
  config.webhookLastHttpStatus=Number(httpStatus)||null;
  config.webhookLastOrderId=text(orderId)||null;
  config.webhookLastExternalStoreId=text(externalStoreId)||null;
  const safeError=error?text(error).slice(0,500):null;
  await env.DB.prepare('UPDATE store_connections SET config_json=?,last_error=?,updated_at=? WHERE id=? AND client_id=?').bind(JSON.stringify(config),safeError,ts,connection.id,connection.client_id).run();
}
async function diagnostics(request,env,ctx){
  const me=await currentUser(request,env,ctx),url=new URL(request.url),clientId=resolveTenant(me,url.searchParams.get('clientId'));requirePermission(me,'orders','read');
  const requestedStore=text(url.searchParams.get('storeId'));
  const {results=[]}=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider='easyorders' ORDER BY updated_at DESC").bind(clientId).all();
  let row=results[0]||null;if(requestedStore)row=results.find(x=>text(parseConfig(x).kunStoreId)===requestedStore)||row;
  if(!row)return json({connected:false,code:'EASYORDERS_CONNECTION_NOT_FOUND',message:'لا يوجد ربط Easy Orders لهذا الحساب.'},404);
  const config=parseConfig(row),secrets=await readConnectionSecrets(env,clientId,row.id).catch(()=>({})),path=await easyOrdersWebhookPath(env,row);
  return json({connected:row.status==='connected',connectionId:row.id,status:row.status,kunStoreId:config.kunStoreId||null,externalStoreId:row.external_store_id||null,webhookUrl:`${url.origin}${path}`,secretConfigured:Boolean(text(secrets.webhook_secret)),lastSyncAt:row.last_sync_at||null,lastError:row.last_error||null,webhook:{lastReceivedAt:config.webhookLastReceivedAt||null,lastProbeAt:config.webhookLastProbeAt||null,lastStatus:config.webhookLastStatus||null,lastCode:config.webhookLastCode||null,lastHttpStatus:config.webhookLastHttpStatus||null,lastOrderId:config.webhookLastOrderId||null,lastExternalStoreId:config.webhookLastExternalStoreId||null}});
}

async function fetchV31(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v31.js'});
    if(path==='/api/commerce/order-sync/diagnostics'&&method==='GET')return diagnostics(request,env,ctx);
    const match=path.match(/^\/webhooks\/easyorders\/([^/]+)\/([^/]+)\/?$/);
    if(match){
      const connectionId=decodeURIComponent(match[1]),sentToken=decodeURIComponent(match[2]),connection=await connectionById(env,connectionId);
      if(!connection)return json({error:'ربط Easy Orders غير موجود أو غير متصل',code:'EASYORDERS_CONNECTION_NOT_FOUND'},404);
      const expected=await expectedRouteToken(env,connection);if(!safeEqual(sentToken,expected))return json({error:'Webhook URL غير صالح لهذا الربط',code:'EASYORDERS_WEBHOOK_ROUTE_INVALID'},401);
      if(method==='GET'||method==='HEAD'){
        await patchHealth(env,connection,{probe:true}).catch(()=>{});
        const headers={'X-Kun-Webhook':'easyorders','X-Kun-Webhook-Ready':'1'};
        return method==='HEAD'?new Response(null,{status:200,headers}):json({ok:true,provider:'easyorders',ready:true},200,headers);
      }
      if(method!=='POST')return json({error:'طريقة الطلب غير مدعومة',code:'METHOD_NOT_ALLOWED'},405);
      const raw=await request.text();let parsed;
      try{parsed=raw?JSON.parse(raw):{};}catch(error){await patchHealth(env,connection,{status:'rejected',code:'EASYORDERS_WEBHOOK_JSON_INVALID',httpStatus:400,error:'Webhook payload ليس JSON صالحًا'}).catch(()=>{});return json({error:'Webhook payload ليس JSON صالحًا',code:'EASYORDERS_WEBHOOK_JSON_INVALID'},400);}
      const payload=normalizeEasyOrdersWebhookPayload(parsed),headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('content-length');
      const canonical=new URL(request.url);canonical.pathname=`/webhooks/easyorders/${encodeURIComponent(connectionId)}/${encodeURIComponent(sentToken)}`;
      let response,data;
      try{
        response=await commerceV30.fetch(new Request(canonical,{method:'POST',headers,body:JSON.stringify(payload)}),env,ctx);
        data=await response.clone().json().catch(()=>({}));
      }catch(error){
        await patchHealth(env,connection,{status:'rejected',code:error?.code||'EASYORDERS_WEBHOOK_PROCESSING_FAILED',httpStatus:error?.status||500,orderId:payload.id||payload.order_id,externalStoreId:payload.store_id,error:error?.message||String(error)}).catch(()=>{});
        throw error;
      }
      const ok=response.ok&&data?.ok!==false;
      await patchHealth(env,connection,{status:ok?'accepted':'rejected',code:data?.code||(ok?'EASYORDERS_WEBHOOK_ACCEPTED':'EASYORDERS_WEBHOOK_REJECTED'),httpStatus:response.status,orderId:data?.id||payload.id||payload.order_id,externalStoreId:payload.store_id,error:ok?null:(data?.error||`HTTP ${response.status}`)}).catch(()=>{});
      return response;
    }
    return commerceV30.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'V31_ERROR',path,method},error?.status||500);}
}

export default {fetch:fetchV31,scheduled:(controller,env,ctx)=>commerceV30.scheduled?.(controller,env,ctx)};
