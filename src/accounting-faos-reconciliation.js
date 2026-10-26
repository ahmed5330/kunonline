/* Read-only reconciliation bridge for FAOS and Kun Online's legacy operational reports.
   Equal nominal values are NOT certified settlement or revenue recognition.
   This code never auto-posts and does not persist financial data. */
const amount=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Math.round(Number(v)*100)/100:null;
const diff=(a,b)=>a===null||b===null?null:Math.round((a-b)*100)/100;
export function reconcileAccountingSources({legacy={},ledger={},quality={}}={}){
  const operationalRevenue=amount(legacy.deliveredRevenue);
  const postedRevenue=amount(ledger.netSales);
  const collectedReported=amount(legacy.collectedRevenue);
  const collectedRecorded=amount(legacy.verifiedCollectedRevenue);
  const estimatedCollection=collectedReported!==null&&collectedRecorded!==null
    ?Math.max(0,diff(collectedReported,collectedRecorded)):null;
  const cashRecord=amount(legacy.netCash);
  const rows=[
    {key:'revenue',label:'مبيعات التسليم مقابل دفتر الإيرادات',operational:operationalRevenue,ledger:postedRevenue,
      variance:diff(operationalRevenue,postedRevenue),unit:'EGP',status:'verification_required',
      why:'لا تعتمد المطابقة قبل ربط إثبات التسليم والمبيعات والمرتجعات والضريبة بقاعدة القيد'},
    {key:'cod',label:'مبالغ تحصيل مسجلة وليست بنكًا',operational:collectedRecorded,ledger:null,variance:null,
      unit:'EGP',status:'bank_reconciliation_required',
      why:'يجب مطابقة كشف J&T وشركات الشحن وبوليصات AWB والتحويل البنكي؛ سجل الطلب وحده غير كاف'},
    {key:'estimated_cod',label:'تحصيل بالتقدير من قيمة الطلب',operational:estimatedCollection,ledger:null,variance:null,
      unit:'EGP',status:estimatedCollection>0?'unverified_estimate':'not_applicable',
      why:'لا يتم إثبات المبلغ التقديري ضمن الخزنة أو البنك'},
    {key:'net_cash',label:'صافي حركات تشغيلية مقابل رصيد البنك',operational:cashRecord,ledger:null,variance:null,
      unit:'EGP',status:'bank_reconciliation_required',
      why:'صافي التدفق التشغيلي ليس رصيد كشف البنك، وقد يتضمن مصروفات أو تحصيلات بفترات مختلفة'}
  ];
  const exceptions=[];
  const add=(code,count,message)=>{
    if((Number(count)||0)>0)exceptions.push({code,count:Number(count),message});
  };
  add('UNVERIFIED_COLLECTIONS',legacy.unverifiedCollectedOrders??quality.unverifiedCollectedOrders,'تحصيلات لم يُثبت مبلغها الحقيقي');
  add('MISSING_COST_SNAPSHOT',quality.missingSaleCostSnapshots,'طلبات مسلّمة لا تحتوي على تكلفة مخزون مؤكدة');
  add('INVENTORY_DUPLICATE_EXPENSE_RISK',quality.inventoryPurchasesExpensed,'مشتريات قد تكون احتُسبت ضمن المصروفات وCOGS معًا');
  add('UNREVERSED_MANAGEMENT_FEES',quality.unreversedManagementFees,'رسوم إدارة لم تُعكس على طلبات ملغاة أو مرتجعة');
  add('MANUAL_AD_EXPENSE_RISK',quality.manualAdExpense,'إعلانات يدوية يجب مطابقتها مع البيانات المستوردة');
  return {
    certified:false,canPublishStatutoryStatements:false,
    status:'needs_source_document_reconciliation',
    currency:'EGP',rows,exceptions,
    coverage:{legacyOperationalEventsPosted:ledger.includesLegacyOperationalEvents===true,
      bankReconciliationDone:false,carrierSettlementReconciliationDone:false,
      inventoryCostVerificationDone:false,sourceAuthenticityVerificationDone:false,
      openingBalancesApproved:false},
    reason:'الدفتر الجديد مستقل عن بيانات التشغيل. يجب مطابقة مصادر المستندات والأرصدة الافتتاحية قبل اعتماد التقارير.'
  };
}
