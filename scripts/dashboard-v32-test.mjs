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
const marketing={total:{spend:1000,impressions:10000,reach:7000,clicks:200,platformPurchases:20,platformPurchaseValue:4000,confirmedOrders:5,deliveredOrders:2,customers:10,ctr:2,cpc:5,cpm:100,frequency:1.43,platformCpp:50,cac:100,platformRoas:4,realRoas:.2},campaigns:[{name:'Sales A',platform:'meta',spend:1000,realOrderCost:100,realRoas:.2}]};
const historyOrders=[
  {date:day,state:'confirmed',total:100},
  {date:day,state:'signed',total:100},
  {date:day,state:'returned',total:100},
  {date:day,state:'cancelled',total:100}
];
const result=computeDashboardSnapshot({orders,historyOrders,transactions,billingRows,products:[{id:'P1',cost:30}],dailyAds:[{metric_date:day,spend:1000}],marketing,from:day,to:day,today:day,currency:'EGP'});

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
assert.ok(result.recommendations.length>0,'dashboard must always provide recommendations');

const [html,js,css,context,worker]=await Promise.all([
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v32-dashboard.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v11.css',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/client-context-v23.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8')
]);
for(const marker of ['data-view="dashboard">الداشبورد','kun-v11.css','modules-v32-dashboard.js'])assert.ok(html.includes(marker),`index missing ${marker}`);
for(const marker of ['/api/dashboard','آخر 7 أيام','آخر 30 يوم','مدة معينة','data-dash-kpi','data-dash-reload','تكلفة الطلب الفعلية','نتائج الإعلانات','أفضل المحافظات للشحن','أهم توصيات kun AI','أهم مؤشرات البيزنس عبر الزمن','تحليل جديد بالـAI'])assert.ok(js.includes(marker),`dashboard UI missing ${marker}`);
for(const marker of ['.dash-kpis','.dash-drilldown','.dash-ad-grid','.dash-ai-grid','.dash-bars','@media(max-width:820px)','@media(max-width:390px)','body[data-theme="dark"]'])assert.ok(css.includes(marker),`dashboard CSS missing ${marker}`);
assert.ok(context.includes("'/api/dashboard'"),'client context must scope dashboard');
for(const marker of ["path==='/api/dashboard'","dashboardData","requirePermission(me,'analytics','read')"])assert.ok(worker.includes(marker),`worker dashboard route missing ${marker}`);

console.log('Dashboard v32 checks passed: real all-order CPP, expected revenue/profit, full-margin P&L, returns-aware rates, governorates, AI/trends, scoped API and responsive drill-down UI.');
