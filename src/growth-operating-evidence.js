// Read-only, aggregated merchant evidence. No ledger entries, payouts or user PII.
// COD marked collected inside Kun is not proof of the merchant's bank receipt.
const n=x=>Number.isFinite(Number(x))?Number(x):0;
const round=x=>Math.round(n(x)*100)/100;
const error=(message,status=400)=>{throw Object.assign(new Error(message),{status,code:'GROWTH_EVIDENCE_INVALID'});};
const iso=/^\d{4}-\d{2}-\d{2}$/;

export async function growthOperatingEvidence(env,{clientId,storeId,from,to}={}){
  if(!clientId||!storeId)error('اختار المتجر المحدد قبل مراجعة عمليات التوسع.');
  if(!iso.test(from||'')||!iso.test(to||'')||from>to)error('حدد فترة صالحة.');
  const [cohort,backlog,collected]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) orders_entered,
      SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN state IN ('confirmed','preparing') THEN 1 ELSE 0 END) in_progress,
      SUM(CASE WHEN state='shipped' THEN 1 ELSE 0 END) in_transit,
      SUM(CASE WHEN state='signed' THEN 1 ELSE 0 END) signed,
      SUM(CASE WHEN state='collected' THEN 1 ELSE 0 END) collected,
      SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned,
      SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled
      FROM orders o WHERE o.client_id=? AND o.store_id=?
       AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)
       AND NOT EXISTS(SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)`)
      .bind(clientId,storeId,from,to).first(),
    env.DB.prepare(`SELECT COUNT(*) active_queue,
      SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending_confirmation,
      SUM(CASE WHEN state IN ('confirmed','preparing') THEN 1 ELSE 0 END) awaiting_packing,
      SUM(CASE WHEN state='shipped' THEN 1 ELSE 0 END) awaiting_delivery,
      SUM(CASE WHEN state='signed' THEN 1 ELSE 0 END) delivered_not_marked_collected
      FROM orders o WHERE o.client_id=? AND o.store_id=?
       AND o.state IN ('pending','confirmed','preparing','shipped','signed')
       AND NOT EXISTS(SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)`)
      .bind(clientId,storeId).first(),
    env.DB.prepare(`SELECT COUNT(*) recorded_collections,
      COALESCE(SUM(CASE WHEN o.collected_amount IS NOT NULL AND o.collected_amount>=0 THEN o.collected_amount ELSE 0 END),0) recorded_gross_collected,
      SUM(CASE WHEN o.collected_amount IS NULL THEN 1 ELSE 0 END) missing_recorded_amount_count,
      AVG(CASE WHEN o.collected_at IS NOT NULL AND
             date(o.collected_at)>=date(COALESCE(o.date,o.created_at)) THEN
             julianday(date(o.collected_at))-julianday(date(COALESCE(o.date,o.created_at))) END) average_order_to_recorded_collection_days
      FROM orders o WHERE o.client_id=? AND o.store_id=? AND o.state='collected'
       AND date(COALESCE(o.collected_at,o.date,o.created_at)) BETWEEN date(?) AND date(?)
       AND NOT EXISTS(SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)`)
      .bind(clientId,storeId,from,to).first()
  ]);
  const asCount=x=>Math.max(0,Math.round(n(x)));
  return {
    from,to,storeId,
    orderCohort:{entered:asCount(cohort?.orders_entered),pending:asCount(cohort?.pending),
      inProgress:asCount(cohort?.in_progress),shipped:asCount(cohort?.in_transit),
      signed:asCount(cohort?.signed),collected:asCount(cohort?.collected),
      returned:asCount(cohort?.returned),cancelled:asCount(cohort?.cancelled)},
    currentBacklog:{active:asCount(backlog?.active_queue),
      pendingConfirmation:asCount(backlog?.pending_confirmation),
      awaitingPacking:asCount(backlog?.awaiting_packing),
      awaitingDelivery:asCount(backlog?.awaiting_delivery),
      deliveredNotMarkedCollected:asCount(backlog?.delivered_not_marked_collected)},
    codRecorded:{count:asCount(collected?.recorded_collections),
      grossRecorded:round(collected?.recorded_gross_collected),
      missingAmountCount:asCount(collected?.missing_recorded_amount_count),
      meanDaysFromOrderToRecordedCollection:collected?.average_order_to_recorded_collection_days==null?
        null:round(collected.average_order_to_recorded_collection_days)},
    limitations:[
      'الحالات تمثل الوضع المسجل لكل طلب، ولا تثبت الطاقة اليومية الفعلية للموظفين.',
      'مبالغ التحصيل المسجلة لا تعني وصول الأموال إلى حساب التاجر ولا تثبت مواعيد التسوية القادمة؛ الطلبات بلا مبلغ تحصيل لا تُضاف إلى المبلغ المحصل.',
      'أرقام الطابور تشمل الطلبات غير المغلقة حاليًا حتى إن كانت خارج فترة التقرير، مع استبعاد النسخ المكررة.',
      'تقدير السيولة لا يستخدم رصيد محفظة كن ولا يفترض أي دفعة COD مستقبلية.'
    ],
    verifiedStaffCapacity:false,verifiedCarrierPayoutSchedule:false,merchantBankBalanceKnown:false
  };
}
