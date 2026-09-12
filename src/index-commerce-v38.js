import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';
import {resolveCurrentInventoryOrderCost} from './dashboard-live-product-cost-v2.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const authText=value=>/(محتاج\s+تسج|تسجيل\s+الدخول|AUTH_REQUIRED|unauthori[sz]ed|authentication\s+required)/i.test(String(value??''));
const isAuthFailure=value=>value?.code==='AUTH_REQUIRED'||authText(value?.error||value?.message);
const clean=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const round=value=>Math.round(num(value)*100)/100;
const excludedMarginStates=new Set(['cancelled','returned']);
function normalizeDashboardContract(data){
  if(!data||typeof data!=='object')return data;
  const resolved=data?.costing?.source==='current_inventory_resolved'||data?.overview?.productCostSource==='current_inventory_resolved';
  if(!resolved)return data;
  return {...data,overview:{...(data.overview||{}),productCostSource:'current_inventory'},costing:{...(data.costing||{}),source:'current_inventory',resolution:'current_inventory_resolved'}};
}
function summary(label,value,{money=false,percent=false,text=null}={}){return {label,value:round(value),money,percent,text};}
async function dashboardForInputs(request,env,ctx,{clientId,storeId,from,to}){
  const url=new URL(request.url);url.pathname='/api/dashboard';url.search='';
  if(clientId)url.searchParams.set('clientId',clientId);if(storeId)url.searchParams.set('storeId',storeId);if(from)url.searchParams.set('from',from);if(to)url.searchParams.set('to',to);
  const response=await safety.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  if(!response.ok)return {response};
  const data=normalizeDashboardContract(await response.json().catch(()=>({})));return {data};
}
async function expenseInputs(request,env,ctx,{clientId,storeId,from,to}){
  const url=new URL(request.url);url.pathname='/api/system/dashboard/expense-details';url.search='';
  if(clientId)url.searchParams.set('clientId',clientId);if(storeId)url.searchParams.set('storeId',storeId);url.searchParams.set('from',from);url.searchParams.set('to',to);url.searchParams.set('kind','all');
  const response=await safety.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);if(!response.ok)return {response};return {data:await response.json()};
}
async function revenueRows(env,{clientId,storeId,from,to}){
  const store=storeId?' AND store_id=?':'',binds=storeId?[clientId,storeId,from,to]:[clientId,from,to],{results=[]}=await env.DB.prepare(`SELECT id,ref,name,date,created_at,state,total FROM orders WHERE client_id=?${store} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(date,created_at) DESC`).bind(...binds).all();
  return results.filter(row=>!excludedMarginStates.has(clean(row.state))).map(row=>({id:row.id,date:clean(row.date||row.created_at).slice(0,10),label:`أوردر ${clean(row.ref||row.id)}`,description:`${clean(row.name)||'بدون اسم'} · ${clean(row.state)||'—'}`,amount:round(row.total)}));
}
async function productCostRows(env,{clientId,storeId,from,to}){
  const orderStore=storeId?' AND store_id=?':'',itemStore=storeId?' AND o.store_id=?':'',catalogStore=storeId?' AND store_id=?':'',rangeBinds=storeId?[clientId,storeId,from,to]:[clientId,from,to],scopeBinds=storeId?[clientId,storeId]:[clientId];
  const [orderResult,itemResult,productResult,variantResult]=await Promise.all([
    env.DB.prepare(`SELECT id,ref,name,date,created_at,state,product_id,variant_id,product,qty,product_cost FROM orders WHERE client_id=?${orderStore} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(date,created_at) DESC`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT oi.order_id,oi.product_id,oi.variant_id,oi.sku,oi.product_name,oi.qty FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.client_id=oi.client_id WHERE oi.client_id=?${itemStore} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...rangeBinds).all().catch(()=>({results:[]})),
    env.DB.prepare(`SELECT id,name,sku,cost FROM products WHERE client_id=?${catalogStore}`).bind(...scopeBinds).all(),
    env.DB.prepare(`SELECT id,product_id,name,sku,cost FROM product_variants WHERE client_id=?${catalogStore}`).bind(...scopeBinds).all()
  ]);
  const itemsByOrder=new Map();for(const item of itemResult.results||[]){const id=clean(item.order_id);if(!itemsByOrder.has(id))itemsByOrder.set(id,[]);itemsByOrder.get(id).push(item);}
  return (orderResult.results||[]).filter(order=>!excludedMarginStates.has(clean(order.state))).map(order=>{const resolved=resolveCurrentInventoryOrderCost({order,orderItems:itemsByOrder.get(clean(order.id))||[],products:productResult.results||[],variants:variantResult.results||[]});return {id:order.id,date:clean(order.date||order.created_at).slice(0,10),label:`أوردر ${clean(order.ref||order.id)}`,description:`${clean(order.name)||'بدون اسم'} · ${resolved.liveLines||0} سطر من التكلفة الحالية${resolved.fallbackLines?` · ${resolved.fallbackLines} fallback`:''}`,amount:round(resolved.cost)};});
}
async function dashboardInputDetails(request,env,ctx,url){
  const kind=clean(url.searchParams.get('kind')),clientId=clean(url.searchParams.get('clientId')),storeId=clean(url.searchParams.get('storeId'))||null,from=clean(url.searchParams.get('from')),to=clean(url.searchParams.get('to'));
  if(!clientId)return json({error:'محتاج clientId',code:'DASHBOARD_INPUT_CLIENT_REQUIRED'},400);
  const probe=await dashboardForInputs(request,env,ctx,{clientId,storeId,from,to});if(probe.response)return probe.response;
  const data=probe.data||{},resolvedFrom=clean(data.from||from),resolvedTo=clean(data.to||to),finance=data.finance||{},overview=data.overview||{};
  if(kind==='operatingExpenses'){
    const exp=await expenseInputs(request,env,ctx,{clientId,storeId,from:resolvedFrom,to:resolvedTo});if(exp.response)return exp.response;const x=exp.data||{},t=x.totals||{};
    return json({ok:true,kind,from:resolvedFrom,to:resolvedTo,total:round(finance.expenses),formula:'إعلانات + مصروفات عامة + شحن + مصروفات أوردر + إدارة',summary:[summary('إعلانات',t.ads,{money:true}),summary('مصروفات عامة',t.general,{money:true}),summary('الشحن',t.shipping,{money:true}),summary('التغليف ومصاريف الأوردر',t.orderOther,{money:true}),summary('مصاريف الإدارة',t.admin,{money:true})],rows:x.items||[]});
  }
  if(kind==='expectedRevenue'){
    const rows=await revenueRows(env,{clientId,storeId,from:resolvedFrom,to:resolvedTo}),details=overview.details?.expectedRevenue||[];
    return json({ok:true,kind,from:resolvedFrom,to:resolvedTo,total:round(overview.expectedRevenue??finance.revenue),formula:'إجمالي قيمة الطلبات − الملغي − المرتجع',summary:details.filter(x=>x?.value!==undefined).map(x=>({label:x.label,value:round(x.value),money:!!x.money,percent:!!x.percent,text:x.text||null})),rows});
  }
  if(kind==='productCost'){
    const rows=await productCostRows(env,{clientId,storeId,from:resolvedFrom,to:resolvedTo});
    return json({ok:true,kind,from:resolvedFrom,to:resolvedTo,total:round(finance.productCost),formula:'مجموع تكلفة المنتج/المتغير الحالية لكل أوردر محتسب',summary:[summary('تكلفة المنتج الحالية',finance.productCost,{money:true}),summary('عدد الأوردرات المحتسبة',rows.length)],rows});
  }
  if(kind==='netProfit')return json({ok:true,kind,from:resolvedFrom,to:resolvedTo,total:round(finance.netProfit),formula:'الإيراد المتوقع − تكلفة المنتج − المصروفات التشغيلية',summary:[summary('الإيراد المتوقع',finance.revenue??overview.expectedRevenue,{money:true}),summary('تكلفة المنتج',finance.productCost,{money:true}),summary('المصروفات التشغيلية',finance.expenses,{money:true}),summary('صافي الربح',finance.netProfit,{money:true})],rows:[]});
  if(kind==='profitMargin')return json({ok:true,kind,from:resolvedFrom,to:resolvedTo,total:round(overview.profitMargin),formula:'صافي الربح ÷ الإيراد المتوقع × 100',summary:[summary('صافي الربح',finance.netProfit,{money:true}),summary('الإيراد المتوقع',finance.revenue??overview.expectedRevenue,{money:true}),summary('هامش الربح',overview.profitMargin,{percent:true})],rows:[]});
  return json({error:'نوع تفاصيل المؤشر غير معروف',code:'DASHBOARD_INPUT_KIND_INVALID'},400);
}

