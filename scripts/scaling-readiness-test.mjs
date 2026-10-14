import assert from 'node:assert/strict';
import {assessScalingReadiness} from '../src/scaling-readiness.js';

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
  operationsPlan:{projectedDailyOrders:50,dailyConfirmationCapacity:80,dailyPackingCapacity:75},
  unitEconomics:{contributionPerDeliveredOrderBeforeAds:200,expectedDeliveryRate:0.75,returnLossPerFailedOrder:20,projectedCostPerEnteredOrder:90}};

const approved=assessScalingReadiness(complete);
assert.equal(approved.decision,'ready');
assert.equal(approved.canScale,true);
assert.equal(approved.checks.find(x=>x.id==='profitability').evidence.breakevenCpp,145);
assert.equal(approved.checks.find(x=>x.id==='inventory').evidence.items[0].requiredUnits,400);

const stockShort=assessScalingReadiness({...complete,stockPlan:{coversAllPromotedSkus:true,items:[{sku:'A',availableUnits:200,projectedDailyOrders:50,unitsPerOrder:2,supplierLeadDays:3,safetyDays:1}]}});
assert.equal(stockShort.decision,'blocked');
assert.equal(stockShort.checks.find(x=>x.id==='inventory').evidence.items[0].gapUnits,200);

const cashShort=assessScalingReadiness({...complete,cashPlan:{...complete.cashPlan,merchantCashAvailable:2000}});
assert.equal(cashShort.checks.find(x=>x.id==='cash_flow').status,'blocked');

const opsShort=assessScalingReadiness({...complete,operationsPlan:{...complete.operationsPlan,dailyPackingCapacity:30}});
assert.equal(opsShort.checks.find(x=>x.id==='operations').status,'blocked');

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
console.log('Scaling readiness safety and business scenario checks passed.');
