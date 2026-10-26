// Read-only pre-scaling risk assessment. No Meta writes, no wallet writes and no guessed inputs.
// All monetary amounts must be in the same currency and the same business/store scope.
const validNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const number = value => Number(value);
const nonNegative = value => validNumber(value) && number(value) >= 0;
const positive = value => validNumber(value) && number(value) > 0;
const round = value => Math.round(value * 100) / 100;
const format = value => round(value).toLocaleString('en-US', {maximumFractionDigits: 2});

function check(id, label, status, detail, nextStep, evidence = {}) {
  return {id, label, status, detail, nextStep, evidence};
}

export function assessScalingReadiness({
  period = null, orders = {}, inventory = {}, marketing = {},
  stockPlan = null, cashPlan = null, operationsPlan = null, unitEconomics = null
} = {}) {
  const checks = [];
  const totalOrders = nonNegative(orders.total) ? number(orders.total) : 0;
  const pendingOrders = nonNegative(orders.pending) ? number(orders.pending) : 0;
  const adSpend = nonNegative(marketing.spend) ? number(marketing.spend) : 0;
  const attributed = nonNegative(marketing.attributedOrders) ? number(marketing.attributedOrders) : null;

  const reportedOrderCount = nonNegative(marketing.realOrders) ? number(marketing.realOrders) : null;
  if (reportedOrderCount !== null && reportedOrderCount !== totalOrders) {
    checks.push(check('data', 'موثوقية بيانات الإعلان والطلبات', 'blocked',
      'عدد الطلبات الموحّد في التحليل التجاري لا يطابق مصدر تحليل الحملات للفترة والمتجر نفسيهما.',
      'سوِّ مصادر الطلبات والنسخ المكررة والفلاتر قبل استخدام تكلفة الطلب أو اتخاذ قرار توسع.',
      {adSpend, totalOrders, marketingRealOrders: reportedOrderCount, period}));
  } else if (adSpend <= 0 || totalOrders <= 0) {
    checks.push(check('data', 'موثوقية بيانات الإعلان والطلبات', 'unknown',
      'لا توجد بيانات إنفاق وطلبات كافية في الفترة المختارة لتقييم التوسع.',
      'راجع مزامنة الحملات واستيراد جميع الطلبات والفترة المختارة.',
      {adSpend, totalOrders, period}));
  } else if (attributed !== null && totalOrders >= 10 && attributed / totalOrders < 0.7) {
    checks.push(check('data', 'موثوقية بيانات الإعلان والطلبات', 'warning',
      'أكثر من 30% من الطلبات غير منسوبة لحملة؛ لا تعتمد على ROAS لكل حملة وحده.',
      'راجع UTMs وClick IDs ومصادر الطلبات قبل توجيه الميزانيات.',
      {adSpend, totalOrders, attributedOrders: attributed, period}));
  } else {
    checks.push(check('data', 'موثوقية بيانات الإعلان والطلبات', 'ok',
      'تم رصد إنفاق وطلبات للفترة. هذا لا يغني عن مراجعة دقة التتبع وتوقيت التسليم.',
      'راجع تطابق بيانات المنصة مع الطلبات الفعلية دوريًا.',
      {adSpend, totalOrders, attributedOrders: attributed, period}));
  }

  const stockItems = Array.isArray(stockPlan?.items) ? stockPlan.items : [];
  const stockValid = stockPlan?.coversAllPromotedSkus === true && stockItems.length > 0 &&
    stockItems.every(item => positive(item.projectedDailyOrders) && positive(item.unitsPerOrder) &&
      nonNegative(item.availableUnits) && nonNegative(item.supplierLeadDays) && nonNegative(item.safetyDays));
  const low = nonNegative(inventory.lowStock) ? number(inventory.lowStock) : 0;
  const out = nonNegative(inventory.outOfStock) ? number(inventory.outOfStock) : 0;
  if (!stockValid) {
    checks.push(check('inventory', 'جاهزية مخزون المنتجات المعلن عنها', out || low ? 'warning' : 'unknown',
      out || low
        ? 'يوجد ' + format(out) + ' منتج نافد و' + format(low) + ' منتج منخفض المخزون، لكن لم يتم التأكد من ارتباطها بالحملات.'
        : 'لا توجد خطة طلب وتوريد لكل SKU معلن عنه، لذا لا يمكن حساب أيام تغطية المخزون بأمان.',
      'اربط الحملات والـBundles بمكونات SKU وحدد معدل الاستهلاك ومدة التوريد ومخزون الأمان.',
      {outOfStock: out, lowStock: low, forecastCoverage: false}));
  } else {
    const rows = stockItems.map(item => {
      const dailyDemand = number(item.projectedDailyOrders) * number(item.unitsPerOrder);
      const demand = Math.max(dailyDemand, dailyDemand *
        (number(item.supplierLeadDays) + number(item.safetyDays)));
      return {sku: String(item.sku || 'SKU'), requiredUnits: round(demand),
        availableUnits: number(item.availableUnits), gapUnits: round(Math.max(0, demand - number(item.availableUnits)))};
    });
    const gaps = rows.filter(item => item.gapUnits > 0);
    checks.push(check('inventory', 'جاهزية مخزون المنتجات المعلن عنها', gaps.length ? 'blocked' : 'ok',
      gaps.length ? 'يوجد عجز متوقع في ' + gaps.length + ' من منتجات الحملات.' : 'المخزون المحدد يغطي مدة التوريد ومخزون الأمان للمنتجات المعلن عنها وفق المدخلات.',
      gaps.length ? 'وفّر المخزون الناقص قبل رفع حجم الطلبات.' : 'راقب استهلاك الـSKU والتوريد يوميًا.',
      {items: rows, forecastCoverage: true}));
  }

  const cashValid = cashPlan && nonNegative(cashPlan.merchantCashAvailable) &&
    positive(cashPlan.projectedDailyTotalOutflow) && nonNegative(cashPlan.daysToNextCollection) &&
    cashPlan.outflowIncludesAdsStockAndOperations === true;
  if (!cashValid) {
    checks.push(check('cash_flow', 'سيولة التاجر أثناء فترة التوسع', 'unknown',
      'رصيد محفظة كن أونلاين ليس سيولة التاجر. لا توجد ميزانية نقدية شاملة ومواعيد تحصيل مؤكدة.',
      'أدخل النقد المتاح، مصروف اليوم شامل الإعلان والتوريد والتشغيل، ومدة انتظار التحصيل.',
      {cashFlowVerified: false}));
  } else {
    const need = round(number(cashPlan.projectedDailyTotalOutflow) * number(cashPlan.daysToNextCollection));
    const cash = number(cashPlan.merchantCashAvailable);
    checks.push(check('cash_flow', 'سيولة التاجر أثناء فترة التوسع', cash >= need ? 'ok' : 'blocked',
      cash >= need ? 'السيولة المعلنة تغطي المصروفات المتوقعة حتى التحصيل التالي، دون ضمان انتظام التحصيل.' :
        'عجز سيولة متوقع قدره ' + format(need - cash) + ' قبل التحصيل القادم.',
      cash >= need ? 'تحقق من تواريخ التحصيل والالتزامات الطارئة.' : 'وفّر سيولة أو اخفض وتيرة التوسع.',
      {requiredCash: need, merchantCashAvailable: cash, cashFlowVerified: true}));
  }

  const opsValid = operationsPlan && positive(operationsPlan.projectedDailyOrders) &&
    nonNegative(operationsPlan.dailyConfirmationCapacity) && nonNegative(operationsPlan.dailyPackingCapacity) &&
    nonNegative(operationsPlan.dailyShippingCapacity);
  if (!opsValid) {
    checks.push(check('operations', 'طاقة التأكيد والتجهيز والشحن', pendingOrders >= 20 && totalOrders > 0 &&
      pendingOrders / totalOrders >= 0.25 ? 'warning' : 'unknown',
      'لا توجد طاقة يومية موثقة للتأكيد والتغليف والشحن؛ الطلبات المعلقة خلال الفترة: ' + format(pendingOrders) + '.',
      'سجّل قدرة كل فريق وعدد الطلبات المتوقعة بعد التوسع وتراكم الطلبات الحالي.',
      {pendingOrders, capacityVerified: false}));
  } else {
    const demand = number(operationsPlan.projectedDailyOrders);
    const cap = Math.min(number(operationsPlan.dailyConfirmationCapacity), number(operationsPlan.dailyPackingCapacity), number(operationsPlan.dailyShippingCapacity));
    checks.push(check('operations', 'طاقة التأكيد والتجهيز', cap >= demand ? 'ok' : 'blocked',
      cap >= demand ? 'قدرة التأكيد والتجهيز والشحن تكفي الطلبات المتوقعة وفق المدخلات.' :
        'القدرة اليومية أقل من المستهدف بمقدار ' + format(demand - cap) + ' طلب.',
      cap >= demand ? 'تابع تأخير الطوابير والشحن الفعلي.' : 'زوّد قدرة أضعف فريق (التأكيد أو التجهيز أو الشحن) قبل توسيع الإعلانات.',
      {projectedDailyOrders: demand, dailyCapacity: cap, confirmationCapacity: number(operationsPlan.dailyConfirmationCapacity), packingCapacity: number(operationsPlan.dailyPackingCapacity), shippingCapacity: number(operationsPlan.dailyShippingCapacity), capacityVerified: true}));
  }

  const economicsValid = unitEconomics && nonNegative(unitEconomics.contributionPerDeliveredOrderBeforeAds) &&
    nonNegative(unitEconomics.returnLossPerFailedOrder) &&
    nonNegative(unitEconomics.projectedCostPerEnteredOrder) &&
    validNumber(unitEconomics.expectedDeliveryRate) && number(unitEconomics.expectedDeliveryRate) >= 0 &&
    number(unitEconomics.expectedDeliveryRate) <= 1;
  if (!economicsValid) {
    checks.push(check('profitability', 'الربحية بعد التسليم والمرتجعات', 'unknown',
      'ROAS الإيرادات لا يثبت صافي الربح. تكلفة المنتج والشحن والتأكيد والمرتجع غير مكتملة في حساب قرار التوسع.',
      'احسب هامش الطلب المُسلَّم قبل الإعلان وخسارة الطلب غير المسلم ونسبة التسليم المتوقعة وتكلفة الطلب الداخل.',
      {unitEconomicsVerified: false}));
  } else {
    const d = number(unitEconomics.expectedDeliveryRate), margin = number(unitEconomics.contributionPerDeliveredOrderBeforeAds);
    const returnLoss = number(unitEconomics.returnLossPerFailedOrder);
    const breakevenCpp = round(d * margin - (1 - d) * returnLoss);
    const projectedCpp = number(unitEconomics.projectedCostPerEnteredOrder);
    checks.push(check('profitability', 'الربحية بعد التسليم والمرتجعات',
      breakevenCpp > projectedCpp ? 'ok' : 'blocked',
      breakevenCpp > projectedCpp
        ? 'هامش الطلب المتوقع بعد الإعلان موجب وفق افتراضات التسليم والتكاليف.'
        : 'تكلفة الطلب المتوقعة أعلى من أو تساوي الحد المربح محسوبًا بعد خسائر عدم التسليم.',
      breakevenCpp > projectedCpp ? 'أعد حساب الهامش مع تغيّر التكاليف والمرتجعات.' :
        'حسّن تكلفة الطلب أو الهامش أو نسبة التسليم قبل التوسع.',
      {breakevenCpp, projectedCpp, expectedProfitPerEnteredOrder: round(breakevenCpp - projectedCpp), unitEconomicsVerified: true}));
  }

  const counts = checks.reduce((all, item) => ({...all, [item.status]: all[item.status] + 1}),
    {ok: 0, warning: 0, blocked: 0, unknown: 0});
  const decision = counts.blocked ? 'blocked' : counts.warning ? 'review_required' :
    counts.unknown ? 'insufficient_data' : 'ready';
  const titles = {blocked: 'لا توسّع قبل حل المخاطر', review_required: 'راجع المخاطر قبل التوسع',
    insufficient_data: 'بيانات الجاهزية غير مكتملة', ready: 'جاهزية مبدئية وفق المدخلات'};
  return {
    version: 1, decision, canScale: decision === 'ready', title: titles[decision], checks, counts,
    disclaimer: 'تقييم إرشادي للمتجر والفترة المحددة، وليس تصريحًا تلقائيًا بالصرف أو ضمانًا للأرباح. لا يجري أي تعديل على الحملات.',
    autoBudgetChanges: false
  };
}
