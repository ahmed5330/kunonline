import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {simulateScaling,dryRunScalingRule} from '../src/growth-scenario.js';
import {growthStockCatalog,resolveForecastStock} from '../src/growth-stock-catalog.js';
import {moduleForPath} from '../src/feature-entitlements.js';

const base={period:{from:'2026-10-01',to:'2026-10-30'},
  history:{days:30,spend:30000,realOrders:300,attributedOrders:280},
  plan:{horizonDays:7,proposedDailyBudget:1000,costPerEnteredOrder:100,expectedDeliveryRate:.7,
    contributionPerDeliveredOrderBeforeAds:250,returnLossPerFailedOrder:20,
    merchantCashAvailable:15000,daysToNextCollection:5,extraDailyCashOutflow:500,
    extraDailyOperatingCost:100,dailyConfirmationCapacity:40,dailyPackingCapacity:35,
    dailyShippingCapacity:25,currency:'EGP',currencyVerified:true,cashOutflowComplete:true,
    coversAllPromotedSkus:true,stockItems:[{sku:'A',availableUnits:120,orderShare:1,unitsPerOrder:2,supplierLeadDays:3,safetyDays:2}]}};

const good=simulateScaling(base);
assert.equal(good.forecast.dailyOrders,10);
assert.equal(good.forecast.totalOrders,70);
assert.equal(good.forecast.deliveredOrders,49);
assert.equal(good.forecast.failedOrders,21);
assert.equal(good.forecast.adSpend,7000);
assert.equal(good.forecast.estimatedContributionAfterAds,4130);
assert.equal(good.forecast.breakEvenCostPerEnteredOrder,159);
assert.equal(good.forecast.cashNeededBeforeCollection,7500);
assert.equal(good.stockItems[0].requiredUnits,100);
assert.equal(good.stockItems[0].coverageDays,6);
assert.equal(good.recommendation,'simulation_meets_inputs');
assert.equal(good.readiness.canScale,true);
assert.equal(good.approvalToIncreaseBudget,false,'even healthy simulation must not authorize Meta write');
const rule=dryRunScalingRule({scenario:good,proposedIncreasePct:10,maxDailyBudget:1200});
assert.equal(rule.meetsHypotheticalThresholds,true,'profitability assumptions can be satisfied');
assert.equal(rule.canSubmitForApproval,false,'no direct budget approval without independently verified cash, payout, stock and capacity');
assert.ok(rule.pendingVerification.includes('carrier_payout_schedule'));
assert.equal(rule.execution,false);
assert.equal(rule.providerWrite,false);
assert.equal(dryRunScalingRule({scenario:good,proposedIncreasePct:10,maxDailyBudget:1050}).canSubmitForApproval,false);
assert.throws(()=>dryRunScalingRule({scenario:good,proposedIncreasePct:80,maxDailyBudget:2000}),/نسبة الزيادة/);

const lowStock=simulateScaling({...base,plan:{...base.plan,stockItems:[{...base.plan.stockItems[0],availableUnits:20}]}});
assert.equal(lowStock.stockItems[0].shortageUnits,80);
assert.equal(lowStock.recommendation,'fix_blockers_first');
assert.equal(lowStock.readiness.canScale,false);

const zeroLead=simulateScaling({...base,plan:{...base.plan,stockItems:[{...base.plan.stockItems[0],availableUnits:0,supplierLeadDays:0,safetyDays:0}]}});
assert.equal(zeroLead.stockItems[0].requiredUnits,20,'even same-day supplier delivery cannot certify zero physical units');
assert.equal(zeroLead.readiness.checks.find(x=>x.id==='inventory').status,'blocked');
assert.throws(()=>simulateScaling({...base,plan:{...base.plan,stockItems:[{...base.plan.stockItems[0],orderShare:0}]}}),/غير صالحة/);
const lowCash=simulateScaling({...base,plan:{...base.plan,merchantCashAvailable:300}});
assert.equal(lowCash.forecast.cashDeficit,7200);
assert.equal(lowCash.recommendation,'fix_blockers_first');

const bottleneck=simulateScaling({...base,plan:{...base.plan,dailyShippingCapacity:5}});
assert.equal(bottleneck.forecast.unprocessedOrdersPerDay,5);
assert.equal(bottleneck.recommendation,'fix_blockers_first');

