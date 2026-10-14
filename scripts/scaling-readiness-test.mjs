import assert from 'node:assert/strict';
import {assessScalingReadiness} from '../src/scaling-readiness.js';
import {enrichBusinessBriefWithAI} from '../src/ai-provider.js';
import {readFile} from 'node:fs/promises';

const base = {period:{from:'2026-10-01',to:'2026-10-07'},
  orders:{total:100,pending:5},inventory:{lowStock:0,outOfStock:0},
  marketing:{spend:10000,attributedOrders:95}};

const incomplete=assessScalingReadiness(base);
assert.equal(incomplete.canScale,false,'missing forecasts must never become approval');
assert.equal(incomplete.decision,'insufficient_data');
assert.deepEqual(incomplete.checks.filter(x=>x.status==='unknown').map(x=>x.id),
  ['inventory','cash_flow','operations','profitability']);
assert.equal(incomplete.autoBudgetChanges,false);

const complete={...base,
  stockPlan:{coversAllPromotedSkus:true,items:[{sku:'A',availableUnits:500,projectedDailyOrders:50,unitsPerOrder:2,supplierLeadDays:3,safetyDays:1}]},
  cashPlan:{merchantCashAvailable:50000,projectedDailyTotalOutflow:10000,daysToNextCollection:3,outflowIncludesAdsStockAndOperations:true},
  operationsPlan:{projectedDailyOrders:50,dailyConfirmationCapacity:80,dailyPackingCapacity:75,dailyShippingCapacity:70},
  unitEconomics:{contributionPerDeliveredOrderBeforeAds:200,expectedDeliveryRate:0.75,returnLossPerFailedOrder:20,projectedCostPerEnteredOrder:90}};

const approved=assessScalingReadiness(complete);
assert.equal(approved.decision,'ready');
assert.equal(approved.canScale,true);
assert.equal(approved.checks.find(x=>x.id==='profitability').evidence.breakevenCpp,145);
assert.equal(approved.checks.find(x=>x.id==='inventory').evidence.items[0].requiredUnits,400);

const orderDiscrepancy=assessScalingReadiness({...complete,marketing:{...complete.marketing,realOrders:90}});
assert.equal(orderDiscrepancy.checks.find(item=>item.id==='data').status,'blocked');
assert.equal(orderDiscrepancy.canScale,false,'do not scale when business and marketing order populations differ');
const stockShort=assessScalingReadiness({...complete,stockPlan:{coversAllPromotedSkus:true,items:[{sku:'A',availableUnits:200,projectedDailyOrders:50,unitsPerOrder:2,supplierLeadDays:3,safetyDays:1}]}});
assert.equal(stockShort.decision,'blocked');
assert.equal(stockShort.checks.find(x=>x.id==='inventory').evidence.items[0].gapUnits,200);

const noStockSameDay=assessScalingReadiness({...complete,stockPlan:{coversAllPromotedSkus:true,items:[
  {sku:'A',availableUnits:0,projectedDailyOrders:50,unitsPerOrder:2,supplierLeadDays:0,safetyDays:0}
]}});
assert.equal(noStockSameDay.checks.find(x=>x.id==='inventory').status,'blocked');
const cashShort=assessScalingReadiness({...complete,cashPlan:{...complete.cashPlan,merchantCashAvailable:2000}});
assert.equal(cashShort.checks.find(x=>x.id==='cash_flow').status,'blocked');

const opsShort=assessScalingReadiness({...complete,operationsPlan:{...complete.operationsPlan,dailyPackingCapacity:30}});
assert.equal(opsShort.checks.find(x=>x.id==='operations').status,'blocked');

const shippingShort=assessScalingReadiness({...complete,operationsPlan:{...complete.operationsPlan,dailyShippingCapacity:5}});
assert.equal(shippingShort.checks.find(x=>x.id==='operations').status,'blocked','shipping throughput must block expansion even when packing is high');
assert.equal(shippingShort.canScale,false);
const shippingUnknown=assessScalingReadiness({...complete,operationsPlan:{projectedDailyOrders:50,dailyConfirmationCapacity:80,dailyPackingCapacity:70}});
assert.equal(shippingUnknown.checks.find(x=>x.id==='operations').status,'unknown','shipping capacity cannot be silently assumed');
const losing=assessScalingReadiness({...complete,unitEconomics:{...complete.unitEconomics,projectedCostPerEnteredOrder:170}});
assert.equal(losing.checks.find(x=>x.id==='profitability').status,'blocked');

const tracking=assessScalingReadiness({...complete,marketing:{...base.marketing,attributedOrders:40}});
assert.equal(tracking.checks.find(x=>x.id==='data').status,'warning');
assert.equal(tracking.canScale,false);

const noWalletGuess=assessScalingReadiness({...base,wallet:{balance:999999}});
assert.equal(noWalletGuess.checks.find(x=>x.id==='cash_flow').status,'unknown');
assert.equal(noWalletGuess.canScale,false);

const missingBundles=assessScalingReadiness({...complete,stockPlan:{coversAllPromotedSkus:false,items:complete.stockPlan.items}});
assert.equal(missingBundles.canScale,false,'partial stock coverage cannot certify scaling');
// AI cannot bypass deterministic merchant-cash/stock/operations/profit guards.
const savedFetch=globalThis.fetch;
try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({output_text:JSON.stringify({summary:'توصيات',recommendations:[{type:'marketing',severity:'success',title:'زود الميزانية',action:'ارفع الميزانية 20%'}]})})});
  const ai=await enrichBusinessBriefWithAI({OPENAI_API_KEY:'mock-key',OPENAI_TEXT_MODEL:'mock-model'},
    {...base,from:'2026-10-01',to:'2026-10-07',metrics:{},adAnalysis:{},recommendations:[],scalingReadiness:incomplete});
  assert.equal(ai.ai.used,true);
  assert.equal(ai.recommendations[0].severity,'warning');
  assert.match(ai.recommendations[0].action,/استكمل بيانات/);
}finally{globalThis.fetch=savedFetch;}

// Catch accidental removal of store scope, endpoint and active Campaigns view.
const route=await readFile(new URL('../src/index-commerce-v27.js',import.meta.url),'utf8');
const campaign=await readFile(new URL('../public/v2/modules-v27-meta-ads.js',import.meta.url),'utf8');
const brief=await readFile(new URL('../src/business-intelligence.js',import.meta.url),'utf8');
assert.match(route,/path==='\/api\/growth\/scaling-readiness'/);
assert.match(route,/requirePermission\(me,'ads','read'\)/);
assert.match(route,/const range=dateRange\(url\),base=await businessBrief\(env,\{clientId,storeId/);
assert.match(brief,/scalingReadiness=assessScalingReadiness/);
assert.match(campaign,/metaScalingReadiness/);
assert.match(campaign,/\.dataset\.days===String\(days\)/);
console.log('Scaling readiness safety and business scenario checks passed.');
