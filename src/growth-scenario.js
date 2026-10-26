// Scenario simulator for Kun Online Growth. Side-effect-free; no external ad writes.
// The scenario is hypothetical and never certifies actual merchant liquidity, fulfilment or profit.
import {assessScalingReadiness} from './scaling-readiness.js';

const good=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const num=x=>Number(x);
const round=x=>Math.round(x*100)/100;
const fail=(field,message)=>{throw Object.assign(new Error(message),{status:400,code:'GROWTH_SCENARIO_INVALID',field});};
const required=(obj,key,{min=0,max=1e10,integer=false}={})=>{
  if(!good(obj?.[key]))fail(key,'بيانات السيناريو ناقصة أو غير رقمية: '+key);
  const v=num(obj[key]);if(v<min||v>max||(integer&&!Number.isInteger(v)))fail(key,'قيمة غير صالحة: '+key);
  return v;
};
const optional=(obj,key,opt={})=>obj?.[key]===null||obj?.[key]===undefined||obj?.[key]===''?null:required(obj,key,opt);
const bounded=(v,min,max)=>Math.max(min,Math.min(max,v));
const shareOf=x=>x?.orderShare===undefined?1:required(x,'orderShare',{min:0.0001,max:1});

export function simulateScaling({period,history={},plan={}}={}){
  // Inputs are explicitly user-controlled simulation assumptions, not promises derived from wallet balance.
  if(!plan||typeof plan!=='object'||Array.isArray(plan))fail('plan','أدخل بيانات الخطة.');
  const horizonDays=required(plan,'horizonDays',{min:1,max:90,integer:true});
  const proposedDailyBudget=required(plan,'proposedDailyBudget',{min:0.01,max:1e8});
  const costPerEnteredOrder=required(plan,'costPerEnteredOrder',{min:0.01,max:1e7});
  const expectedDeliveryRate=required(plan,'expectedDeliveryRate',{min:0,max:1});
  const marginPerDelivered=required(plan,'contributionPerDeliveredOrderBeforeAds',{min:0,max:1e7});
  const failedLoss=required(plan,'returnLossPerFailedOrder',{min:0,max:1e7});
  const merchantCash=required(plan,'merchantCashAvailable',{min:0,max:1e12});
  const daysToNextCollection=required(plan,'daysToNextCollection',{min:0,max:365,integer:true});
  const extraDailyCashOutflow=required(plan,'extraDailyCashOutflow',{min:0,max:1e9});
  const extraDailyOperatingCost=required(plan,'extraDailyOperatingCost',{min:0,max:1e9});
  const confirmationCapacity=required(plan,'dailyConfirmationCapacity',{min:0,max:1e8});
  const packingCapacity=required(plan,'dailyPackingCapacity',{min:0,max:1e8});
  const shippingCapacity=required(plan,'dailyShippingCapacity',{min:0,max:1e8});
  const stockRows=Array.isArray(plan.stockItems)?plan.stockItems:[];
  if(stockRows.length>40)fail('stockItems','الحد الأقصى 40 صنفًا في المحاكاة.');
  if(plan.coversAllPromotedSkus===true&&!stockRows.length)fail('stockItems','لا يمكن تأكيد التغطية بدون أي صنف.');
  const seen=new Set();
  const projectedDailyOrders=proposedDailyBudget/costPerEnteredOrder;
  const stockItems=stockRows.map((item,i)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))fail('stockItems','بيانات SKU غير صالحة.');
    const sku=String(item.sku||'').trim().slice(0,120);
    const identity=String(item.productId||sku).trim();
    if(!sku||!identity||seen.has(identity))fail('stockItems','منتج المخزون فارغ أو متكرر.');
    seen.add(identity);
    const availableUnits=required(item,'availableUnits',{min:0,max:1e9});
    const unitsPerOrder=required(item,'unitsPerOrder',{min:0.01,max:1000});
    const supplierLeadDays=required(item,'supplierLeadDays',{min:0,max:365});
    const safetyDays=required(item,'safetyDays',{min:0,max:365});
    const orderShare=shareOf(item);
    const dailyConsumption=projectedDailyOrders*unitsPerOrder*orderShare;
    const requiredUnits=Math.ceil(Math.max(dailyConsumption,dailyConsumption*(supplierLeadDays+safetyDays)));
    // At least the first day's physical demand must be covered, even if lead-time is claimed as zero.
    const horizonUnits=Math.ceil(dailyConsumption*horizonDays);
    return {sku,orderShare,availableUnits,unitsPerOrder,supplierLeadDays,safetyDays,
      dailyConsumption:round(dailyConsumption),requiredUnits,horizonUnits,shortageUnits:Math.max(0,requiredUnits-availableUnits),
      coverageDays:dailyConsumption?round(availableUnits/dailyConsumption):null};
  });
  const daysInPeriod=good(history.days)&&num(history.days)>0?num(history.days):null;
  const historicalSpend=good(history.spend)&&num(history.spend)>=0?num(history.spend):null;
  const historicalOrders=good(history.realOrders)&&num(history.realOrders)>=0?num(history.realOrders):null;
  const historicalCPP=historicalSpend!==null&&historicalOrders>0?historicalSpend/historicalOrders:null;
  const dailyBaselineSpend=daysInPeriod&&historicalSpend!==null?historicalSpend/daysInPeriod:null;
  const dailyBaselineOrders=daysInPeriod&&historicalOrders!==null?historicalOrders/daysInPeriod:null;
  const totalOrders=projectedDailyOrders*horizonDays;
  const delivered=totalOrders*expectedDeliveryRate;
  const failed=totalOrders-delivered;
  const ads=proposedDailyBudget*horizonDays;
  const variableContribution=delivered*marginPerDelivered-failed*failedLoss;
  const operating=extraDailyOperatingCost*horizonDays;
  const profit=variableContribution-ads-operating;
  const maxBreakEvenCpp=expectedDeliveryRate*marginPerDelivered-(1-expectedDeliveryRate)*failedLoss-(extraDailyOperatingCost/(projectedDailyOrders||1));
  const dailyCashOutflow=proposedDailyBudget+extraDailyCashOutflow;
  const cashNeededToNextCollection=dailyCashOutflow*daysToNextCollection;
  // No COD receipts are presumed before their next independently verified settlement.
  const cashDeficit=Math.max(0,cashNeededToNextCollection-merchantCash);
  const cap=Math.min(confirmationCapacity,packingCapacity,shippingCapacity);
  const shippingBottleneck=Math.max(0,projectedDailyOrders-cap);
  const readiness=assessScalingReadiness({
    period:period||null,orders:{total:historicalOrders??0,pending:0},inventory:{lowStock:0,outOfStock:0},
    marketing:{spend:historicalSpend??0,realOrders:historicalOrders??0,attributedOrders:good(history.attributedOrders)?num(history.attributedOrders):null},
    stockPlan:{coversAllPromotedSkus:plan.coversAllPromotedSkus===true,
      items:stockItems.map(row=>({sku:row.sku,availableUnits:row.availableUnits,
        projectedDailyOrders:projectedDailyOrders*row.orderShare,unitsPerOrder:row.unitsPerOrder,
        supplierLeadDays:row.supplierLeadDays,safetyDays:row.safetyDays}))},
    cashPlan:{merchantCashAvailable:merchantCash,projectedDailyTotalOutflow:dailyCashOutflow,
      daysToNextCollection,outflowIncludesAdsStockAndOperations:plan.cashOutflowComplete===true},
    operationsPlan:{projectedDailyOrders,dailyConfirmationCapacity:confirmationCapacity,
      dailyPackingCapacity:packingCapacity,dailyShippingCapacity:shippingCapacity},
    unitEconomics:{contributionPerDeliveredOrderBeforeAds:marginPerDelivered,returnLossPerFailedOrder:failedLoss,
      expectedDeliveryRate,projectedCostPerEnteredOrder:costPerEnteredOrder+extraDailyOperatingCost/projectedDailyOrders}
  });
  const historicalCaution=[];
  if(historicalCPP===null)historicalCaution.push('تكلفة الطلب الفعلية التاريخية غير متاحة للتحقق من السيناريو.');
  if(historicalCPP!==null&&costPerEnteredOrder<historicalCPP*0.7)
    historicalCaution.push('تكلفة الطلب المفترضة أقل من الفعلية التاريخية بأكثر من 30%، وقد تكون الخطة متفائلة.');
  if(plan.coversAllPromotedSkus!==true)historicalCaution.push('لم يتم توثيق أن كل المنتجات المعلن عنها ومكونات الباندل مشمولة.');
  if(plan.cashOutflowComplete!==true)historicalCaution.push('مصروفات السيولة اليومية لا تشمل كل التوريد والتشغيل باعتراف المستخدم.');
  if(plan.currencyVerified!==true)historicalCaution.push('عملة الميزانية وهوامش الربح والسيولة لم يتم التحقق من تطابقها.');
  const blockers=[
    ...(profit<=0?['هامش الربح المتوقع بعد الإعلان والمصاريف غير موجب.']:[]),
    ...(cashDeficit>0?['يوجد عجز سيولة قبل التحصيل القادم.']:[]),
    ...(shippingBottleneck>0?['طاقة التأكيد أو التجهيز أو الشحن أقل من حجم الطلب المتوقع.']:[]),
    ...stockItems.filter(row=>row.shortageUnits>0).map(row=>'عجز مخزون في '+row.sku+'.'),
    ...readiness.checks.filter(row=>row.status==='blocked').map(row=>row.detail)
  ];
  return {
    version:1,kind:'hypothetical_scenario',period:period||null,currency:String(plan.currency||'EGP').slice(0,8),
    assumptions:{horizonDays,proposedDailyBudget,costPerEnteredOrder,expectedDeliveryRate,merchantCash,daysToNextCollection,
      currencyVerified:plan.currencyVerified===true,stockCoverageVerified:plan.coversAllPromotedSkus===true,
      completeCashOutflow:plan.cashOutflowComplete===true},
    baseline:{spend:historicalSpend,orders:historicalOrders,dailySpend:dailyBaselineSpend===null?null:round(dailyBaselineSpend),
      dailyOrders:dailyBaselineOrders===null?null:round(dailyBaselineOrders),historicalCPP:historicalCPP===null?null:round(historicalCPP)},
    forecast:{dailyOrders:round(projectedDailyOrders),totalOrders:round(totalOrders),deliveredOrders:round(delivered),
      failedOrders:round(failed),adSpend:round(ads),beforeAdsContribution:round(variableContribution),
      otherOperatingCosts:round(operating),estimatedContributionAfterAds:round(profit),
      breakEvenCostPerEnteredOrder:round(maxBreakEvenCpp),dailyOutflow:round(dailyCashOutflow),
      cashNeededBeforeCollection:round(cashNeededToNextCollection),cashDeficit:round(cashDeficit),
      dailyOperationsCapacity:round(cap),unprocessedOrdersPerDay:round(shippingBottleneck)},
    stockItems,readiness,
    recommendation:blockers.length?'fix_blockers_first':historicalCaution.length?'validate_assumptions':'simulation_meets_inputs',
    blockers:[...new Set(blockers)],warnings:historicalCaution,approvalToIncreaseBudget:false,
    disclaimer:'محاكاة افتراضية فقط: تقديرات الدخل والطلب والسيولة والعمليات تعتمد على افتراضات المستخدم؛ لا تؤكد أرباحًا فعلية ولا تجري أي تعديل على ميزانيات الإعلانات أو الرصيد.'
  };
}

