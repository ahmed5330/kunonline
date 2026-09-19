import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {dashboardData} from './dashboard-intelligence.js';
import {accountingOverview,decorateDashboardWithManagementFees} from './accounting.js';

const text=v=>String(v??'').trim();
const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const monthRe=/^\d{4}-\d{2}$/;

function cairoToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(x=>x.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function monthRange(value){
  const today=cairoToday(),month=monthRe.test(text(value))?text(value):today.slice(0,7),[year,m]=month.split('-').map(Number);
  const last=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
  return {month,from:`${month}-01`,to:month===today.slice(0,7)?today:last};
}
async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});
  return data;
}
async function categoryBreakdown(env,{clientId,storeId,from,to}){
  const binds=[clientId];let where='client_id=?';
  if(storeId){where+=' AND store_id=?';binds.push(storeId);}
  where+=' AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)';binds.push(from,to);
  const {results=[]}=await env.DB.prepare(`SELECT type,COALESCE(NULLIF(category,''),'أخرى') category,COALESCE(SUM(amount),0) amount,COUNT(*) entries FROM transactions WHERE ${where} GROUP BY type,COALESCE(NULLIF(category,''),'أخرى') ORDER BY amount DESC`).bind(...binds).all();
  return results.map(x=>({type:x.type,category:x.category,amount:r2(x.amount),entries:Number(x.entries)||0}));
}
async function storeName(env,clientId,storeId){
  if(!storeId)return {name:'كل المتاجر',currency:'EGP'};
  return await env.DB.prepare('SELECT name,currency FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first()||{name:'المتجر المحدد',currency:'EGP'};
}

export async function handleAccountingMonthly({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/accounting/monthly'||request.method.toUpperCase()!=='GET')return null;
  try{
    const me=await currentUser(request,env,ctx,delegate);requirePermission(me,'finance','read');
    const clientId=resolveTenant(me,url.searchParams.get('clientId'));
    const requestedStore=text(url.searchParams.get('storeId'))||null;
    const scope=await resolveStoreScope(env,me,clientId,requestedStore,{write:false});
    const period=monthRange(url.searchParams.get('month'));
    const [dashboardRaw,overview,categories,store]=await Promise.all([
      dashboardData(env,{clientId,storeId:scope.storeId||null,from:period.from,to:period.to}),
      accountingOverview(env,{clientId,storeId:scope.storeId||null,from:period.from,to:period.to}),
      categoryBreakdown(env,{clientId,storeId:scope.storeId||null,from:period.from,to:period.to}),
      storeName(env,clientId,scope.storeId||null)
    ]);
    const dashboard=await decorateDashboardWithManagementFees(env,dashboardRaw,{clientId,storeId:scope.storeId||null});
    const finance=dashboard.finance||{},expenseBreakdown=finance.expenseBreakdown||{},salesRevenue=r2(finance.revenue??dashboard.overview?.expectedRevenue),operatingNetProfit=r2(finance.netProfit),otherIncome=r2(overview.manualIncome),accountingNetProfit=r2(operatingNetProfit+otherIncome);
    const manualExpenses=r2(overview.manualExpenses),managementFees=r2(overview.managementFees);
    return json({
      ok:true,clientId,storeId:scope.storeId||null,storeName:store?.name||overview.storeName||'كل المتاجر',currency:dashboard.currency||store?.currency||overview.currency||'EGP',period,
      sales:{revenue:salesRevenue,deliveredRevenue:r2(overview.deliveredRevenue),collectedRevenue:r2(overview.collectedRevenue),orders:Number(dashboard.overview?.totalOrders)||0},
      costs:{productCost:r2(finance.productCost),ads:r2(expenseBreakdown.ads),shipping:r2(expenseBreakdown.shipping),orderOther:r2(expenseBreakdown.orderOther),general:r2(expenseBreakdown.general),admin:r2(expenseBreakdown.admin),managementFees,manualExpenses,operatingExpenses:r2(finance.expenses)},
      profit:{grossProfit:r2(finance.grossProfit),operatingNetProfit,otherIncome,accountingNetProfit,marginPct:salesRevenue?r2(accountingNetProfit/salesRevenue*100):0},
      cash:{collectedRevenue:r2(overview.collectedRevenue),manualIncome:otherIncome,manualExpenses,managementFees,registeredNetCash:r2(overview.netCash)},
      manual:{income:otherIncome,expenses:manualExpenses,entries:Number(overview.entries)||0,categories},
      quality:{productCostSource:dashboard.overview?.productCostSource||dashboard.costing?.source||null,adSpendSource:dashboard.ads?.spendSource||null,managementFeeOrders:Number(overview.managementActiveOrders)||0},
      formula:{salesRevenue:'مبيعات الطلبات غير الملغاة وغير المرتجعة',operatingNetProfit:'المبيعات - تكلفة المنتج - مصروفات التشغيل',accountingNetProfit:'صافي الربح التشغيلي + الإيرادات اليدوية الأخرى',cash:'التحصيل الفعلي منفصل عن إيراد المبيعات لتجنب التكرار'}
    });
  }catch(error){return json({error:error?.message||'تعذر تحميل الحساب الشهري',code:error?.code||'ACCOUNTING_MONTHLY_ERROR'},error?.status||500);}
}
