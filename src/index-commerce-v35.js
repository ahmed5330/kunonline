import commerceV34,{SyncEntrypoint as SyncEntrypointV34} from './index-commerce-v34.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {computeDashboardSnapshot} from './dashboard-intelligence.js';
import {campaignPerformance} from './marketing-performance.js';
import {decorateDashboardWithManagementFees} from './accounting.js';
import {prepareIncomingEasyOrdersDedupeV2,prepareEasyOrdersSheetRowsV2,reconcileEasyOrdersDuplicates,reconcileAllEasyOrdersDuplicates,duplicateIdsForOrders} from './order-deduplication-v2.js';

const BUILD='preview-v35-2026-08-31-daily-orders-dedupe-v2';
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...extra}});
const text=v=>String(v??'').trim();
const num=v=>Number(v)||0;
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
function cairoToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>parts.find(x=>x.type===t)?.value||'';return `${g('year')}-${g('month')}-${g('day')}`;}
function parseDate(value,fallback){const v=text(value);return isoDate.test(v)?v:fallback;}
function hasAuth(request){return Boolean(text(request.headers.get('cookie'))||text(request.headers.get('authorization')));}
function authRequired(){return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);}

async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV34.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});
  return me;
}
function jsonRequest(request,body){const headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('content-length');return new Request(request.url,{method:request.method,headers,body:JSON.stringify(body)});}
async function duplicateFilteredResponse(response,env){if(!response.ok)return response;const data=await response.clone().json().catch(()=>null);if(!data||!Array.isArray(data.orders))return response;const duplicateIds=await duplicateIdsForOrders(env,data.orders);if(!duplicateIds.size)return response;data.orders=data.orders.filter(order=>!duplicateIds.has(text(order.id)));data.duplicateOrdersHidden=duplicateIds.size;return json(data,response.status);}

