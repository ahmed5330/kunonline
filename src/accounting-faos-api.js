import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {ACCOUNTS,ACCOUNT_BY_CODE,normalizeLines,syntheticCommerceScenario} from './accounting-faos-core.js';
import {accountingOverview} from './accounting.js';
import {reconcileAccountingSources} from './accounting-faos-reconciliation.js';

const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(s,max=250)=>String(s??'').trim().slice(0,max);
const iso=/^\d{4}-\d{2}-\d{2}$/;
const month=/^\d{4}-(0[1-9]|1[0-2])$/;
function fail(message,status=400,code='FAOS_INVALID_REQUEST'){throw Object.assign(new Error(message),{status,code});}
function period(url){
  const date=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Africa/Cairo'}).format(new Date());
  const from=clean(url.searchParams.get('from'))||date.slice(0,7)+'-01';
  const to=clean(url.searchParams.get('to'))||date;
  if(!iso.test(from)||!iso.test(to)||from>to)fail('نطاق التاريخ غير صحيح');
  return {from,to};
}
async function meFor(req,env,ctx,delegate){
  const url=new URL(req.url);url.pathname='/api/me';url.search='';
  const r=await delegate.fetch(new Request(url,{method:'GET',headers:req.headers}),env,ctx);
  const me=await r.json().catch(()=>({}));
  if(!r.ok||!me?.role)fail('مطلوب تسجيل الدخول',401,'AUTH_REQUIRED');
  return me;
}
async function scopeFor(req,env,me,body=null,write=false){
  const url=new URL(req.url);
  const clientId=resolveTenant(me,clean(body?.clientId||url.searchParams.get('clientId'))||null);
  const requested=clean(body?.storeId||url.searchParams.get('storeId'))||null;
  const scope=await resolveStoreScope(env,me,clientId,requested,{write});
  if(write&&!scope.storeId)fail('يجب تحديد المتجر لإضافة القيود',400,'STORE_SELECTION_REQUIRED');
  return {clientId,storeId:scope.storeId||null};
}
const dbFailure=error=>{
  const message=String(error?.message||'');
  if(/no such table: faos_/i.test(message))return fail('لم يتم تطبيق ترحيل قاعدة بيانات FAOS بعد',503,'FAOS_MIGRATION_REQUIRED');
  if(/FAOS_PERIOD_CLOSED/.test(message))return fail('لا يمكن الترحيل إلى فترة مقفولة',409,'FAOS_PERIOD_CLOSED');
  if(/FAOS_JOURNAL_NOT_BALANCED/.test(message))return fail('القيد غير متوازن عند الترحيل',409,'FAOS_JOURNAL_NOT_BALANCED');
  if(/FAOS_POSTED_IMMUTABLE|FAOS_LINE_IMMUTABLE/.test(message))return fail('القيود المرحلة لا تقبل التعديل أو الحذف',409,'FAOS_POSTED_IMMUTABLE');
  throw error;
};
export async function faosLedgerBalance(env,{clientId,storeId,from,to}){
  const storeFilter=storeId?' AND j.store_id=?':'',bind=storeId?[from,from,clientId,storeId,to]:[from,from,clientId,to];
  let rows;
  try{
    const data=await env.DB.prepare(`SELECT l.account_code code,SUM(l.debit_minor) debit_minor,SUM(l.credit_minor) credit_minor,
      SUM(CASE WHEN j.entry_date>=? THEN l.debit_minor ELSE 0 END) period_debit_minor,
      SUM(CASE WHEN j.entry_date>=? THEN l.credit_minor ELSE 0 END) period_credit_minor
      FROM faos_journal_lines l JOIN faos_journals j ON j.id=l.journal_id AND j.client_id=l.client_id AND j.store_id=l.store_id
      WHERE j.client_id=?${storeFilter} AND j.entry_date<=? AND j.status='posted'
      GROUP BY l.account_code ORDER BY l.account_code`).bind(...bind).all();
    rows=data.results||[];
  }catch(error){dbFailure(error)}
  const accounts=rows.map(r=>{const a=ACCOUNT_BY_CODE.get(String(r.code)),dr=Number(r.debit_minor)||0,cr=Number(r.credit_minor)||0;return {code:r.code,name:a?.name||'حساب غير معروف',type:a?.type||'unknown',debit:dr/100,credit:cr/100,net:(dr-cr)/100,periodNet:((Number(r.period_debit_minor)||0)-(Number(r.period_credit_minor)||0))/100};});
  const debit=rows.reduce((s,r)=>s+(Number(r.debit_minor)||0),0),credit=rows.reduce((s,r)=>s+(Number(r.credit_minor)||0),0);
  const sum=(type,field='periodNet')=>accounts.filter(x=>x.type===type).reduce((sum,x)=>sum+x[field],0);
  const totalRevenue=sum('revenue');
  const revenues=totalRevenue===0?0:-totalRevenue,returns=sum('contra_revenue'),expenses=sum('expense');
  const zero=value=>value===0?0:value;
  const assets=zero(Math.round(sum('asset','net')*100)),
        liabilities=zero(Math.round(-sum('liability','net')*100)),
        capitalAndRetained=zero(Math.round(-sum('equity','net')*100)),
        cumulativeEarnings=zero(Math.round((-sum('revenue','net')-sum('contra_revenue','net')-sum('expense','net'))*100));
  const equity=capitalAndRetained+cumulativeEarnings;
  return {
    accounts,balanced:debit===credit,totalDebit:debit/100,totalCredit:credit/100,
    revenues,returns,netSales:revenues-returns,expenses,netProfit:revenues-returns-expenses,
    incomeStatement:{revenue:revenues,returns,netRevenue:revenues-returns,expenses,netProfit:revenues-returns-expenses,period:{from,to}},
    balanceSheet:{asOf:to,assets:assets/100,liabilities:liabilities/100,equity:equity/100,
      paidInCapitalAndRetained:capitalAndRetained/100,cumulativeEarnings:cumulativeEarnings/100,
      difference:(assets-liabilities-equity)/100,balanced:assets===liabilities+equity,
      accountingEvidenceOnly:true,completeSourceIntegration:false},
    source:'posted_faos_journals_only',includesLegacyOperationalEvents:false
  };
}
// Read-only reconciliation probes against current operational data.
export async function operationalQuality(env,{clientId,storeId,from,to}){
  const sw=storeId?' AND o.store_id=?':'',tw=storeId?' AND store_id=?':'',args=storeId?[clientId,storeId,from,to]:[clientId,from,to];
  const [orders,manual,wrongFees]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) order_count,
      COALESCE(SUM(CASE WHEN o.state IN ('confirmed','preparing','shipped') THEN o.total ELSE 0 END),0) pipeline_not_verified_revenue,
      COALESCE(SUM(CASE WHEN o.state IN ('signed','collected') AND o.product_cost IS NULL THEN 1 ELSE 0 END),0) sale_missing_cost_snapshot,
      COALESCE(SUM(CASE WHEN o.state='collected' AND o.collected_amount IS NULL THEN 1 ELSE 0 END),0) unknown_collected_amounts
      FROM orders o WHERE o.client_id=?${sw} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)
      AND NOT EXISTS(SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)`).bind(...args).first(),
    env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='expense' AND category='مشتريات' THEN amount ELSE 0 END),0) inventory_purchases_expensed,
      COALESCE(SUM(CASE WHEN type='expense' AND (category LIKE '%إعلان%' OR category LIKE '%اعلان%' OR category LIKE '%Ads%' OR category LIKE '%تسويق%' OR category LIKE '%marketing%') THEN amount ELSE 0 END),0) manually_recorded_ad_cost
      FROM transactions WHERE client_id=?${tw} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)`).bind(...args).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM order_management_fees f JOIN orders o ON o.id=f.order_id AND o.client_id=f.client_id
      WHERE f.client_id=?${storeId?' AND f.store_id=?':''} AND f.status='active' AND o.state IN ('returned','cancelled')
      AND NOT EXISTS(SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)
      AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...args).first()
  ]);
  return {
    orders:Number(orders?.order_count)||0,
    unrecognizedPipelineValue:Number(orders?.pipeline_not_verified_revenue)||0,
    unverifiedCollectedOrdersByOrderDate:Number(orders?.unknown_collected_amounts)||0,
    missingSaleCostSnapshots:Number(orders?.sale_missing_cost_snapshot)||0,
    inventoryPurchasesExpensed:Number(manual?.inventory_purchases_expensed)||0,
    manualAdExpense:Number(manual?.manually_recorded_ad_cost)||0,
    unreversedManagementFees:Number(wrongFees?.n)||0,
    interpretation:'risk_flags_only_not_a_statutory_audit'
  };
}
async function journals(env,{clientId,storeId,from,to}){
  const filter=storeId?' AND store_id=?':'',args=storeId?[clientId,storeId,from,to,100]:[clientId,from,to,100];
  try{const q=await env.DB.prepare(`SELECT id,store_id storeId,entry_date entryDate,currency,source_type sourceType,description,reversal_of reversalOf,created_by createdBy,created_at createdAt FROM faos_journals WHERE client_id=?${filter} AND entry_date BETWEEN ? AND ? ORDER BY entry_date DESC,created_at DESC LIMIT ?`).bind(...args).all();return q.results||[];}catch(error){dbFailure(error)}
}
async function ensureOpen(env,clientId,storeId,date){
  let row;
  try{row=await env.DB.prepare('SELECT status FROM faos_periods WHERE client_id=? AND store_id=? AND period_month=?').bind(clientId,storeId,date.slice(0,7)).first()}catch(error){dbFailure(error)}
  if(row?.status==='closed')fail('الفترة المحاسبية مقفولة؛ يجب فتحها بصلاحية معتمدة',409,'FAOS_PERIOD_CLOSED');
}
// A repeated idempotency key is safe only when the entire economic payload matches.
// Never acknowledge a modified amount/account/date as a successful retry.
async function replayOf(env,{clientId,storeId,date,currency,description,sourceType,sourceKey,reversalOf,lines}){
  let old;
  try{old=await env.DB.prepare(`SELECT id,store_id storeId,entry_date entryDate,currency,description,reversal_of reversalOf,status
    FROM faos_journals WHERE client_id=? AND source_type=? AND source_key=?`).bind(clientId,sourceType,sourceKey).first();}
  catch(error){dbFailure(error)}
  if(!old)return null;
  if(old.status!=='posted')fail('القيد السابق لم يُرحّل بالكامل',409,'FAOS_DRAFT_CONFLICT');
  if(old.storeId!==storeId)fail('معرف العملية مستخدم في متجر مختلف',409,'FAOS_IDEMPOTENCY_CONFLICT');
  const stored=await env.DB.prepare(`SELECT account_code accountCode,debit_minor debitMinor,credit_minor creditMinor,memo
    FROM faos_journal_lines WHERE client_id=? AND store_id=? AND journal_id=? ORDER BY rowid`).bind(clientId,storeId,old.id).all();
  const current=lines.map(({accountCode,debitMinor,creditMinor,memo})=>[accountCode,debitMinor,creditMinor,memo||'']);
  const previous=(stored.results||[]).map(({accountCode,debitMinor,creditMinor,memo})=>[accountCode,Number(debitMinor),Number(creditMinor),memo||'']);
  if(old.entryDate!==date||old.currency!==currency||old.description!==description||(old.reversalOf||null)!==(reversalOf||null)||JSON.stringify(current)!==JSON.stringify(previous))
    fail('تم استخدام معرف العملية سابقًا ببيانات مختلفة',409,'FAOS_IDEMPOTENCY_PAYLOAD_MISMATCH');
  return {ok:true,id:old.id,deduplicated:true};
}
async function writeJournal(env,{clientId,storeId,date,currency,description,sourceType,sourceKey,rows,actor,reversalOf=null}){
  if(!iso.test(date)||Number.isNaN(Date.parse(date+'T12:00:00Z')))fail('التاريخ غير صحيح');
  if(currency!=='EGP')fail('هذا الإصدار يدعم ترحيل القيود بالجنيه المصري فقط حتى اعتماد دفتر العملات',400,'FAOS_CURRENCY_NOT_SUPPORTED');
  if(!sourceKey||sourceKey.length<8||sourceKey.length>120)fail('معرف العملية مطلوب لمنع التكرار');
  const store=await env.DB.prepare('SELECT currency FROM stores WHERE client_id=? AND id=? AND status=\'active\'').bind(clientId,storeId).first();
  if(!store)fail('المتجر غير موجود أو غير نشط',403,'STORE_SCOPE_INVALID');
  if(clean(store.currency||'EGP')!==currency)fail('عملة القيد لا تطابق العملة الأساسية للمتجر',400,'FAOS_CURRENCY_MISMATCH');
  let lines;try{lines=normalizeLines(rows).lines}catch(error){fail(error.message,400,error.message)}
  const identity={clientId,storeId,date,currency,description,sourceType,sourceKey,reversalOf,lines};
  const previouslyPosted=await replayOf(env,identity);
  if(previouslyPosted)return previouslyPosted;
  await ensureOpen(env,clientId,storeId,date);
  const id='FAOS-'+crypto.randomUUID(),createdAt=new Date().toISOString();
  const operations=[env.DB.prepare('INSERT INTO faos_journals (id,client_id,store_id,entry_date,currency,source_type,source_key,description,status,reversal_of,created_by,created_at) VALUES (?,?,?,?,?,?,?,? ,\'draft\',?,?,?)').bind(id,clientId,storeId,date,currency,sourceType,sourceKey,description,reversalOf,actor,createdAt)];
  for(const row of lines){operations.push(env.DB.prepare('INSERT INTO faos_journal_lines(id,journal_id,client_id,store_id,account_code,debit_minor,credit_minor,memo) VALUES (?,?,?,?,?,?,?,?)').bind('FAL-'+crypto.randomUUID(),id,clientId,storeId,row.accountCode,row.debitMinor,row.creditMinor,row.memo));}
  operations.push(env.DB.prepare("UPDATE faos_journals SET status='posted' WHERE id=? AND client_id=? AND store_id=? AND status='draft'").bind(id,clientId,storeId));
  try{await env.DB.batch(operations);}
  catch(error){
    if(/UNIQUE constraint failed: faos_journals.client_id|faos_journals.client_id, faos_journals.source_type|constraint failed.*source_key/i.test(String(error?.message||''))){
      const committed=await replayOf(env,identity);
      if(committed)return committed;
    }dbFailure(error);
  }
  return {ok:true,id,deduplicated:false};
}
export async function handleFinancialAccountingOS({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  if(!path.startsWith('/api/accounting/faos/'))return null;
  try{
    const me=await meFor(request,env,ctx,delegate);
    requirePermission(me,'finance',method==='GET'?'read':'write');
    if(method==='GET'&&path==='/api/accounting/faos/catalog')return respond({ok:true,accounts:ACCOUNTS});
    if(method==='GET'&&path==='/api/accounting/faos/simulation'){
      // no D1 changes under any environment, intentionally mock-only.
      return respond({ok:true,...syntheticCommerceScenario()});
    }
    const body=method==='POST'?await request.json().catch(()=>({})):{};
    const scope=await scopeFor(request,env,me,body,method!=='GET');
    // Safety gate: never allow live financial mutation until separate signed-off
    // Preview rollout explicitly opts in. Production remains read-only.
    if(method!=='GET' && (env.APP_ENV!=='preview'||env.FAOS_WRITE_ENABLED!=='1'))
      fail('الترحيل المالي التجريبي مغلق حتى اعتماد بيئة Preview',403,'FAOS_WRITE_DISABLED');
    if(method==='GET'&&path==='/api/accounting/faos/overview'){
      const range=period(url);
      const [ledger,legacy,latest,quality]=await Promise.all([
        faosLedgerBalance(env,{...scope,...range}),
        accountingOverview(env,{...scope,...range}),
        journals(env,{...scope,...range}),
        operationalQuality(env,{...scope,...range})
      ]);
      // Collection-date and order-date metrics are deliberately distinct.
      quality.unverifiedCollectedOrders=Number(legacy.unverifiedCollectedOrders)||0;
      const warnings=[];
      if(quality.unverifiedCollectedOrders>0)warnings.push({code:'UNVERIFIED_COD',severity:'high',count:quality.unverifiedCollectedOrders,text:'توجد طلبات معلمة كمحصلة بدون مبلغ تحصيل مؤكّد؛ لا يجوز اعتبار قيمتها نقدًا محصلًا'});
      if(quality.unrecognizedPipelineValue>0)warnings.push({code:'PIPELINE_NOT_REVENUE',severity:'high',count:quality.unrecognizedPipelineValue,text:'قيمة طلبات مؤكدة/تجهيز/شحن لا تثبت بمفردها إيرادًا مُعترفًا به'});
      if(quality.missingSaleCostSnapshots>0)warnings.push({code:'MISSING_ORDER_COST',severity:'high',count:quality.missingSaleCostSnapshots,text:'طلبات تم تسليمها دون تكلفة منتج مثبتة داخل سجل الطلب؛ يلزم مطابقة تكلفة المخزون'});
      if(quality.inventoryPurchasesExpensed>0)warnings.push({code:'INVENTORY_EXPENSE_RISK',severity:'high',count:quality.inventoryPurchasesExpensed,text:'مشتريات مخزون مسجلة في المصروفات؛ راجع مخاطر الازدواج مع تكلفة البضاعة المباعة'});
      if(quality.unreversedManagementFees>0)warnings.push({code:'UNREVERSED_MANAGEMENT_FEES',severity:'high',count:quality.unreversedManagementFees,text:'رسوم إدارة نشطة على طلبات ملغاة أو مرتجعة وتحتاج مطابقة'});
      if(quality.manualAdExpense>0)warnings.push({code:'MANUAL_AD_RISK',severity:'medium',count:quality.manualAdExpense,text:'إنفاق إعلاني يدوي قد يتكرر مع صرف Meta المستورد؛ يلزم مطابقة مصدر الحملة والبنك'});
      warnings.push({code:'PARALLEL_LEDGER',text:'دفتر FAOS الجديد مستقل حاليًا عن الطلبات والمحفظة القديمة؛ لا يمكن اعتماد ميزانه كقوائم نهائية قبل ترحيل الأحداث والمطابقة'});
      return respond({ok:true,scope,period:range,capabilities:{financialPostingEnabled:env.APP_ENV==='preview'&&env.FAOS_WRITE_ENABLED==='1',operationalAutoPostingEnabled:false,environment:env.APP_ENV==='preview'?'preview':'read_only'},legacy,ledger,quality,reconciliation:reconcileAccountingSources({legacy,ledger,quality}),journals:latest,warnings});
    }
    if(method==='POST'&&path==='/api/accounting/faos/journals'){
      const desc=clean(body.description,500),date=clean(body.date),currency=clean(body.currency||'EGP'),key=clean(body.idempotencyKey,120);
      if(desc.length<3)fail('اكتب بيانًا واضحًا للقيد');
      const result=await writeJournal(env,{...scope,date,currency,description:desc,sourceType:'manual',sourceKey:key,rows:body.lines,actor:clean(me.email||me.uid||me.role,200)});
      return respond(result,result.deduplicated?200:201);
    }
    if(method==='POST'&&path==='/api/accounting/faos/reverse'){
      const originalId=clean(body.journalId,100);
      let row;
      try{row=await env.DB.prepare('SELECT * FROM faos_journals WHERE id=? AND client_id=? AND store_id=?').bind(originalId,scope.clientId,scope.storeId).first()}catch(error){dbFailure(error)}
      if(!row)fail('القيد غير موجود في المتجر',404,'FAOS_JOURNAL_NOT_FOUND');
      if(row.source_type==='reversal')fail('لا يمكن عكس قيد عكسي آليًا',409);
      const original=await env.DB.prepare('SELECT account_code accountCode,debit_minor debitMinor,credit_minor creditMinor FROM faos_journal_lines WHERE client_id=? AND store_id=? AND journal_id=?').bind(scope.clientId,scope.storeId,originalId).all();
      const lines=(original.results||[]).map(l=>({accountCode:l.accountCode,debit:Number(l.creditMinor)/100,credit:Number(l.debitMinor)/100}));
      const date=clean(body.date)||new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const outcome=await writeJournal(env,{...scope,date,currency:row.currency,description:'عكس القيد '+originalId,sourceType:'reversal',sourceKey:'reversal:'+originalId,rows:lines,reversalOf:originalId,actor:clean(me.email||me.uid||me.role,200)});
      return respond(outcome,outcome.deduplicated?200:201);
    }
    return respond({error:'المسار غير مدعوم',code:'FAOS_NOT_FOUND'},404);
  }catch(error){return respond({error:error?.message||'حدث خطأ في نظام الحسابات',code:error?.code||'FAOS_ERROR'},Number(error?.status)||500);}
}
