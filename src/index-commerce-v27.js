import commerceV26 from './index-commerce-v26.js';
import {assertFeatureEnabled,getTenantFeatures} from './feature-entitlements.js';
import {
  walletSnapshot,listWalletLog,requestTopup,listTopups,listPendingTopupsAdmin,
  approveTopup,rejectTopup,billOrder,reconcileUnbilledOrders,adminCreditWallet,sanitizeLegacyStateBilling,syncLegacyBillingMirrors
} from './wallet-billing.js';
import {orderById,recordOrderEvent,recordOrderMutation,addOrderNote,logContact,timeline} from './order-events.js';
import {campaignPerformance,saveAttribution,businessBrief,persistBrief,dateRange} from './marketing-intelligence.js';
import {enrichBusinessBriefWithAI} from './ai-provider.js';
import {listAdDrafts,createAdDraft,getAdDraft,generateAdDraft,requestAdAction} from './ad-studio.js';
import {
  requireAdmin,listAdminClients,clientOverview,updateClientModules,updateClientBilling,
  migrateClientBilling,addClientNote,createAdminClient,updateClientStatus,resetClientOwnerPassword
} from './admin-control.js';
import {resolveStoreScope,requestedStoreId} from './store-scope.js';
import {requirePermission} from './access-control.js';
import {stageBoard} from './order-routing.js';

const BUILD='preview-v27-2026-08-27';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'
}});
const isWrite=m=>['POST','PUT','PATCH','DELETE'].includes(String(m||'').toUpperCase());
const safeEqual=(a,b)=>{a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;

function normalizeCustomerPhone(raw){
  let d=String(raw||'').replace(/[^\d]/g,'');
  if(d.startsWith('0020'))d='0'+d.slice(4);else if(d.startsWith('20')&&d.length===12)d='0'+d.slice(2);
  else if(d.startsWith('00966'))d='0'+d.slice(5);else if(d.startsWith('966')&&d.length===12)d='0'+d.slice(3);
  if(/^01\d{9}$/.test(d)||/^05\d{8}$/.test(d))return d;
  return null;
}
async function createStandaloneCustomer(env,{clientId,storeId,body,actor}){
  const phone=normalizeCustomerPhone(body.phone);if(!phone)throw Object.assign(new Error('رقم الهاتف غير صحيح'),{status:400,code:'PHONE_INVALID'});
  const name=String(body.name||'').trim();if(!name)throw Object.assign(new Error('اسم العميل مطلوب'),{status:400,code:'CUSTOMER_NAME_REQUIRED'});
  const existing=await env.DB.prepare('SELECT id,name,phone FROM customers WHERE client_id=? AND store_id IS ? AND phone=?').bind(clientId,storeId||null,phone).first();
  if(existing)return {ok:true,existing:true,id:existing.id,customer:existing};
  const id=rid('CUS'),ts=new Date().toISOString(),tags=Array.isArray(body.tags)?JSON.stringify(body.tags.map(String)):'[]';
  await env.DB.batch([
    env.DB.prepare('INSERT INTO customers (id,client_id,store_id,name,phone,gov,address,tags,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,clientId,storeId||null,name,phone,String(body.gov||''),String(body.address||''),tags,String(body.note||''),ts),
    env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(rid('AUD'),clientId,storeId||null,actor?.uid||null,actor?.email||actor?.role||'user','customer.create','customer',id,JSON.stringify({source:'v27-ui'}),ts)
  ]);
  return {ok:true,id,customer:{id,clientId,storeId:storeId||null,name,phone,gov:String(body.gov||''),address:String(body.address||''),tags:JSON.parse(tags),note:String(body.note||'')}};
}


async function currentUser(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const response=await commerceV26.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}

async function bodyOf(request){return isWrite(request.method)?await request.clone().json().catch(()=>({})):{};}
function requestedClient(me,url,body={}){
  const requested=body.clientId||body.client_id||url.searchParams.get('clientId')||null;
  if(me?.clientId){
    if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات حساب آخر'),{status:403,code:'TENANT_ISOLATION'});
    return me.clientId;
  }
  return requested;
}
async function scopeFor(env,me,clientId,request,body={}){
  if(!clientId)return {clientId:null,storeId:null,unrestricted:true};
  return resolveStoreScope(env,me,clientId,requestedStoreId(request,body),{write:isWrite(request.method)});
}
function featureSkip(path){return path==='/api/me'||path==='/api/login'||path==='/api/logout'||path==='/api/setup'||path==='/api/my-store-context'||path==='/api/tenant/features'||path.startsWith('/api/admin/')||path.startsWith('/api/preview/');}
async function audit(env,me,clientId,storeId,action,entityType,entityId,metadata={}){
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId||null,storeId||null,me?.uid||null,me?.email||me?.role||'system',action,entityType||null,entityId||null,JSON.stringify(metadata||{}),new Date().toISOString()).run();}catch{}
}

