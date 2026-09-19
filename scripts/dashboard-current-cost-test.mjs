import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentInventoryOrderCost} from '../src/dashboard-live-product-cost.js';

const products=[{id:'P1',cost:30},{id:'P2',cost:70}];
const variants=[{id:'V1',product_id:'P1',cost:55},{id:'V2',product_id:'P1',cost:null}];

assert.equal(currentInventoryOrderCost({order:{id:'O1',product_id:'P1',variant_id:'V1',qty:2,product_cost:999},products,variants}),110,'dashboard must prefer current variant cost over stale saved order product_cost');
assert.equal(currentInventoryOrderCost({order:{id:'O2',product_id:'P1',variant_id:'V2',qty:3,product_cost:999},products,variants}),90,'variant without its own cost must inherit current product cost');
assert.equal(currentInventoryOrderCost({order:{id:'O3',product_id:'P2',qty:2,product_cost:999},products,variants}),140,'dashboard must use current product cost when there is no variant');
assert.equal(currentInventoryOrderCost({order:{id:'O4',product_id:'UNKNOWN',qty:1,product_cost:88},products,variants}),88,'historical order cost is only a fallback for an order that cannot be linked to current inventory');
assert.equal(currentInventoryOrderCost({order:{id:'O5',product_cost:999},orderItems:[{product_id:'P1',variant_id:'V1',qty:2},{product_id:'P2',qty:1}],products,variants}),180,'multi-item order cost must sum current inventory cost for every line');
assert.equal(currentInventoryOrderCost({order:{id:'O6',product_cost:77},orderItems:[{product_id:'P1',qty:1},{product_id:'UNKNOWN',qty:1}],products,variants}),77,'partially unresolved multi-item orders must fall back to the saved whole-order cost instead of undercounting');

const [periodJs,periodCss,indexHtml,costSource]=await Promise.all([
  readFile(new URL('../public/v2/modules-v62-dashboard-periods.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v15.css',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../src/dashboard-live-product-cost.js',import.meta.url),'utf8')
]);
for(const marker of ['اليوم','أمس','الأسبوع الماضي','من بداية الشهر','الشهر الماضي','مدة معينة','data-dash-period','dash-period-toolbar','dash-period-modal','last_week','month_to_date','last_month','weekStartsOn'])assert.ok(periodJs.includes(marker),`dashboard period control missing ${marker}`);
for(const marker of ['.dash-period-select','.dash-period-toolbar','.dash-period-modal','.dash-rate-grid-single','@media(max-width:560px)'])assert.ok(periodCss.includes(marker),`dashboard period CSS missing ${marker}`);
for(const marker of ['kun-v15.css?v=15.0','modules-v62-dashboard-periods.js?v=62.0'])assert.ok(indexHtml.includes(marker),`dashboard period asset missing from index: ${marker}`);
for(const marker of ['snapshot.rates={...(snapshot.rates||{}),selected:selectedRateSummary(orders,from,to)}','rates:\'selected-dashboard-range\'','confirmationRate','deliveryRate','returnRate'])assert.ok(costSource.includes(marker),`selected-period rates backend missing ${marker}`);
assert.doesNotThrow(()=>new Function(periodJs),'dashboard period browser module must parse');

console.log('Dashboard regressions passed: current inventory cost is variant-first, and every dashboard section has the synchronized Today/Yesterday/Last week/Month-to-date/Last month/Custom period dropdown with selected-period shipping rates.');