async function canonicalOrderCounts(env,{clientId,storeId=null}){
  const storeSql=storeId?' AND o.store_id=?':'',binds=storeId?[clientId,storeId]:[clientId],today=cairoToday(),canonical=" AND NOT EXISTS (SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)";
  const [summary,todayRow,states]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN o.state IN ('pending','confirmed','preparing','shipped','deferred') THEN 1 ELSE 0 END) customer_service_active FROM orders o WHERE o.client_id=?${storeSql}${canonical}`).bind(...binds).first(),
    env.DB.prepare(`SELECT COUNT(*) total FROM orders o WHERE o.client_id=?${storeSql}${canonical} AND date(COALESCE(o.date,o.created_at))=date(?)`).bind(...binds,today).first(),
    env.DB.prepare(`SELECT COALESCE(o.state,'pending') state,COUNT(*) total FROM orders o WHERE o.client_id=?${storeSql}${canonical} GROUP BY COALESCE(o.state,'pending') ORDER BY total DESC`).bind(...binds).all()
  ]);
  return {allOrders:num(summary?.total),todayOrders:num(todayRow?.total),customerServiceActive:num(summary?.customer_service_active),byState:(states?.results||[]).map(row=>({label:text(row.state)||'pending',value:num(row.total)}))};
}
async function canonicalBeginning(env,clientId,storeId=null){const binds=storeId?[clientId,storeId]:[clientId],storeSql=storeId?' AND o.store_id=?':'';const row=await env.DB.prepare(`SELECT MIN(date(COALESCE(o.date,o.created_at))) d FROM orders o WHERE o.client_id=?${storeSql} AND NOT EXISTS (SELECT 1 FROM order_duplicate_links x WHERE x.duplicate_order_id=o.id)`).bind(...binds).first();return row?.d||cairoToday();}
async function canonicalDashboardData(env,{clientId,storeId=null,from=null,to=null}){
  const today=cairoToday(),resolvedTo=parseDate(to,today),resolvedFrom=parseDate(from,resolvedTo);if(resolvedFrom>resolvedTo)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'DATE_RANGE_INVALID'});
  const orderStore=storeId?' AND o.store_id=?':'',plainStore=storeId?' AND store_id=?':'',rangeBinds=storeId?[clientId,storeId,resolvedFrom,resolvedTo]:[clientId,resolvedFrom,resolvedTo],scopeBinds=storeId?[clientId,storeId]:[clientId],historyBinds=storeId?[clientId,storeId,today,today]:[clientId,today,today],canonical=' AND NOT EXISTS (SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)';
  const [orderResult,historyResult,transactionResult,billingResult,productResult,adsResult,aiResult,storeRow]=await Promise.all([
    env.DB.prepare(`SELECT o.id,o.client_id,o.store_id,o.date,o.created_at,o.state,o.total,o.product_cost,o.shipping_cost,o.other_cost,o.gov,o.source,o.customer_id,o.product_id,o.qty FROM orders o WHERE o.client_id=?${orderStore}${canonical} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(o.date,o.created_at),o.created_at`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT o.id,o.date,o.created_at,o.state,o.total FROM orders o WHERE o.client_id=?${orderStore}${canonical} AND date(COALESCE(o.date,o.created_at))>=date(?,'-29 day') AND date(COALESCE(o.date,o.created_at))<=date(?)`).bind(...historyBinds).all(),
    env.DB.prepare(`SELECT id,date,created_at,category,amount,note FROM transactions WHERE client_id=?${plainStore} AND type='expense' AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(date,created_at)`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT b.order_id,b.fee,b.status FROM order_billing b JOIN orders o ON o.id=b.order_id AND o.client_id=b.client_id WHERE b.client_id=?${storeId?' AND o.store_id=?':''}${canonical} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT id,cost FROM products WHERE client_id=?${plainStore}`).bind(...scopeBinds).all(),
    env.DB.prepare(`SELECT metric_date,COALESCE(SUM(spend),0) spend FROM campaign_daily_metrics WHERE client_id=?${plainStore} AND date(metric_date) BETWEEN date(?) AND date(?) GROUP BY metric_date ORDER BY metric_date`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT id,insight_type,severity,title,rationale,metric_json,suggested_payload_json,generated_at FROM ai_insight_snapshots WHERE client_id=?${storeId?' AND (store_id=? OR store_id IS NULL)':''} AND status='active' ORDER BY generated_at DESC LIMIT 30`).bind(...scopeBinds).all(),
    storeId?env.DB.prepare('SELECT currency FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first():Promise.resolve({currency:'EGP'})
  ]);
  const marketing=await campaignPerformance(env,{clientId,storeId,from:resolvedFrom,to:resolvedTo});
  return computeDashboardSnapshot({orders:orderResult.results||[],historyOrders:historyResult.results||[],transactions:transactionResult.results||[],billingRows:billingResult.results||[],products:productResult.results||[],dailyAds:adsResult.results||[],marketing,aiSnapshots:aiResult.results||[],from:resolvedFrom,to:resolvedTo,today,currency:storeRow?.currency||'EGP'});
}
async function dashboard(request,env,ctx){
  const url=new URL(request.url),me=await currentUser(request,env,ctx);requirePermission(me,'analytics','read');const clientId=resolveTenant(me,url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,text(url.searchParams.get('storeId'))||null,{write:false}),storeId=scope.storeId||null;
  const rawFrom=text(url.searchParams.get('from')),rawTo=text(url.searchParams.get('to'));
  if(rawFrom!=='beginning'&&isoDate.test(rawFrom)&&isoDate.test(rawTo)&&rawFrom>rawTo)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'DATE_RANGE_INVALID'});
  await reconcileEasyOrdersDuplicates(env,{clientId,storeId,limit:6000});
  let from=url.searchParams.get('from');if(from==='beginning')from=await canonicalBeginning(env,clientId,storeId);
  let data=await canonicalDashboardData(env,{clientId,storeId,from,to:url.searchParams.get('to')}),counts=await canonicalOrderCounts(env,{clientId,storeId});
  data=await decorateDashboardWithManagementFees(env,data,{clientId,storeId});
  data.overview.periodOrders=num(data.overview.totalOrders);data.overview.todayOrders=counts.todayOrders;data.overview.allOrders=counts.allOrders;data.overview.customerServiceActive=counts.customerServiceActive;
  data.overview.details=data.overview.details||{};data.overview.details.orders=[{label:data.from===data.today&&data.to===data.today?'أوردرات اليوم الفعلية':'أوردرات الفترة المختارة',value:num(data.overview.totalOrders)},{label:'إجمالي الأوردرات بدون المكرر',value:counts.allOrders},{label:'طلبات خدمة العملاء النشطة',value:counts.customerServiceActive},{label:'الحالات الحالية بدون المكرر',items:counts.byState}];
  data.orderCountSemantics={canonical:true,totalOrders:'actual-orders-inside-selected-date-range-after-dedupe',todayOrders:'actual-cairo-day-orders-after-dedupe',allOrders:'all-canonical-orders-in-selected-scope',duplicates:'linked-sheet-duplicates-are-excluded'};
  return json(data);
}
async function reconcileRoute(request,env,ctx){const me=await currentUser(request,env,ctx);requirePermission(me,'orders','update');const body=await request.clone().json().catch(()=>({})),url=new URL(request.url),clientId=resolveTenant(me,body.clientId||url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,text(body.storeId||url.searchParams.get('storeId'))||null,{write:true});return json(await reconcileEasyOrdersDuplicates(env,{clientId,storeId:scope.storeId||null,limit:Math.min(10000,Math.max(100,Number(body.limit)||6000))}));}
async function sheetImport(request,env,ctx){const body=await request.clone().json().catch(()=>({}));if(lower(body.source)!=='easyorders')return commerceV34.fetch(request,env,ctx);const me=await currentUser(request,env,ctx);requirePermission(me,'orders','write');const clientId=resolveTenant(me,body.clientId||new URL(request.url).searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,text(body.storeId)||null,{write:true}),prepared=await prepareEasyOrdersSheetRowsV2(env,{clientId,storeId:scope.storeId||null,rows:Array.isArray(body.rows)?body.rows:[]}),delegated=await commerceV34.fetch(jsonRequest(request,{...body,rows:prepared.rows}),env,ctx);if(!delegated.ok)return delegated;const dedupe=await reconcileEasyOrdersDuplicates(env,{clientId,storeId:scope.storeId||null,limit:8000}),data=await delegated.clone().json().catch(()=>({ok:true}));return json({...data,dedupeV2:{preMatched:prepared.deduplicated,modes:prepared.modes,...dedupe}});}
const lower=v=>text(v).toLowerCase();
async function easyOrdersWebhook(request,env,ctx,connectionId){const payload=await request.clone().json().catch(()=>({})),prepared=await prepareIncomingEasyOrdersDedupeV2(env,{connectionId,payload}),delegated=await commerceV34.fetch(request,env,ctx);if(delegated.ok&&prepared.clientId)await reconcileEasyOrdersDuplicates(env,{clientId:prepared.clientId,storeId:prepared.storeId||null,limit:8000});return delegated;}

