import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computeDashboardSnapshot} from '../src/dashboard-intelligence.js';

const day='2026-08-29';
const states=['confirmed','preparing','shipped','signed','collected','pending','cancelled','returned','pending','pending'];
const orders=states.map((state,i)=>({
  id:`O${i+1}`,date:day,created_at:`${day}T08:00:00Z`,state,total:100,product_id:'P1',qty:1,product_cost:30,
  shipping_cost:10,other_cost:5,gov:i<5?'القاهرة':i<8?'الجيزة':'الإسكندرية',source:i%2?'manual':'easyorders'
}));
const billingRows=orders.map(o=>({order_id:o.id,fee:2,status:'charged'}));
const transactions=[
  {date:day,category:'Meta Ads',amount:500},
  {date:day,category:'تغليف المكتب',amount:100}
];
const campaign={id:'C1',name:'Sales A',platform:'meta',spend:1000,impressions:10000,reach:7000,clicks:200,ctr:2,cpc:5,cpm:100,frequency:1.43,platformPurchases:20,platformPurchaseValue:4000,platformCpp:50,platformRoas:4,realOrders:10,confirmedOrders:5,deliveredOrders:2,cancelledOrders:1,returnedOrders:1,realOrderCost:100,confirmedOrderCost:200,deliveredOrderCost:500,newCustomers:10,cac:100,deliveredRevenue:200,realRoas:.2,cancellationRate:10,returnRate:33.33};
const marketing={total:{spend:1000,impressions:10000,reach:7000,clicks:200,platformPurchases:20,platformPurchaseValue:4000,confirmedOrders:5,deliveredOrders:2,customers:10,ctr:2,cpc:5,cpm:100,frequency:1.43,platformCpp:50,cac:100,platformRoas:4,realRoas:.2},campaigns:[campaign]};
const historyOrders=[
  {date:day,state:'confirmed',total:100},
  {date:day,state:'signed',total:100},
  {date:day,state:'returned',total:100},
  {date:day,state:'cancelled',total:100}
];
const matchingSnapshot={id:'AIS-1',insight_type:'business_brief',severity:'warning',title:'تحليل الفترة',rationale:'تفاصيل',generated_at:`${day}T09:00:00Z`,metric_json:JSON.stringify({engine:'gpt-test',period:{from:day,to:day},summary:'تحليل AI لليوم',metrics:{marketing:{...marketing.total,campaigns:[campaign]}},adAnalysis:{summary:'تم تحليل الحملة',winners:[],risks:[]}}),suggested_payload_json:JSON.stringify({period:{from:day,to:day},recommendations:[{type:'marketing',severity:'warning',title:'حملة تحتاج مراجعة',detail:'Real ROAS منخفض',action:'راجع الحملة'}]})};
const staleSnapshot={...matchingSnapshot,id:'AIS-OLD',title:'تحليل قديم',metric_json:JSON.stringify({engine:'gpt-test',period:{from:'2026-08-20',to:'2026-08-20'},summary:'قديم',metrics:{marketing:{}}}),suggested_payload_json:JSON.stringify({period:{from:'2026-08-20',to:'2026-08-20'},recommendations:[{type:'marketing',title:'قديم'}]})};
const result=computeDashboardSnapshot({orders,historyOrders,transactions,billingRows,products:[{id:'P1',cost:30}],dailyAds:[{metric_date:day,spend:1000}],marketing,aiSnapshots:[staleSnapshot,matchingSnapshot],from:day,to:day,today:day,currency:'EGP'});

assert.equal(result.overview.totalOrders,10,'all system orders must count regardless of source/status');
assert.equal(result.overview.actualOrderCost,100,'actual CPP must equal ad spend / every order entered');
assert.equal(result.overview.expectedRevenue,800,'expected revenue must exclude cancelled and returned orders');
assert.equal(result.overview.expectedProfit,249,'expected operating profit must use confirmed/preparing/shipped and subtract shipping, per-order other cost and admin fee, but not product cost');
assert.equal(result.finance.productCost,240,'product cost must apply only to revenue-eligible orders');
assert.equal(result.finance.grossProfit,560,'gross profit must be eligible revenue minus product cost only');
assert.equal(result.finance.expenseBreakdown.ads,1000,'connected ad spend must be primary spend source');
assert.equal(result.finance.expenseBreakdown.general,100,'manual ad transaction must not be double-counted as general expense');
assert.equal(result.finance.expenses,1270,'operating expenses must include ads, general, shipping, order other cost and admin fees');
assert.equal(result.finance.netProfit,-710,'P&L must subtract operating expenses from gross profit');
assert.equal(result.overview.profitMargin,-88.75,'profit margin must include product cost and all operating expenses');
assert.equal(result.rates.d7.confirmationRate,50,'7-day confirmation rate must use the actual recent order population');
assert.equal(result.rates.d7.deliveryRate,50,'delivery success must be delivered/(delivered+returned)');
assert.equal(result.rates.d7.returnRate,50,'return rate must be returned/(delivered+returned)');
assert.equal(result.provinces[0].name,'القاهرة','governorate ranking must prioritize delivered volume');
assert.equal(result.trend.granularity,'day','one-day range must use daily trend');
assert.ok(Object.hasOwn(result.trend.points[0],'netProfit'),'trend points must expose net profit');
assert.equal(result.aiAnalysis?.summary,'تحليل AI لليوم','AI analysis must be scoped to the selected dashboard period');
assert.equal(result.aiAnalysis?.marketing?.campaigns?.[0]?.name,'Sales A','period AI snapshot must carry the advertising campaign breakdown');
assert.ok(!result.recommendations.some(x=>x.title==='تحليل قديم'||x.title==='قديم'),'stale AI snapshots from a different period must not leak into current dashboard recommendations');
assert.ok(result.recommendations.length>0,'dashboard must always provide recommendations');