async function routeV27(request,env,ctx,me,url,body){
  const path=url.pathname,method=request.method.toUpperCase();
  if(path==='/api/tenant/features'&&method==='GET'){
    const clientId=requestedClient(me,url,body);if(!clientId)return json({error:'محتاج clientId',code:'CLIENT_ID_REQUIRED'},400);
    return json({clientId,...await getTenantFeatures(env,clientId)});
  }
  if(path==='/api/state'&&method==='PUT'){
    const sanitized=await sanitizeLegacyStateBilling(env,structuredClone(body||{}));
    const headers=new Headers(request.headers);headers.set('Content-Type','application/json');
    return commerceV26.fetch(new Request(request.url,{method:'PUT',headers,body:JSON.stringify(sanitized)}),env,ctx);
  }
  if(path==='/api/wallet/topup'&&method==='POST'){
    requireAdmin(me);if(!body.clientId)return json({error:'محتاج clientId'},400);
    return json(await adminCreditWallet(env,String(body.clientId),Number(body.amount),me.email||me.uid||'admin',body.note||'Manual admin credit'));
  }

  if(path==='/api/admin/clients'&&method==='GET'){requireAdmin(me);return json(await listAdminClients(env));}
  if(path==='/api/admin/clients'&&method==='POST'){requireAdmin(me);return json(await createAdminClient(env,body,me),201);}
  let m=path.match(/^\/api\/admin\/clients\/([^/]+)\/overview$/);
  if(m&&method==='GET'){requireAdmin(me);return json(await clientOverview(env,decodeURIComponent(m[1])));}
  m=path.match(/^\/api\/admin\/clients\/([^/]+)\/modules$/);
  if(m&&method==='PATCH'){requireAdmin(me);const clientId=decodeURIComponent(m[1]);return json(await updateClientModules(env,clientId,body,me));}
  m=path.match(/^\/api\/admin\/clients\/([^/]+)\/billing$/);
  if(m&&method==='PATCH'){requireAdmin(me);const clientId=decodeURIComponent(m[1]);return json(await updateClientBilling(env,clientId,body,me));}
  m=path.match(/^\/api\/admin\/clients\/([^/]+)\/billing\/migrate$/);
  if(m&&method==='POST'){requireAdmin(me);const clientId=decodeURIComponent(m[1]);return json(await migrateClientBilling(env,clientId,me));}
  m=path.match(/^\/api\/admin\/clients\/([^/]+)\/notes$/);
  if(m&&method==='POST'){requireAdmin(me);const clientId=decodeURIComponent(m[1]);return json(await addClientNote(env,clientId,body,me),201);}
  m=path.match(/^\/api\/admin\/clients\/([^/]+)\/status$/);
  if(m&&method==='PATCH'){requireAdmin(me);const clientId=decodeURIComponent(m[1]);return json(await updateClientStatus(env,clientId,body,me));}
  m=path.match(/^\/api\/admin\/clients\/([^/]+)\/reset-owner-password$/);
  if(m&&method==='POST'){requireAdmin(me);const clientId=decodeURIComponent(m[1]);return json(await resetClientOwnerPassword(env,clientId,body,me));}
  if(path==='/api/admin/wallet/topups'&&method==='GET'){requireAdmin(me);return json(await listPendingTopupsAdmin(env,url.searchParams.get('limit')||200));}
  m=path.match(/^\/api\/admin\/wallet\/topups\/([^/]+)\/(approve|reject)$/);
  if(m&&method==='POST'){
    requireAdmin(me);const topupId=decodeURIComponent(m[1]);
    const actor=me.email||me.uid||'admin',note=String(body.note||'');
    return json(m[2]==='approve'?await approveTopup(env,topupId,actor,note):await rejectTopup(env,topupId,actor,note));
  }

  const clientId=requestedClient(me,url,body);
  if(!clientId)return null;
  if(!featureSkip(path))await assertFeatureEnabled(env,me,clientId,path);
  const needsStoreScope=(path==='/api/customers'&&method==='POST')||path.startsWith('/api/orders/')||path==='/api/order-attribution'||path==='/api/marketing/performance'||path==='/api/ai/business-brief'||path.startsWith('/api/ad-studio');
  const scope=needsStoreScope?await scopeFor(env,me,clientId,request,body):{storeId:null};
  const storeId=scope.storeId||null;

  if(path==='/api/customers'&&method==='POST'){requirePermission(me,'customers','write');return json(await createStandaloneCustomer(env,{clientId,storeId,body,actor:me}),201);}

  if(path==='/api/wallet'&&method==='GET'){
    if(me.role!=='client')requirePermission(me,'wallet','read');
    return json(await walletSnapshot(env,clientId));
  }
  if(path==='/api/wallet/log'&&method==='GET'){
    if(me.role!=='client')requirePermission(me,'wallet','read');
    return json(await listWalletLog(env,clientId,url.searchParams.get('limit')));
  }
  if(path==='/api/wallet/topups'&&method==='GET'){
    if(me.role!=='client')requirePermission(me,'wallet','read');return json(await listTopups(env,clientId,{status:url.searchParams.get('status')||null,limit:url.searchParams.get('limit')||100}));
  }
  if(path==='/api/wallet/topups'&&method==='POST'){
    if(me.role!=='client')requirePermission(me,'wallet','topup');return json(await requestTopup(env,clientId,body,me.email||me.uid||me.role),201);
  }

  if(path==='/api/orders/stage-board'&&method==='GET'){requirePermission(me,'orders','read');return json(await stageBoard(env,{clientId,storeId}));}
  m=path.match(/^\/api\/orders\/([^/]+)\/timeline$/);
  if(m&&method==='GET'){requirePermission(me,'orders','read');return json(await timeline(env,{clientId,storeId,orderId:decodeURIComponent(m[1])}));}
  m=path.match(/^\/api\/orders\/([^/]+)\/notes$/);
  if(m&&method==='POST'){requirePermission(me,'orders','update');return json(await addOrderNote(env,{clientId,storeId,orderId:decodeURIComponent(m[1]),body,actor:me}),201);}
  m=path.match(/^\/api\/orders\/([^/]+)\/contact$/);
  if(m&&method==='POST'){requirePermission(me,'orders','update');return json(await logContact(env,{clientId,storeId,orderId:decodeURIComponent(m[1]),body,actor:me}),201);}

  if(path==='/api/order-attribution'&&method==='POST'){requirePermission(me,'campaigns','write');return json(await saveAttribution(env,{clientId,storeId,body,actor:me}),201);}
  if(path==='/api/marketing/performance'&&method==='GET'){
    requirePermission(me,'campaigns','read');const range=dateRange(url);return json(await campaignPerformance(env,{clientId,storeId,...range}));
  }
  if(path==='/api/ai/business-brief'&&method==='GET'){
    requirePermission(me,'ai','read');const range=dateRange(url),base=await businessBrief(env,{clientId,storeId,...range});
    const enriched=await enrichBusinessBriefWithAI(env,base);await persistBrief(env,{clientId,storeId,brief:enriched,actor:me});return json(enriched);
  }

  if(path==='/api/ad-studio/drafts'&&method==='GET'){requirePermission(me,'ads','read');return json(await listAdDrafts(env,{clientId,storeId}));}
  if(path==='/api/ad-studio/drafts'&&method==='POST'){requirePermission(me,'ads','write');return json(await createAdDraft(env,{clientId,storeId,body,actor:me}),201);}
  m=path.match(/^\/api\/ad-studio\/drafts\/([^/]+)$/);
  if(m&&method==='GET'){requirePermission(me,'ads','read');return json(await getAdDraft(env,{clientId,storeId,draftId:decodeURIComponent(m[1])}));}
  m=path.match(/^\/api\/ad-studio\/drafts\/([^/]+)\/generate$/);
  if(m&&method==='POST'){requirePermission(me,'ads','write');return json(await generateAdDraft(env,{clientId,storeId,draftId:decodeURIComponent(m[1]),body,actor:me}));}
  m=path.match(/^\/api\/ad-studio\/drafts\/([^/]+)\/actions$/);
  if(m&&method==='POST'){requirePermission(me,'ads','write');return json(await requestAdAction(env,{clientId,storeId,draftId:decodeURIComponent(m[1]),body,actor:me}),202);}
  return null;
}

