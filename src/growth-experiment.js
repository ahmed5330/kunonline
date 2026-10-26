// Read-only before/after campaign scaling evaluation.
// Comparable store, currency, attribution and cohort maturity are required for any verdict.
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const r2=v=>Math.round(n(v)*100)/100;
const fail=(message)=>{throw Object.assign(new Error(message),{code:'GROWTH_COMPARE_INVALID',status:400});};
const iso=/^\d{4}-\d{2}-\d{2}$/;
const daysBetween=(from,to)=>Math.floor((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1;
const validWindow=window=>window&&iso.test(window.from||'')&&iso.test(window.to||'')&&window.from<=window.to&&daysBetween(window.from,window.to)<=90;
const summary=(snapshot)=>{
  const days=daysBetween(snapshot.from,snapshot.to),spend=n(snapshot.ads?.spend),
    enteredOrders=n(snapshot.overview?.totalOrders),revenue=n(snapshot.finance?.revenue),
    net=n(snapshot.finance?.netProfit),deliveredRevenue=n(snapshot.ads?.realRoas)*spend,
    delivered=n(snapshot.ads?.deliveredOrders);
  return {from:snapshot.from,to:snapshot.to,days,currency:snapshot.currency||'EGP',
    adSpend:r2(spend),dailyAdSpend:r2(spend/days),
    enteredOrders,dailyOrders:r2(enteredOrders/days),
    costPerEnteredOrder:enteredOrders?r2(spend/enteredOrders):null,
    deliveredOrders:delivered,deliveredRevenue:r2(deliveredRevenue),
    deliveredRevenueRoas:spend?r2(deliveredRevenue/spend):null,
    eligibleOrderRevenue:r2(revenue),cohortNetProfit:r2(net),
    note:'هامش الطلبات المؤهلة وصافيها ليسا بالضرورة نقدًا محصلًا حتى انتهاء الشحن والمرتجعات.'};
};
export function compareGrowthPeriods({before,after,today,minimumCohortDays=14}={}){
  if(!before||!after||!validWindow(before)||!validWindow(after))fail('الفترات غير صالحة؛ الحد الأقصى 90 يومًا للفترة.');
  if(before.to>=after.from)fail('لا يمكن تداخل فترتي قبل وبعد في التقييم.');
  if(!iso.test(today||''))fail('اليوم المحلي غير صالح.');
  if(!Number.isSafeInteger(minimumCohortDays)||minimumCohortDays<1||minimumCohortDays>90)fail('فترة نضج الطلبات غير صالحة.');
  const b=summary(before),a=summary(after),issues=[];
  if(b.currency!==a.currency)issues.push('اختلاف العملة بين الفترتين.');
  if(!b.adSpend||!a.adSpend)issues.push('إنفاق إعلاني غير كافٍ في إحدى الفترتين.');
  if(b.enteredOrders<30||a.enteredOrders<30)issues.push('عينة طلبات صغيرة؛ المقارنة لا تكفي لإثبات تحسن مستقر.');
  const bRec=before.ads?.spendReconciliation||{},aRec=after.ads?.spendReconciliation||{};
  if(bRec.needsReview||aRec.needsReview||bRec.currencyMismatch||aRec.currencyMismatch)
    issues.push('يوجد اختلاف بين مصادر الإنفاق أو العملة؛ أصلح التسوية أولًا.');
  if(bRec.manualExcludedWhenIntegrated||aRec.manualExcludedWhenIntegrated)
    issues.push('يوجد إنفاق إعلاني يدوي قد يحتاج مراجعة منفصلة عن المنصة.');
  const elapsed=daysBetween(after.to,today)-1;
  if(elapsed<minimumCohortDays)issues.push('الطلبات الأحدث لم تنضج بعد للتسليم والمرتجعات؛ الحكم النهائي مبكر.');
  // Normalise by day: uneven-length windows cannot be compared on raw totals.
  const delta=(left,right)=>right===null||left===null?null:r2(right-left);
  const pct=(left,right)=>left===null||right===null||left===0?null:r2((right-left)/Math.abs(left)*100);
  const change={
    dailyAdSpendPct:pct(b.dailyAdSpend,a.dailyAdSpend),
    dailyOrdersPct:pct(b.dailyOrders,a.dailyOrders),
    enteredCppPct:pct(b.costPerEnteredOrder,a.costPerEnteredOrder),
    realRoasPct:pct(b.deliveredRevenueRoas,a.deliveredRevenueRoas),
    eligibleProfitPerDayPct:pct(b.cohortNetProfit/b.days,a.cohortNetProfit/a.days),
    dailyOrdersDelta:delta(b.dailyOrders,a.dailyOrders)
  };
  const improving=issues.length===0&&change.dailyOrdersPct>0&&change.enteredCppPct<=10 &&
    change.eligibleProfitPerDayPct>0;
  return {kind:'historical_comparison',before:b,after:a,change,status:issues.length?'insufficient_evidence':
    improving?'positive_indication':'review_required',issues,approvedToScale:false,
    caveat:'تقييم اتجاهات قبل وبعد فقط، وليس دليل سببية للإعلانات. تغيّر الأسعار والعروض والمنتجات والموسمية وجودة الطلبات يمكن أن يؤثر في النتائج. لا ينفذ أي تعديل للحملات.'};
}