const [html,js,aiJs,baseCss,polishCss,referenceCss,context,worker,marketingPerformance,businessIntelligence,aiProvider]=await Promise.all([
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v33-dashboard.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v34-dashboard-ai.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v11.css',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v12.css',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v13.css',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/client-context-v23.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8'),
  readFile(new URL('../src/marketing-performance.js',import.meta.url),'utf8'),
  readFile(new URL('../src/business-intelligence.js',import.meta.url),'utf8'),
  readFile(new URL('../src/ai-provider.js',import.meta.url),'utf8')
]);
for(const marker of ['data-view="dashboard">الداشبورد','kun-v11.css','kun-v12.css','kun-v13.css','modules-v33-dashboard.js','modules-v34-dashboard-ai.js','family=Cairo'])assert.ok(html.includes(marker),`index missing ${marker}`);
for(const marker of ['/api/dashboard','آخر 7 أيام','آخر 30 يوم','خلال مدة معينة','data-dash-kpi','data-dash-reload','reloadSection','dash-updated','data-dash-trend','تكلفة الطلب الفعلية','نتائج الإعلانات بالتفصيل','أفضل المحافظات للشحن','أهم توصيات kun AI','أهم مؤشرات البيزنس وطريقة سريانه','تحليل جديد بالـAI','المرتجعات ÷ كل ما دخل مرحلة الشحن × 100'])assert.ok(js.includes(marker),`dashboard UI missing ${marker}`);
for(const marker of ['/api/ai/business-brief','تحليل الإعلانات بالـAI','Breakdown كامل للحملات','CPP فعلي','CPP مؤكد','CPP مسلم','Real ROAS','selectedRange','KunDashboardAI34'])assert.ok(aiJs.includes(marker),`period AI UI missing ${marker}`);
assert.doesNotThrow(()=>new Function(js),'dashboard v33 browser module must parse');
assert.doesNotThrow(()=>new Function(aiJs),'dashboard v34 AI browser module must parse');
for(const marker of ['.dash-kpis','.dash-drilldown','.dash-ad-grid','.dash-ai-grid','.dash-bars','@media(max-width:820px)','@media(max-width:390px)','body[data-theme="dark"]'])assert.ok(baseCss.includes(marker),`dashboard base CSS missing ${marker}`);
for(const marker of ['.dash-updated','.dash-trend-tabs','.dash-province-list','.dash-refreshing','prefers-reduced-motion'])assert.ok(polishCss.includes(marker),`dashboard polish CSS missing ${marker}`);
for(const marker of ['#0D47A1','#26B34A','#F5F7FA','#64748B','#0F172A','.dash-ai-analysis','.dash-ai-ad-kpis','.dash-ai-ad-table','font-family:Cairo'])assert.ok(referenceCss.includes(marker),`reference design CSS missing ${marker}`);
assert.ok(context.includes("'/api/dashboard'"),'client context must scope dashboard');
for(const marker of ["path==='/api/dashboard'","dashboardData","requirePermission(me,'analytics','read')"])assert.ok(worker.includes(marker),`worker dashboard route missing ${marker}`);
for(const marker of ['GROUP BY x.campaign_id','const attribution=new Map','attributionRows'])assert.ok(marketingPerformance.includes(marker),`marketing aggregation missing ${marker}`);
assert.ok(!marketingPerformance.includes('const a=await env.DB.prepare(`SELECT'),'campaign performance must not execute one D1 attribution query per campaign');
for(const marker of ['marketing:{...marketing.total,campaigns:activeCampaigns}','ruleAdAnalysis','period:{from,to}'])assert.ok(businessIntelligence.includes(marker),`business brief missing ${marker}`);
for(const marker of ['marketing.campaigns','Real ROAS','adAnalysis','max_output_tokens:2800'])assert.ok(aiProvider.includes(marker),`AI provider ad analysis missing ${marker}`);

console.log('Dashboard v34 checks passed: formulas + period-scoped AI + full ad breakdown + N+1 removal + independent section reload + Arabic KPIs + return-aware rates + province ranking + selectable trends + reference palette.');