const moneyLoss=simulateScaling({...base,plan:{...base.plan,contributionPerDeliveredOrderBeforeAds:80}});
assert.ok(moneyLoss.forecast.estimatedContributionAfterAds<0);
assert.equal(moneyLoss.recommendation,'fix_blockers_first');

const unverified=simulateScaling({...base,plan:{...base.plan,currencyVerified:false,cashOutflowComplete:false,coversAllPromotedSkus:false}});
assert.equal(unverified.approvalToIncreaseBudget,false);
assert.equal(unverified.recommendation,'validate_assumptions');
assert.equal(dryRunScalingRule({scenario:unverified,proposedIncreasePct:10,maxDailyBudget:2000}).canSubmitForApproval,false);

for(const [field,value] of [['expectedDeliveryRate',1.1],['horizonDays',0],['costPerEnteredOrder',0],['merchantCashAvailable',-1]])
  assert.throws(()=>simulateScaling({...base,plan:{...base.plan,[field]:value}}),/غير صالحة/);

assert.equal(moduleForPath('/api/growth/scenario/preview'),'campaigns');
assert.equal(moduleForPath('/api/growth/operating-evidence'),'campaigns');
assert.equal(moduleForPath('/api/growth/inventory-catalog'),'campaigns');
const queries=[];
const db={prepare(sql){return {bind(...args){queries.push({sql,args});return this;},async all(){
  if(sql.includes('commerce_bundle_mappings'))return {results:[{external_id:'B1',product_id:'bundle',components_json:JSON.stringify([{productId:'P1',quantity:2}])}]};
  return {results:[{id:'P1',name:'قطعة',sku:'SKU-1',stock:25,low_stock_threshold:5,cost:70}]};
}};}};
const catalog=await growthStockCatalog({DB:db},{clientId:'C1',storeId:'S1'});
assert.equal(catalog.items[0].availableUnits,25);
assert.equal(catalog.bundles[0].components[0].quantity,2);
assert.equal(catalog.bundles[0].coverage,'visible');
assert.ok(queries.every(row=>row.args[0]==='C1'&&row.args[1]==='S1'),'every stock query must be scoped');
const selected=await resolveForecastStock({DB:db},{clientId:'C1',storeId:'S1',
  items:[{productId:'P1',availableUnits:9999,unitsPerOrder:2,orderShare:1,supplierLeadDays:3,safetyDays:1}]});
assert.equal(selected[0].availableUnits,25,'server must replace user-submitted stock numbers');
assert.equal(selected[0].sku,'SKU-1');

const missingDb={prepare(){return {bind(){return this;},async all(){return {results:[]};}}}};
await assert.rejects(()=>resolveForecastStock({DB:missingDb},{clientId:'C1',storeId:'S1',items:[{productId:'OTHER'}]}),
  e=>e.code==='GROWTH_STOCK_SCOPE');
await assert.rejects(()=>growthStockCatalog({DB:db},{clientId:'C1',storeId:null}),
  e=>e.code==='GROWTH_STORE_REQUIRED');

const routes=await readFile(new URL('../src/index-commerce-v27.js',import.meta.url),'utf8');
assert.match(routes,/path==='\/api\/growth\/scenario\/preview'/);
assert.match(routes,/requirePermission\(me,'ads','read'\);requirePermission\(me,'inventory','read'\);requirePermission\(me,'finance','read'\)/);
assert.match(routes,/resolveForecastStock\(env,\{clientId,storeId/);
assert.match(routes,/JSON\.stringify\(plan\)\.length>15000/);
assert.match(routes,/currencyVerified:verifiedCurrency/);
assert.match(routes,/reconciliation\.needsReview/);
assert.doesNotMatch(routes,/\/api\/growth\/scenario\/execute/);
const planner=await readFile(new URL('../public/v2/modules-v150-growth-planner.js',import.meta.url),'utf8');
assert.match(planner,/gp150-bundle-select/);
assert.match(planner,/bundle\.components/);
assert.match(planner,/check\.checked=false/);
assert.match(planner,/\/api\/growth\/scenario\/preview/);
assert.doesNotMatch(planner,/\/api\/integrations\/meta-ads\/budget-update/);

console.log('Growth simulation, inventory isolation, cash, economics and budget-rule dry-run tests PASS');
