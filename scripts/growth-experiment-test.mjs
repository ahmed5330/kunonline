import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareGrowthPeriods} from '../src/growth-experiment.js';

const snapshot=({from,to,spend,orders,profit,roas=2,currency='EGP',reconciliation={}})=>({
  from,to,currency,
  ads:{spend,realRoas:roas,deliveredOrders:Math.round(orders*.75),spendReconciliation:reconciliation},
  overview:{totalOrders:orders},
  finance:{revenue:orders*250,netProfit:profit}
});
const before=snapshot({from:'2026-09-01',to:'2026-09-07',spend:7000,orders:70,profit:1400,roas:2});
const after=snapshot({from:'2026-09-08',to:'2026-09-14',spend:9000,orders:100,profit:2100,roas:2.2});
const result=compareGrowthPeriods({before,after,today:'2026-10-15'});
assert.equal(result.status,'positive_indication');
assert.equal(result.before.costPerEnteredOrder,100);
assert.equal(result.after.costPerEnteredOrder,90);
assert.equal(result.change.enteredCppPct,-10);
assert.equal(result.approvedToScale,false);
assert.equal(result.issues.length,0);
assert.match(result.caveat,/لا.*تعديل/);

const immature=compareGrowthPeriods({before,after,today:'2026-09-15'});
assert.equal(immature.status,'insufficient_evidence');
assert.ok(immature.issues.some(x=>x.includes('لم تنضج')));
const sparse=compareGrowthPeriods({before,after:{...after,overview:{totalOrders:10}},today:'2026-10-15'});
assert.equal(sparse.status,'insufficient_evidence');
const wrongCurrency=compareGrowthPeriods({before,after:{...after,currency:'SAR'},today:'2026-10-15'});
assert.equal(wrongCurrency.status,'insufficient_evidence');
const unknownSpend=compareGrowthPeriods({before,after:{...after,ads:{...after.ads,spendReconciliation:{needsReview:true}}},today:'2026-10-15'});
assert.equal(unknownSpend.status,'insufficient_evidence');
assert.throws(()=>compareGrowthPeriods({before,after:{...after,from:'2026-09-05'},today:'2026-10-15'}),/تداخل/);

const api=await readFile(new URL('../src/index-commerce-v27.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v150-growth-planner.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');
assert.match(api,/path==='\/api\/growth\/experiment\/compare'/);
assert.match(api,/dashboardData\(env,\{clientId,storeId,from:beforeFrom,to:beforeTo\}\)/);
assert.match(api,/daySpan\(beforeFrom,beforeTo\)>90/);
assert.match(ui,/id="gp150-experiment"/);
assert.match(ui,/\/api\/growth\/experiment\/compare/);
assert.ok(index.includes('/v2/modules-v150-growth-planner.js?v=150.0'));
assert.ok(index.indexOf('modules-v150-growth-planner.js')>index.indexOf('modules-v27-meta-ads.js'));
console.log('Growth experiment maturity, comparable dates, source protection and UI contract tests PASS');
