import commerceV29 from './index-commerce-v29.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope,requestedStoreId} from './store-scope.js';
import {orderSyncProviders,startOrderSync,handleEasyOrdersWebhook} from './commerce-order-sync.js';
import {reconcileManagementFeeForOrder} from './accounting.js';
import {listInventoryBatches,createInventoryBatch,assertProductCanDelete} from './inventory-batches.js';
const BUILD='preview-v30-2026-08-29-stock-batches',json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
async function currentUser(request,env,ctx){const u=new URL(request.url);u.pathname='/api/me';u.search='';const r=await commerceV29.fetch(new Request(u,{headers:request.headers}),env,ctx),d=await r.json().catch(()=>({}));if(!r.ok||!d.role)throw Object.assign(new Error(d.error||'محتاج تسجّل دخول'),{status:r.status||401});return d;}
async function fetchV30(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v30.js'});
    const easyRoute=path.match(/^\/webhooks\/easyorders(?:\/([^/]+)\/([^/]+))?$/);
    if(easyRoute&&method==='POST'){
      const scoped=Boolean(easyRoute[1]&&easyRoute[2]),result=await handleEasyOrdersWebhook(request,env,{connectionId:scoped?decodeURIComponent(easyRoute[1]):null,routeToken:scoped?decodeURIComponent(easyRoute[2]):''});
      if(result)return json(result);
      if(scoped)return json({error:'Webhook payload غير مدعوم',code:'EASYORDERS_WEBHOOK_PAYLOAD_UNSUPPORTED'},400);
      return commerceV29.fetch(request,env,ctx);
    }

    if(path==='/api/inventory/batches'&&method==='GET'){
      const me=await currentUser(request,env,ctx),clientId=resolveTenant(me,url.searchParams.get('clientId'));requirePermission(me,'inventory','read');
      const requested=String(url.searchParams.get('storeId')||'').trim()||null,scope=await resolveStoreScope(env,me,clientId,requested,{write:false});
      const activeOnly=['1','true','yes'].includes(String(url.searchParams.get('activeOnly')||'').toLowerCase());
      return json(await listInventoryBatches(env,{clientId,storeId:scope.storeId||null,activeOnly}));
    }
    if(path==='/api/inventory/batches'&&method==='POST'){
      const me=await currentUser(request,env,ctx),body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId'));requirePermission(me,'inventory','write');
      const requested=String(body.storeId||body.store_id||url.searchParams.get('storeId')||'').trim();if(!requested)return json({error:'اختار المتجر قبل إضافة استوك جديد',code:'STOCK_BATCH_STORE_REQUIRED'},400);
      const scope=await resolveStoreScope(env,me,clientId,requested,{write:true});return json(await createInventoryBatch(env,{clientId,storeId:scope.storeId,name:body.name,stockDate:body.stockDate||body.stock_date,note:body.note,items:body.items,actor:me}),201);
    }

    const productDelete=path.match(/^\/api\/products\/([^/]+)$/);
    if(productDelete&&method==='DELETE'){
      const me=await currentUser(request,env,ctx),productId=decodeURIComponent(productDelete[1]),product=await env.DB.prepare('SELECT id,client_id,store_id FROM products WHERE id=?').bind(productId).first();if(!product)return json({error:'المنتج مش موجود'},404);
      const clientId=resolveTenant(me,url.searchParams.get('clientId')||me.clientId);if(String(product.client_id)!==String(clientId))return json({error:'مش مسموح'},403);requirePermission(me,'products','write');
      const requested=String(url.searchParams.get('storeId')||product.store_id||'').trim()||null,scope=await resolveStoreScope(env,me,clientId,requested,{write:true});if(scope.storeId&&String(product.store_id||'')!==String(scope.storeId))return json({error:'المنتج غير موجود في هذا الفرع'},404);
      await assertProductCanDelete(env,{clientId,storeId:product.store_id||scope.storeId||null,productId});return commerceV29.fetch(request,env,ctx);
    }

    if(!path.startsWith('/api/commerce/order-sync'))return commerceV29.fetch(request,env,ctx);
    const user=await currentUser(request,env,ctx),body=method==='POST'?await request.clone().json().catch(()=>({})):{};
    const clientId=resolveTenant(user,body.clientId||url.searchParams.get('clientId'));requirePermission(user,'orders',method==='GET'?'read':'write');
    const scope=await resolveStoreScope(env,user,clientId,requestedStoreId(request,body),{write:method!=='GET'}),args={clientId,storeId:scope.storeId||null,providerId:body.provider,mode:body.mode};
    if(path==='/api/commerce/order-sync/providers'&&method==='GET')return json(await orderSyncProviders(env,clientId,args.storeId));
    if(path==='/api/commerce/order-sync'&&method==='POST')return json(await startOrderSync(env,args));
    return json({error:'المسار غير مدعوم',code:'METHOD_NOT_ALLOWED'},405);
  }catch(error){return json({error:error?.message||'فشل العملية',code:error?.code||'COMMERCE_V30_ERROR'},error?.status||500);}
}

export async function reconcileAutomaticManagementFees(env,{limit=1000}={}){
  const cap=Math.min(5000,Math.max(1,Number(limit)||1000));
  const {results=[]}=await env.DB.prepare(`SELECT o.id
    FROM orders o
    JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id
    LEFT JOIN order_management_fees f ON f.order_id=o.id AND f.client_id=o.client_id
    WHERE o.store_id IS NOT NULL AND (
      (o.state IN ('shipped','signed','collected') AND (
        (f.order_id IS NULL AND COALESCE(s.management_fee_pct,0)>0)
        OR (f.order_id IS NOT NULL AND f.status<>'active')
      ))
      OR (o.state IN ('returned','cancelled') AND f.status='active')
    )
    ORDER BY COALESCE(o.date,o.created_at) DESC
    LIMIT ?`).bind(cap).all();
  const out={ok:true,processed:0,active:0,reversed:0,failed:0};
  for(const row of results){
    try{
      const result=await reconcileManagementFeeForOrder(env,row.id);out.processed++;
      if(result?.status==='active')out.active++;
      if(result?.status==='reversed')out.reversed++;
    }catch{out.failed++;}
  }
  return out;
}

async function runScheduledThenReconcile(controller,env,ctx){
  const pending=[];
  const nestedCtx=Object.create(ctx||null);
  nestedCtx.waitUntil=promise=>{if(promise)pending.push(Promise.resolve(promise));};
  let returned;
  try{returned=commerceV29.scheduled?.(controller,env,nestedCtx);}catch(error){pending.push(Promise.reject(error));}
  if(returned&&typeof returned.then==='function')pending.push(Promise.resolve(returned));
  await Promise.allSettled(pending);
  return reconcileAutomaticManagementFees(env);
}

export default {
  fetch:fetchV30,
  scheduled(controller,env,ctx){
    const task=runScheduledThenReconcile(controller,env,ctx);
    ctx?.waitUntil?.(task);
    return task;
  }
};
