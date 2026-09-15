import commerceV30 from './index-commerce-v30.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {easyOrdersWebhookPath} from './commerce-order-sync.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {board as customerServiceBoard,handleAction as handleCustomerServiceAction} from './customer-service.js';
import {dashboardData} from './dashboard-intelligence.js';
import {orderSheetSources,importOrderSheet} from './order-sheet-import.js';
import {accountingCatalog,accountingOverview,listAccountingEntries,listManagementFeeEntries,createAccountingEntry,deleteAccountingEntry,getStoreManagementFeeSettings,updateStoreManagementFeeSettings,reconcileManagementFeeForOrder,reconcileStoreManagementFees,decorateDashboardWithManagementFees,decorateProfitIntelligence} from './accounting.js';

const BUILD='preview-v31-2026-08-29-accounting';
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
  if(!r.ok||!d?.role)throw Object.assign(new Error(d?.error||'محتاج تسجّل دخول'),{status:r.ok?401:(r.status||401),code:'AUTH_REQUIRED'});
  return d;
}
async function dashboardBeginning(env,clientId,storeId=null){
  const storeClause=storeId?' AND store_id=?':'',binds=storeId?[clientId,storeId]:[clientId];
  const [orders,transactions,ads]=await Promise.all([
    env.DB.prepare(`SELECT MIN(date(date)) d FROM orders WHERE client_id=?${storeClause}`).bind(...binds).first(),
    env.DB.prepare(`SELECT MIN(date(date)) d FROM transactions WHERE client_id=?${storeClause}`).bind(...binds).first(),
    env.DB.prepare(`SELECT MIN(date(metric_date)) d FROM campaign_daily_metrics WHERE client_id=?${storeClause}`).bind(...binds).first()
  ]);
  return [orders?.d,transactions?.d,ads?.d].filter(Boolean).sort()[0]||now().slice(0,10);
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
  return json({connected:row.status==='connected',connectionId:row.id,status:row.status,kunStoreId:config.kunStoreId||null,externalStoreId:row.external_store_id||null,webhookUrl:`${url.origin}${path}`,routeMode:'connection-scoped',legacyRouteDisabled:true,legacyWebhookUrl:`${url.origin}/webhooks/easyorders`,secretConfigured:Boolean(text(secrets.webhook_secret)),lastSyncAt:row.last_sync_at||null,lastError:row.last_error||null,webhook:{lastReceivedAt:config.webhookLastReceivedAt||null,lastProbeAt:config.webhookLastProbeAt||null,lastStatus:config.webhookLastStatus||null,lastCode:config.webhookLastCode||null,lastHttpStatus:config.webhookLastHttpStatus||null,lastOrderId:config.webhookLastOrderId||null,lastExternalStoreId:config.webhookLastExternalStoreId||null}});
}
async function accountingScope(request,env,me,{write=false,body={}}={}){
  const url=new URL(request.url),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId'));
  const storeId=text(body.storeId||body.store_id||url.searchParams.get('storeId'))||null;
  return {clientId,...await resolveStoreScope(env,me,clientId,storeId,{write})};
}
function cairoToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>parts.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
function validStockDate(value){const v=text(value);if(!v)return cairoToday();if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(`${v}T00:00:00Z`)))throw Object.assign(new Error('تاريخ المخزون غير صحيح'),{status:400,code:'STOCK_DATE_INVALID'});return v;}
async function inventoryScope(request,env,me,{write=false,body={}}={}){const url=new URL(request.url),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),storeId=text(body.storeId||body.store_id||url.searchParams.get('storeId'))||null;return {clientId,...await resolveStoreScope(env,me,clientId,storeId,{write})};}
async function adjustInventory(request,env,ctx){
  const me=await currentUser(request,env,ctx);requirePermission(me,'inventory','write');const body=await request.clone().json().catch(()=>({})),scope=await inventoryScope(request,env,me,{write:true,body});
  const productId=text(body.productId||body.product_id),variantId=text(body.variantId||body.variant_id),delta=Number(body.delta),stockDate=validStockDate(body.stockDate||body.stock_date);
  if(!productId&&!variantId)throw Object.assign(new Error('اختر المنتج'),{status:400,code:'STOCK_PRODUCT_REQUIRED'});if(!Number.isFinite(delta)||delta===0)throw Object.assign(new Error('اكتب كمية غير صفرية'),{status:400,code:'STOCK_DELTA_INVALID'});
  let row,productName,updateSql,updateId,rootProductId;
  if(variantId){
    row=await env.DB.prepare(`SELECT v.id,v.product_id,v.name,v.stock,p.name product_name FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.id=? AND v.client_id=? AND v.store_id IS ?`).bind(variantId,scope.clientId,scope.storeId||null).first();
    if(!row)throw Object.assign(new Error('متغير المنتج غير موجود في المتجر الحالي'),{status:404,code:'STOCK_VARIANT_NOT_FOUND'});rootProductId=row.product_id;productName=`${row.product_name||''} — ${row.name||''}`;updateSql='UPDATE product_variants SET stock=? WHERE id=? AND client_id=?';updateId=variantId;
  }else{
    row=await env.DB.prepare('SELECT id,name,stock FROM products WHERE id=? AND client_id=? AND store_id IS ?').bind(productId,scope.clientId,scope.storeId||null).first();
    if(!row)throw Object.assign(new Error('المنتج غير موجود في المتجر الحالي'),{status:404,code:'STOCK_PRODUCT_NOT_FOUND'});rootProductId=row.id;productName=row.name;updateSql='UPDATE products SET stock=? WHERE id=? AND client_id=?';updateId=productId;
  }
  let supplierId=null,supplierName=null;if(body.supplierId||body.supplier_id){supplierId=text(body.supplierId||body.supplier_id);const supplier=await env.DB.prepare('SELECT id,name FROM suppliers WHERE id=? AND client_id=? AND store_id IS ?').bind(supplierId,scope.clientId,scope.storeId||null).first();if(!supplier)throw Object.assign(new Error('المورد غير موجود في المتجر الحالي'),{status:400,code:'STOCK_SUPPLIER_INVALID'});supplierName=supplier.name;}
  const newStock=Math.max(0,(Number(row.stock)||0)+delta),ts=now(),id=`STK-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  await env.DB.prepare(updateSql).bind(newStock,updateId,scope.clientId).run();
  await env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,scope.clientId,scope.storeId||null,rootProductId,variantId||null,productName,delta,newStock,text(body.note),supplierId,supplierName,stockDate,ts,me.email||me.name||me.role||me.id||'system').run();
  return {ok:true,id,productId:rootProductId,variantId:variantId||null,delta,newStock,stock:newStock,stockDate};
}
async function inventoryLog(request,env,ctx){
  const me=await currentUser(request,env,ctx);requirePermission(me,'inventory','read');const scope=await inventoryScope(request,env,me,{write:false}),url=new URL(request.url),limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit'))||200)),where=['client_id=?'],binds=[scope.clientId];if(scope.storeId){where.push('store_id=?');binds.push(scope.storeId);}const {results=[]}=await env.DB.prepare(`SELECT id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,created_at,created_by FROM stock_log WHERE ${where.join(' AND ')} ORDER BY COALESCE(stock_date,substr(created_at,1,10)) DESC,created_at DESC LIMIT ${limit}`).bind(...binds).all();return {ok:true,entries:results.map(x=>({...x,stock_date:x.stock_date||text(x.created_at).slice(0,10)}))};
}

async function fetchV31(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v31.js'});

    if(path==='/api/inventory/stock-adjust'&&method==='POST')return json(await adjustInventory(request,env,ctx));
    if(path==='/api/inventory/stock-log'&&method==='GET')return json(await inventoryLog(request,env,ctx));
    if(path==='/api/accounting/catalog'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'finance','read');return json({ok:true,...accountingCatalog()});
    }
    if(path==='/api/accounting/overview'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'finance','read');const scope=await accountingScope(request,env,me);
      return json(await accountingOverview(env,{clientId:scope.clientId,storeId:scope.storeId||null,from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
    }
    if(path==='/api/accounting/entries'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'finance','read');const scope=await accountingScope(request,env,me);
      return json({ok:true,entries:await listAccountingEntries(env,{clientId:scope.clientId,storeId:scope.storeId||null,from:url.searchParams.get('from'),to:url.searchParams.get('to')})});
    }
    if(path==='/api/accounting/entries'&&method==='POST'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'finance','write');const body=await request.clone().json().catch(()=>({})),scope=await accountingScope(request,env,me,{write:true,body});
      return json(await createAccountingEntry(env,{clientId:scope.clientId,storeId:scope.storeId||null,body,actor:me}),201);
    }
    const accountingDelete=path.match(/^\/api\/accounting\/entries\/([^/]+)$/);
    if(accountingDelete&&method==='DELETE'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'finance','write');const body=await request.clone().json().catch(()=>({})),scope=await accountingScope(request,env,me,{write:true,body});
      return json(await deleteAccountingEntry(env,{clientId:scope.clientId,storeId:scope.storeId||null,id:decodeURIComponent(accountingDelete[1]),actor:me}));
    }
    if(path==='/api/accounting/management-fees'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'finance','read');const scope=await accountingScope(request,env,me);
      return json({ok:true,entries:await listManagementFeeEntries(env,{clientId:scope.clientId,storeId:scope.storeId||null,from:url.searchParams.get('from'),to:url.searchParams.get('to')})});
    }
    const managementSettings=path.match(/^\/api\/admin\/stores\/([^/]+)\/management-fee$/);
    if(managementSettings&&['GET','PATCH'].includes(method)){
      const me=await currentUser(request,env,ctx);if(me.role!=='admin')return json({error:'إعداد نسبة الإدارة متاح لإدارة Kun Online فقط',code:'ADMIN_ONLY'},403);
      const body=method==='PATCH'?await request.clone().json().catch(()=>({})):{};
      const clientId=text(body.clientId||body.client_id||url.searchParams.get('clientId'));if(!clientId)return json({error:'محتاج clientId',code:'CLIENT_ID_REQUIRED'},400);
      const storeId=decodeURIComponent(managementSettings[1]);
      if(method==='GET')return json({ok:true,...await getStoreManagementFeeSettings(env,{clientId,storeId})});
      return json(await updateStoreManagementFeeSettings(env,{clientId,storeId,managementFeePct:body.managementFeePct,actor:me}));
    }

    if(path==='/api/orders/sheet-import/sources'&&method==='GET'){
      const me=await currentUser(request,env,ctx),clientId=resolveTenant(me,url.searchParams.get('clientId'));requirePermission(me,'orders','read');
      return json({ok:true,clientId,sources:orderSheetSources()});
    }
    if(path==='/api/orders/sheet-import'&&method==='POST'){
      const me=await currentUser(request,env,ctx),body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||url.searchParams.get('clientId'));requirePermission(me,'orders','write');
      const scope=await resolveStoreScope(env,me,clientId,text(body.storeId)||null,{write:true}),result=await importOrderSheet(env,{clientId,storeId:scope.storeId||null,source:body.source,rows:body.rows,actor:me});
      await reconcileStoreManagementFees(env,{clientId,storeId:scope.storeId||null}).catch(()=>{});
      return json(result);
    }
    if(path==='/api/dashboard'&&method==='GET'){
      const me=await currentUser(request,env,ctx),clientId=resolveTenant(me,url.searchParams.get('clientId'));requirePermission(me,'analytics','read');
      const scope=await resolveStoreScope(env,me,clientId,text(url.searchParams.get('storeId'))||null,{write:false});
      let from=url.searchParams.get('from');if(from==='beginning')from=await dashboardBeginning(env,clientId,scope.storeId||null);
      const data=await dashboardData(env,{clientId,storeId:scope.storeId||null,from,to:url.searchParams.get('to')});
      return json(await decorateDashboardWithManagementFees(env,data,{clientId,storeId:scope.storeId||null}));
    }
    if(path==='/api/profit-intelligence'&&method==='GET'){
      const me=await currentUser(request,env,ctx),clientId=resolveTenant(me,url.searchParams.get('clientId'));requirePermission(me,'profit','read');
      const scope=await resolveStoreScope(env,me,clientId,text(url.searchParams.get('storeId'))||null,{write:false}),response=await commerceV30.fetch(request,env,ctx),data=await response.clone().json().catch(()=>({}));
      if(!response.ok)return response;return json(await decorateProfitIntelligence(env,data,{clientId,storeId:scope.storeId||null,from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
    }
    if(path==='/api/customer-service'&&method==='GET'){
      const me=await currentUser(request,env,ctx);return json(await customerServiceBoard(request,env,me));
    }
    if(path.startsWith('/api/customer-service/orders/')){
      const me=await currentUser(request,env,ctx),result=await handleCustomerServiceAction(request,env,me,req=>commerceV30.fetch(req,env,ctx));
      const stateMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/state$/);if(result.status>=200&&result.status<300&&stateMatch)await reconcileManagementFeeForOrder(env,decodeURIComponent(stateMatch[1])).catch(()=>{});
      return json(result.data,result.status||200);
    }
    if(path==='/api/commerce/order-sync/diagnostics'&&method==='GET')return diagnostics(request,env,ctx);
    if(/^\/webhooks\/easyorders\/?$/.test(path)){
      const headers={'X-Kun-Webhook':'easyorders','X-Kun-Webhook-Deprecated':'1'};
      if(method==='HEAD')return new Response(null,{status:410,headers});
      return json({error:'رابط Webhook العام قديم وغير مدعوم على Preview. استخدم الرابط الفريد الظاهر داخل Kun Online لهذا الربط.',code:'EASYORDERS_WEBHOOK_LEGACY_ROUTE_DISABLED'},410,headers);
    }
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
      if(ok&&data?.id)await reconcileManagementFeeForOrder(env,data.id).catch(()=>{});
      await patchHealth(env,connection,{status:ok?'accepted':'rejected',code:data?.code||(ok?'EASYORDERS_WEBHOOK_ACCEPTED':'EASYORDERS_WEBHOOK_REJECTED'),httpStatus:response.status,orderId:data?.id||payload.id||payload.order_id,externalStoreId:payload.store_id,error:ok?null:(data?.error||`HTTP ${response.status}`)}).catch(()=>{});
      return response;
    }
    const delegated=await commerceV30.fetch(request,env,ctx);
    const orderMutation=path.match(/^\/api\/orders\/([^/]+)$/);if(delegated.ok&&orderMutation&&['PATCH','PUT'].includes(method))await reconcileManagementFeeForOrder(env,decodeURIComponent(orderMutation[1])).catch(()=>{});
    return delegated;
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'V31_ERROR',path,method},error?.status||500);}
}

export default {fetch:fetchV31,scheduled:(controller,env,ctx)=>commerceV30.scheduled?.(controller,env,ctx)};