async function filterLegacyStateByFeatures(env,me,url,response){
  if(!response.ok||url.pathname!=='/api/state'||me?.role==='admin')return response;
  const clientId=requestedClient(me,url,{});if(!clientId)return response;
  const features=await getTenantFeatures(env,clientId);if(!features.configured)return response;
  const data=await response.clone().json().catch(()=>null);if(!data||typeof data!=='object')return response;
  if(features.modules.orders?.enabled===false)data.orders=[];
  if(features.modules.catalog?.enabled===false)data.products=[];
  if(features.modules.stores?.enabled===false){delete data.stores;delete data.branches;}
  return json(data,response.status);
}

async function postProcess(request,env,ctx,me,url,body,response){
  if(!response.ok)return response;
  const path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/orders'&&method==='POST'){
      const data=await response.clone().json().catch(()=>({}));const orderId=data.id||data.order?.id||body.id;
      const clientId=requestedClient(me,url,body);if(clientId&&orderId){
        const order=await env.DB.prepare('SELECT store_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
        ctx?.waitUntil?.(billOrder(env,orderId).catch(()=>null));
        ctx?.waitUntil?.(recordOrderEvent(env,{clientId,storeId:order?.store_id||body.storeId||null,orderId,eventType:'order.created',actor:me,metadata:{source:body.source||'manual'}}).catch(()=>null));
      }
    }else if(path==='/api/wa-order'&&method==='POST'){
      const data=await response.clone().json().catch(()=>({}));const clientId=body.clientId||body.client_id,orderId=data.id||data.order?.id;
      if(clientId&&orderId){ctx?.waitUntil?.(billOrder(env,orderId).catch(()=>null));ctx?.waitUntil?.(recordOrderEvent(env,{clientId,storeId:data.order?.storeId||null,orderId,eventType:'order.created.whatsapp',actor:{email:'system@kun-online',role:'system'},metadata:{source:'whatsapp'}}).catch(()=>null));}
    }else if(path==='/api/orders/bulk'&&method==='POST'){
      const clientId=body.clientId||body.client_id;if(clientId)ctx?.waitUntil?.(reconcileUnbilledOrders(env,{clientId,limit:300}).catch(()=>null));
    }else if(path==='/webhooks/easyorders'&&method==='POST'){
      const data=await response.clone().json().catch(()=>({}));const orderId=data.id||body.id;
      if(orderId){const row=await env.DB.prepare('SELECT client_id,store_id FROM orders WHERE id=?').bind(orderId).first();if(row){ctx?.waitUntil?.(billOrder(env,orderId).catch(()=>null));ctx?.waitUntil?.(recordOrderEvent(env,{clientId:row.client_id,storeId:row.store_id,orderId,eventType:'order.created.integration',actor:{email:'easyorders@system',role:'system'},metadata:{provider:'easyorders'}}).catch(()=>null));}}
    }
  }catch{}
  return response;
}

