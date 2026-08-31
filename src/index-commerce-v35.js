import commerceV34,{SyncEntrypoint as SyncEntrypointV34} from './index-commerce-v34.js';
import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const BUILD='preview-v35-2026-08-31-canonical-order-counts';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
const text=v=>String(v??'').trim();
const num=v=>Number(v)||0;

async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV34.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});
  return me;
}

async function canonicalOrderCounts(env,{clientId,storeId=null}){
  const storeSql=storeId?' AND store_id=?':'';
  const binds=storeId?[clientId,storeId]:[clientId];
  const [summary,states]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN state IN ('pending','confirmed','preparing','shipped','deferred') THEN 1 ELSE 0 END) customer_service_active
      FROM orders WHERE client_id=?${storeSql}`).bind(...binds).first(),
    env.DB.prepare(`SELECT COALESCE(state,'pending') state,COUNT(*) total FROM orders WHERE client_id=?${storeSql} GROUP BY COALESCE(state,'pending') ORDER BY total DESC`).bind(...binds).all()
  ]);
  return {
    allOrders:num(summary?.total),
    customerServiceActive:num(summary?.customer_service_active),
    byState:(states?.results||[]).map(row=>({label:text(row.state)||'pending',value:num(row.total)}))
  };
}

async function decorateDashboardOrderCounts(request,env,ctx){
  const delegated=await commerceV34.fetch(request,env,ctx);
  if(!delegated.ok)return delegated;
  const data=await delegated.clone().json().catch(()=>null);if(!data?.overview)return delegated;
  const url=new URL(request.url),me=await currentUser(request,env,ctx),clientId=resolveTenant(me,url.searchParams.get('clientId'));
  const scope=await resolveStoreScope(env,me,clientId,text(url.searchParams.get('storeId'))||null,{write:false});
  const counts=await canonicalOrderCounts(env,{clientId,storeId:scope.storeId||null}),periodOrders=num(data.overview.totalOrders);
  data.overview.periodOrders=periodOrders;
  data.overview.allOrders=counts.allOrders;
  data.overview.customerServiceActive=counts.customerServiceActive;
  data.overview.totalOrders=counts.allOrders;
  data.overview.details=data.overview.details||{};
  data.overview.details.orders=[
    {label:'إجمالي الطلبات في شاشة الطلبات',value:counts.allOrders},
    {label:'طلبات الفترة المختارة في الداشبورد',value:periodOrders},
    {label:'طلبات خدمة العملاء النشطة',value:counts.customerServiceActive},
    {label:'الحالات الحالية لكل الطلبات',items:counts.byState}
  ];
  data.orderCountSemantics={
    canonical:true,
    totalOrders:'all-current-orders-in-selected-scope',
    periodOrders:'orders-inside-dashboard-date-range',
    customerServiceActive:"pending+confirmed+preparing+shipped+deferred"
  };
  return json(data,delegated.status);
}

async function fetchV35(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v35.js'});
    if(path==='/api/dashboard'&&method==='GET')return decorateDashboardOrderCounts(request,env,ctx);
    return commerceV34.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V35_ERROR',path,method},error?.status||500);}
}

export class SyncEntrypoint extends SyncEntrypointV34 {}

export default {
  fetch:fetchV35,
  scheduled(controller,env,ctx){return commerceV34.scheduled?.(controller,env,ctx);}
};