async function fetchV38(request,env,ctx){
  const url=new URL(request.url),dashboardContract=request.method==='GET'&&url.pathname==='/api/dashboard',dashboardInputs=request.method==='GET'&&url.pathname==='/api/system/dashboard/input-details';
  try{
    if(dashboardInputs)return await dashboardInputDetails(request,env,ctx,url);
    const response=await safety.fetch(request,env,ctx);
    if(response.ok&&dashboardContract){
      const data=await response.clone().json().catch(()=>null),normalized=normalizeDashboardContract(data);
      if(normalized!==data)return json(normalized,response.status);
    }
    if(response.status!==500)return response;
    const data=await response.clone().json().catch(()=>null);
    if(isAuthFailure(data))return json({...data,code:'AUTH_REQUIRED'},401);
    return response;
  }catch(error){
    if(isAuthFailure(error))return json({error:error?.message||'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
    if(dashboardInputs)return json({error:error?.message||'تعذر تحميل تفاصيل المؤشر',code:error?.code||'DASHBOARD_INPUT_DETAILS_ERROR'},Number(error?.status)||500);
    throw error;
  }
}

void core;
export {SyncEntrypoint} from './index-commerce-v38-safety.js';
export default {fetch:fetchV38,scheduled(controller,env,ctx){return safety.scheduled?.(controller,env,ctx);}};
