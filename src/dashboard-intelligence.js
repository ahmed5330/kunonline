import {campaignPerformance} from './marketing-performance.js';

const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const pct=(a,b)=>b?r2(n(a)/n(b)*100):0;
const text=v=>String(v??'').trim();
const activeExpectedStates=new Set(['confirmed','preparing','shipped']);
const confirmedStates=new Set(['confirmed','preparing','shipped','signed','collected']);
const deliveredStates=new Set(['signed','collected']);
const excludedRevenueStates=new Set(['cancelled','returned']);
const isoDate=/^\d{4}-\d{2}-\d{2}$/;

function cairoToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function parseDate(value,fallback){const v=text(value);return isoDate.test(v)?v:fallback;}
function daysBetween(from,to){const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);return Math.max(1,Math.floor((b-a)/86400000)+1);}
function addDays(date,delta){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);}
function bucketFor(date,granularity){
  if(granularity==='month')return String(date).slice(0,7);
  if(granularity==='week'){
    const d=new Date(`${date}T00:00:00Z`),day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);
  }
  return String(date).slice(0,10);
}
function isAdCategory(value){return /(ads?|advert|facebook|meta|google|tiktok|اعلان|إعلان|اعلانات|إعلانات)/i.test(text(value));}
function productCostFor(order,productCosts){
  const saved=n(order.product_cost);
  if(saved>0)return saved;
  return r2(n(productCosts.get(String(order.product_id||'')))*Math.max(1,n(order.qty)||1));
}
function billingFeeFor(order,billing){const row=billing.get(String(order.id));return row&&!['waived','failed'].includes(row.status)?n(row.fee):0;}
function sum(rows,fn){return r2((rows||[]).reduce((a,x)=>a+n(fn(x)),0));}
function groupBreakdown(rows,keyFn,valueFn=()=>1){
  const m=new Map();for(const row of rows||[]){const key=text(keyFn(row))||'غير محدد';m.set(key,r2(n(m.get(key))+n(valueFn(row))));}
  return [...m.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
}
function safeJson(value,fallback={}){try{return JSON.parse(value||'')}catch{return fallback}}

function rateWindow(rows,today,days){
  const from=addDays(today,-(days-1)),set=(rows||[]).filter(o=>String(o.date||o.created_at||'').slice(0,10)>=from&&String(o.date||o.created_at||'').slice(0,10)<=today),total=set.length;
  const confirmed=set.filter(o=>confirmedStates.has(o.state)).length,delivered=set.filter(o=>deliveredStates.has(o.state)).length,returned=set.filter(o=>o.state==='returned').length,shippingOutcomes=delivered+returned,shippedPopulation=set.filter(o=>['shipped','signed','collected','returned'].includes(o.state)).length;
  return {days,from,to:today,total,confirmed,confirmationRate:pct(confirmed,total),delivered,returned,deliveryRate:pct(delivered,shippingOutcomes),returnRate:pct(returned,shippingOutcomes),returnOfShippedRate:pct(returned,shippedPopulation)};
}

function governorates(rows){
  const map=new Map();
  for(const o of rows||[]){const gov=text(o.gov)||'غير محدد';const x=map.get(gov)||{name:gov,orders:0,shipped:0,delivered:0,returned:0,revenue:0};x.orders++;if(['shipped','signed','collected','returned'].includes(o.state))x.shipped++;if(deliveredStates.has(o.state))x.delivered++;if(o.state==='returned')x.returned++;if(!excludedRevenueStates.has(o.state))x.revenue+=n(o.total);map.set(gov,x);}
  return [...map.values()].map(x=>({...x,revenue:r2(x.revenue),deliveryRate:pct(x.delivered,x.delivered+x.returned),returnRate:pct(x.returned,x.delivered+x.returned)})).sort((a,b)=>b.delivered-a.delivered||b.orders-a.orders||b.deliveryRate-a.deliveryRate).slice(0,12);
}

function buildTrend({orders,transactions,dailyAds,billing,productCosts,from,to}){
  const span=daysBetween(from,to),granularity=span<=31?'day':span<=180?'week':'month',map=new Map(),hasIntegratedDailyAds=sum(dailyAds,a=>a.spend)>0;
  const get=(date)=>{const key=bucketFor(date,granularity);if(!map.has(key))map.set(key,{key,orders:0,revenue:0,productCost:0,adSpend:0,otherExpenses:0,shipping:0,orderOther:0,adminFees:0,confirmed:0,delivered:0,returned:0});return map.get(key)};
  for(const o of orders||[]){const date=String(o.date||o.created_at||from).slice(0,10),x=get(date);x.orders++;if(!excludedRevenueStates.has(o.state)){x.revenue+=n(o.total);x.productCost+=productCostFor(o,productCosts);}x.shipping+=n(o.shipping_cost);x.orderOther+=n(o.other_cost);x.adminFees+=billingFeeFor(o,billing);if(confirmedStates.has(o.state))x.confirmed++;if(deliveredStates.has(o.state))x.delivered++;if(o.state==='returned')x.returned++;}
  for(const t of transactions||[]){const x=get(String(t.date||t.created_at||from).slice(0,10));if(isAdCategory(t.category)){if(!hasIntegratedDailyAds)x.adSpend+=n(t.amount);continue;}x.otherExpenses+=n(t.amount);}
  for(const a of dailyAds||[]){const x=get(String(a.metric_date||from).slice(0,10));x.adSpend+=n(a.spend);}
  return {granularity,points:[...map.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(x=>{const operating=n(x.adSpend)+n(x.otherExpenses)+n(x.shipping)+n(x.orderOther)+n(x.adminFees),gross=n(x.revenue)-n(x.productCost),net=gross-operating;return {...x,revenue:r2(x.revenue),productCost:r2(x.productCost),adSpend:r2(x.adSpend),otherExpenses:r2(x.otherExpenses),shipping:r2(x.shipping),orderOther:r2(x.orderOther),adminFees:r2(x.adminFees),grossProfit:r2(gross),netProfit:r2(net),confirmationRate:pct(x.confirmed,x.orders),deliveryRate:pct(x.delivered,x.delivered+x.returned)};})};
}

function derivedRecommendations({overview,ads,rates,provinces}){
  const out=[];const add=(category,severity,title,detail,action)=>out.push({category,severity,title,detail,action});
  if(ads.spend>0&&ads.realRoas<1)add('ads','danger','العائد الحقيقي على الإعلانات أقل من 1x',`كل 1 جنيه إعلان رجّع ${r2(ads.realRoas)} جنيه إيراد مُسلَّم فقط.`,'أوقف أو خفّض الحملات الأضعف وراجع العرض والصفحة.');
  else if(ads.spend>0&&ads.realRoas>=2)add('ads','success','الحملات تحقق عائدًا جيدًا',`Real ROAS الحالي ${r2(ads.realRoas)}x.`,'زِد الميزانية تدريجيًا للحملات الرابحة بدل القفز المفاجئ.');
  if(ads.impressions>1000&&ads.ctr<1)add('angles','warning','الزاوية الإعلانية تحتاج اختبارًا جديدًا',`CTR الحالي ${r2(ads.ctr)}% وهو منخفض نسبيًا.`,'اختبر زوايا: المشكلة/الحل، قبل وبعد، إثبات اجتماعي، وديمو المنتج.');
  if(ads.ctr>=1.5&&ads.clicks>50&&ads.platformPurchases/Math.max(1,ads.clicks)<0.01)add('marketing','warning','الإعلان يجذب النقر لكن التحويل ضعيف',`CTR جيد (${r2(ads.ctr)}%) لكن المشتريات بعد النقر منخفضة.`,'راجع السعر، العرض، سرعة الصفحة، الثقة، وسياسة الشحن.');
  if(rates.d7.confirmationRate<60&&rates.d7.total>=5)add('business','warning','نسبة التأكيد تحتاج تحسين',`متوسط التأكيد آخر 7 أيام ${rates.d7.confirmationRate}%.`,'راجع سرعة التواصل وجودة الـLeads وسيناريو التأكيد.');
  if(rates.d7.returnRate>20&&rates.d7.delivered+rates.d7.returned>=5)add('shipping','danger','المرتجعات بعد الشحن مرتفعة',`نسبة المرتجع من نتائج الشحن آخر 7 أيام ${rates.d7.returnRate}%.`,'قارن المحافظات وشركات الشحن والأسباب المتكررة قبل التوسع.');
  if(provinces[0])add('growth','info','استفد من أفضل محافظة',`${provinces[0].name} لديها ${provinces[0].orders} طلب ونسبة تسليم ${provinces[0].deliveryRate}%.`,'اختبر تخصيص ميزانية أو عرض محلي للمحافظات الأعلى جودة.');
  if(overview.actualOrderCost>0&&overview.expectedProfitPerActiveOrder>0&&overview.actualOrderCost>overview.expectedProfitPerActiveOrder)add('business','danger','تكلفة الحصول على الطلب أعلى من ربحه التشغيلي',`تكلفة الطلب الفعلية ${overview.actualOrderCost} مقابل ربح تشغيلي متوقع ${overview.expectedProfitPerActiveOrder} لكل طلب نشط.`,'قلّل CPP أو ارفع متوسط الطلب/الهامش قبل زيادة الإنفاق.');
  if(!out.length)add('business','success','المؤشرات الأساسية مستقرة','لا توجد إشارة حرجة واضحة في الفترة المحددة.','استمر في القياس واختبر تحسينًا واحدًا في كل مرة.');
  return out;
}

function matchingAiSnapshots(rows,from,to){
  const out=[];
  for(const row of rows||[]){
    const metric=safeJson(row.metric_json,{}),payload=safeJson(row.suggested_payload_json,{}),period=metric.period||payload.period||{};
    if(period.from!==from||period.to!==to)continue;
    out.push({row,metric,payload,period});
  }
  return out;
}

export function computeDashboardSnapshot({orders=[],historyOrders=[],transactions=[],billingRows=[],products=[],dailyAds=[],marketing={total:{},campaigns:[]},aiSnapshots=[],from,to,today=cairoToday(),currency='EGP'}){
  const productCosts=new Map(products.map(p=>[String(p.id),n(p.cost)])),billing=new Map(billingRows.map(x=>[String(x.order_id),x]));
  const eligible=orders.filter(o=>!excludedRevenueStates.has(o.state)),activeExpected=orders.filter(o=>activeExpectedStates.has(o.state));
  const totalOrders=orders.length,enteredRevenue=sum(orders,o=>o.total),cancelled=orders.filter(o=>o.state==='cancelled'),returned=orders.filter(o=>o.state==='returned'),expectedRevenue=sum(eligible,o=>o.total),cancelledRevenue=sum(cancelled,o=>o.total),returnedRevenue=sum(returned,o=>o.total);
  const campaignSpend=r2(marketing?.total?.spend),manualAdTransactions=transactions.filter(t=>isAdCategory(t.category)),manualAdSpend=sum(manualAdTransactions,t=>t.amount),adSpend=campaignSpend>0?campaignSpend:manualAdSpend,adSpendSource=campaignSpend>0?'integrations':'manual';
  const otherTransactions=transactions.filter(t=>!isAdCategory(t.category)),otherExpenses=sum(otherTransactions,t=>t.amount);
  const actualOrderCost=totalOrders?r2(adSpend/totalOrders):0;
  const activeRevenue=sum(activeExpected,o=>o.total),activeShipping=sum(activeExpected,o=>o.shipping_cost),activeOther=sum(activeExpected,o=>o.other_cost),activeAdmin=sum(activeExpected,o=>billingFeeFor(o,billing)),expectedProfit=r2(activeRevenue-activeShipping-activeOther-activeAdmin),expectedProfitPerActiveOrder=activeExpected.length?r2(expectedProfit/activeExpected.length):0;
  const eligibleProductCost=sum(eligible,o=>productCostFor(o,productCosts)),allShipping=sum(orders,o=>o.shipping_cost),allOrderOther=sum(orders,o=>o.other_cost),allAdmin=sum(orders,o=>billingFeeFor(o,billing)),operatingExpenses=r2(adSpend+otherExpenses+allShipping+allOrderOther+allAdmin),grossProfit=r2(expectedRevenue-eligibleProductCost),netProfit=r2(grossProfit-operatingExpenses),profitMargin=pct(netProfit,expectedRevenue);
  const bySource=groupBreakdown(orders,o=>o.source||'غير محدد'),byState=groupBreakdown(orders,o=>o.state||'غير محدد'),expenseCategories=groupBreakdown(otherTransactions,t=>t.category||'غير مصنف',t=>t.amount);
  const m=marketing?.total||{},platformPurchases=n(m.platformPurchases),clicks=n(m.clicks),ads={spend:adSpend,spendSource:adSpendSource,impressions:n(m.impressions),reach:n(m.reach),clicks,leads:n(m.leads),platformPurchases,platformPurchaseValue:r2(m.platformPurchaseValue),realOrders:totalOrders,confirmedOrders:n(m.confirmedOrders),deliveredOrders:n(m.deliveredOrders),ctr:r2(m.ctr),cpc:r2(m.cpc),cpm:r2(m.cpm),frequency:r2(m.frequency),platformCpp:r2(m.platformCpp),systemCpp:actualOrderCost,confirmedCpp:n(m.confirmedOrders)?r2(adSpend/n(m.confirmedOrders)):0,deliveredCpp:n(m.deliveredOrders)?r2(adSpend/n(m.deliveredOrders)):0,cac:r2(m.cac),platformRoas:r2(m.platformRoas),realRoas:r2(m.realRoas),cpa:platformPurchases?r2(adSpend/platformPurchases):n(m.confirmedOrders)?r2(adSpend/n(m.confirmedOrders)):0,conversionRate:pct(platformPurchases,clicks),rpc:clicks?r2(n(m.platformPurchaseValue)/clicks):0,aov:platformPurchases?r2(n(m.platformPurchaseValue)/platformPurchases):0,campaigns:(marketing.campaigns||[]).slice(0,50)};
  const rates={d7:rateWindow(historyOrders,today,7),d30:rateWindow(historyOrders,today,30)};
  const provinces=governorates(orders),overview={totalOrders,actualOrderCost,enteredRevenue,expectedRevenue,expectedProfit,expectedProfitPerActiveOrder,profitMargin,netProfit,adSpend,otherExpenses,activeOrders:activeExpected.length,cancelled:cancelled.length,returned:returned.length};
  const matches=matchingAiSnapshots(aiSnapshots,from,to),latestAi=[];
  let aiAnalysis=null;
  for(const entry of matches){
    const {row,metric,payload,period}=entry,embedded=Array.isArray(payload.recommendations)?payload.recommendations:[];
    if(!aiAnalysis&&row.insight_type==='business_brief')aiAnalysis={id:row.id,period,summary:metric.summary||payload.summary||row.title||'',engine:metric.engine||payload.engine||'ai',aiUsed:(metric.engine||payload.engine||'').startsWith('gpt')||(metric.engine||payload.engine||'').includes('ai'),marketing:metric.metrics?.marketing||null,adAnalysis:metric.adAnalysis||payload.adAnalysis||null,generatedAt:row.generated_at};
    latestAi.push({id:row.id,category:row.insight_type||'ai',severity:row.severity||'info',title:row.title,rationale:row.rationale||'',generatedAt:row.generated_at});
    for(const rec of embedded.slice(0,5))latestAi.push({id:`${row.id}:${latestAi.length}`,category:rec.type||'ai',severity:rec.severity||'info',title:rec.title||row.title,rationale:rec.detail||'',action:rec.action||null,generatedAt:row.generated_at});
  }
  const recommendations=[...latestAi.slice(0,8),...derivedRecommendations({overview,ads,rates,provinces})].slice(0,12);
  const trend=buildTrend({orders,transactions,dailyAds,billing,productCosts,from,to});
  return {
    ok:true,from,to,today,currency,
    overview:{...overview,details:{
      orders:[{label:'إجمالي الطلبات الداخلة',value:totalOrders},{label:'مصادر الطلبات',items:bySource},{label:'حالات الطلبات',items:byState}],
      actualOrderCost:[{label:'صرف الإعلانات',value:adSpend,money:true},{label:'كل الطلبات الداخلة للنظام',value:totalOrders},{label:'المعادلة',text:'صرف الإعلانات ÷ كل الطلبات من المتجر أو الإدخال اليدوي أو أي مصدر'}],
      expectedRevenue:[{label:'إجمالي قيمة الطلبات الداخلة',value:enteredRevenue,money:true},{label:'قيمة الطلبات الملغاة',value:cancelledRevenue,money:true},{label:'قيمة الطلبات المرتجعة',value:returnedRevenue,money:true},{label:'الإيراد المتوقع',value:expectedRevenue,money:true}],
      expectedProfit:[{label:'طلبات مؤكدة/تجهيز/جاري الشحن',value:activeExpected.length},{label:'إيرادها',value:activeRevenue,money:true},{label:'الشحن',value:activeShipping,money:true},{label:'التغليف/مصاريف الطلب الأخرى',value:activeOther,money:true},{label:'مصاريف الإدارة',value:activeAdmin,money:true},{label:'الربح التشغيلي المتوقع',value:expectedProfit,money:true}],
      margin:[{label:'الإيراد المتوقع',value:expectedRevenue,money:true},{label:'تكلفة المنتج',value:eligibleProductCost,money:true},{label:'كل المصروفات التشغيلية',value:operatingExpenses,money:true},{label:'صافي الربح',value:netProfit,money:true},{label:'هامش الربح',value:profitMargin,percent:true}],
      adSpend:[{label:'صرف الإعلانات',value:adSpend,money:true},{label:'مصدر الرقم',text:adSpendSource==='integrations'?'بيانات منصات الإعلانات المتصلة':'المصاريف الإعلانية المسجلة يدويًا'},{label:'الحملات',items:ads.campaigns.slice(0,12).map(c=>({label:c.name||c.platform,value:r2(c.spend)}))}],
      otherExpenses:[{label:'إجمالي المصاريف الأخرى',value:otherExpenses,money:true},{label:'حسب التصنيف',items:expenseCategories}]
    }},
    finance:{expenses:operatingExpenses,expenseBreakdown:{ads:adSpend,general:otherExpenses,shipping:allShipping,orderOther:allOrderOther,admin:allAdmin},grossProfit,productCost:eligibleProductCost,revenue:expectedRevenue,netProfit},
    ads,rates,provinces,recommendations,aiAnalysis,trend
  };
}

export async function dashboardData(env,{clientId,storeId=null,from=null,to=null}){
  const today=cairoToday(),resolvedTo=parseDate(to,today),resolvedFrom=parseDate(from,resolvedTo);if(resolvedFrom>resolvedTo)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'DATE_RANGE_INVALID'});
  const storeClause=storeId?' AND store_id=?':'',rangeBinds=storeId?[clientId,storeId,resolvedFrom,resolvedTo]:[clientId,resolvedFrom,resolvedTo],scopeBinds=storeId?[clientId,storeId]:[clientId];
  const [orderResult,historyResult,transactionResult,billingResult,productResult,adsResult,aiResult,storeRow]=await Promise.all([
    env.DB.prepare(`SELECT id,client_id,store_id,date,created_at,state,total,product_cost,shipping_cost,other_cost,gov,source,customer_id,product_id,qty FROM orders WHERE client_id=? ${storeClause} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(date,created_at),created_at`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT id,date,created_at,state,total FROM orders WHERE client_id=? ${storeClause} AND date(COALESCE(date,created_at))>=date(?,'-29 day') AND date(COALESCE(date,created_at))<=date(?)`).bind(...(storeId?[clientId,storeId,today,today]:[clientId,today,today])).all(),
    env.DB.prepare(`SELECT id,date,created_at,category,amount,note FROM transactions WHERE client_id=? ${storeClause} AND type='expense' AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(date,created_at)`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT b.order_id,b.fee,b.status FROM order_billing b JOIN orders o ON o.id=b.order_id AND o.client_id=b.client_id WHERE b.client_id=? ${storeId?'AND o.store_id=?':''} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT id,cost FROM products WHERE client_id=? ${storeClause}`).bind(...scopeBinds).all(),
    env.DB.prepare(`SELECT metric_date,COALESCE(SUM(spend),0) spend FROM campaign_daily_metrics WHERE client_id=? ${storeClause} AND date(metric_date) BETWEEN date(?) AND date(?) GROUP BY metric_date ORDER BY metric_date`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT id,insight_type,severity,title,rationale,metric_json,suggested_payload_json,generated_at FROM ai_insight_snapshots WHERE client_id=? ${storeId?'AND (store_id=? OR store_id IS NULL)':''} AND status='active' ORDER BY generated_at DESC LIMIT 30`).bind(...scopeBinds).all(),
    storeId?env.DB.prepare('SELECT currency FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first():Promise.resolve({currency:'EGP'})
  ]);
  const marketing=await campaignPerformance(env,{clientId,storeId,from:resolvedFrom,to:resolvedTo});
  return computeDashboardSnapshot({orders:orderResult.results||[],historyOrders:historyResult.results||[],transactions:transactionResult.results||[],billingRows:billingResult.results||[],products:productResult.results||[],dailyAds:adsResult.results||[],marketing,aiSnapshots:aiResult.results||[],from:resolvedFrom,to:resolvedTo,today,currency:storeRow?.currency||'EGP'});
}