async function fetchV35(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v35.js'});
    if(path==='/api/dashboard'&&method==='GET'){
      if(!hasAuth(request))return authRequired();
      const rawFrom=text(url.searchParams.get('from')),rawTo=text(url.searchParams.get('to'));
      if(rawFrom!=='beginning'&&isoDate.test(rawFrom)&&isoDate.test(rawTo)&&rawFrom>rawTo)return json({error:'بداية الفترة يجب أن تكون قبل نهايتها',code:'DATE_RANGE_INVALID',path,method},400);
      return await dashboard(request,env,ctx);
    }
    if(path==='/api/orders/dedupe/reconcile'&&method==='POST'){if(!hasAuth(request))return authRequired();return await reconcileRoute(request,env,ctx);}
    if(path==='/api/orders/sheet-import'&&method==='POST'){if(!hasAuth(request))return authRequired();return await sheetImport(request,env,ctx);}
    const webhook=path.match(/^\/webhooks\/easyorders\/([^/]+)\/[^/]+\/?$/);if(webhook&&method==='POST')return await easyOrdersWebhook(request,env,ctx,decodeURIComponent(webhook[1]));
    if(path==='/api/state'&&method==='GET'){const response=await commerceV34.fetch(request,env,ctx),data=await response.clone().json().catch(()=>null);if(response.ok&&Array.isArray(data?.orders)&&data.orders[0]?.clientId){const clientId=text(data.orders[0].clientId),storeId=text(data.orders[0].storeId)||null;await reconcileEasyOrdersDuplicates(env,{clientId,storeId,limit:6000}).catch(()=>{});return await duplicateFilteredResponse(response,env);}return await duplicateFilteredResponse(response,env);}
    if(path==='/api/customer-service'&&method==='GET'){if(!hasAuth(request))return authRequired();const me=await currentUser(request,env,ctx),clientId=resolveTenant(me,url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,text(url.searchParams.get('storeId'))||null,{write:false});await reconcileEasyOrdersDuplicates(env,{clientId,storeId:scope.storeId||null,limit:6000});return await duplicateFilteredResponse(await commerceV34.fetch(request,env,ctx),env);}
    return await commerceV34.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V35_ERROR',path,method},error?.status||500);}
}

export class SyncEntrypoint extends SyncEntrypointV34{
  async health(){const base=await super.health();return {...base,build:BUILD,dedupe:'easyorders-v2'};}
  async runCron(cron){const result=await super.runCron(cron);if(String(cron||'')==='*/5 * * * *')return {...(result&&typeof result==='object'?result:{result}),orderDedupe:await reconcileAllEasyOrdersDuplicates(this.env,{limitPerStore:8000})};return result;}
}

export default {fetch:fetchV35,scheduled(controller,env,ctx){return commerceV34.scheduled?.(controller,env,ctx);}};