// A rules preview is deliberately not an API to modify Meta budgets.
export function dryRunScalingRule({scenario,proposedIncreasePct=10,maxDailyBudget=0}={}){
  if(!scenario||scenario.kind!=='hypothetical_scenario')fail('scenario','محاكاة معتمدة من المحرك مطلوبة.');
  const percentage=Number(proposedIncreasePct),cap=Number(maxDailyBudget);
  if(!Number.isFinite(percentage)||percentage<1||percentage>30||!Number.isFinite(cap)||cap<=0)
    fail('rule','نسبة الزيادة يجب أن تكون 1–30% مع حد أقصى يومي موجب.');
  const present=scenario.assumptions.proposedDailyBudget;
  const proposed=round(present*(1+percentage/100));
  const meetsHypotheticalThresholds=scenario.recommendation==='simulation_meets_inputs'&&
    scenario.readiness?.canScale===true&&scenario.assumptions.currencyVerified===true&&proposed<=cap;
  // No trustworthy bank cash, payout schedule, end-to-end promoted-SKU mapping or
  // signed-off team capacity feed is wired yet. A simulated scenario may be healthy
  // but cannot become an actionable approval simply by checking user-attestation boxes.
  const requiredIndependentEvidence=['merchant_bank_cash','carrier_payout_schedule',
    'promoted_sku_coverage','staff_and_shipping_capacity','unit_economics'];
  return {mode:'dry_run',execution:false,meetsHypotheticalThresholds,canSubmitForApproval:false,
    pendingVerification:requiredIndependentEvidence,changeType:'daily_budget_increase',
    currentDailyBudget:present,proposedDailyBudget:proposed,maxDailyBudget:cap,
    reason:meetsHypotheticalThresholds?
      'السيناريو يحقق الشروط الافتراضية، لكن تنقص أدلة مستقلة للسيولة والتحصيل والمخزون والتشغيل والربحية. لا يمكن طلب تنفيذ ميزانية الآن.':
      'الشروط الافتراضية أو حد الإنفاق غير مكتملة، فضلًا عن نقص التحقق المستقل. لا يوجد تصريح بالصرف.',
    auditRequired:true,humanApprovalRequired:true,providerWrite:false};
}