async function fetchV27(request,env,ctx={}){
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v27.js'});
    if(['/api/me','/api/login','/api/setup','/api/logout','/api/preview-admin-recovery'].includes(path))return commerceV26.fetch(request,env,ctx);
    const bearer=(request.headers.get('authorization')||'').trim(),bearerToken=bearer.replace(/^Bearer\s+/i,'');
    if(env.INGEST_TOKEN&&/^Bearer\s+/i.test(bearer)&&safeEqual(bearerToken,env.INGEST_TOKEN)){
      const ingestBody=isWrite(request.method)?await request.clone().json().catch(()=>({})):{};
      const legacy=await commerceV26.fetch(request,env,ctx);
      return postProcess(request,env,ctx,null,url,ingestBody,legacy);
    }
    let me=null,body={};
    if(path.startsWith('/webhooks/')&&request.method.toUpperCase()==='POST')body=await request.clone().json().catch(()=>({}));
    if(path.startsWith('/api/')){me=await currentUser(request,env,ctx);body=await bodyOf(request);const routed=await routeV27(request,env,ctx,me,url,body);if(routed)return routed;
      if(!featureSkip(path)){const clientId=requestedClient(me,url,body);if(clientId)await assertFeatureEnabled(env,me,clientId,path);}
    }
    let before=null;
    const orderMatch=path.match(/^\/api\/orders\/([^/]+)$/);
    if(orderMatch&&['PATCH','PUT'].includes(request.method.toUpperCase())&&me){
      const clientId=requestedClient(me,url,body);if(clientId){const scope=await scopeFor(env,me,clientId,request,body);before=await orderById(env,clientId,decodeURIComponent(orderMatch[1]),scope.storeId||null);}
    }
    let response=await commerceV26.fetch(request,env,ctx);
    response=await filterLegacyStateByFeatures(env,me,url,response);
    if(before&&response.ok&&orderMatch){const clientId=before.client_id,after=await orderById(env,clientId,before.id,before.store_id||null);ctx?.waitUntil?.(recordOrderMutation(env,before,after,me).catch(()=>null));}
    return await postProcess(request,env,ctx,me,url,body,response);
  }catch(error){
    if(env.APP_ENV!=='preview')throw error;
    return json({error:error?.message||'Unhandled Preview error',code:error?.code||'UNHANDLED_PREVIEW_ERROR',path,method:request.method,build:BUILD},error?.status||500);
  }
}

export default {
  fetch:fetchV27,
  scheduled(controller,env,ctx){
    ctx?.waitUntil?.(Promise.all([syncLegacyBillingMirrors(env).catch(()=>[]),reconcileUnbilledOrders(env,{limit:150}).catch(()=>[])]));
    return commerceV26.scheduled?.(controller,env,ctx);
  }
};
