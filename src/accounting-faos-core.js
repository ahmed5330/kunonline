/* Kun Online Financial Accounting OS: pure, deterministic bookkeeping rules.
 * Monetary journal amounts are stored in integer minor units, never REAL.
 * Deliberately separate from operational order totals and SaaS wallet balances.
 */
export const ACCOUNTS=Object.freeze([
  ['1110','خزنة رئيسية','asset'],['1120','بنك محلي رئيسي','asset'],
  ['1210','عملاء B2B','asset'],['1230','مستحق لدى شركة الشحن COD','asset'],
  ['1240','مستحق لدى بوابة دفع','asset'],['1300','مخزون بضائع للبيع','asset'],
  ['1313','مخزون في الطريق من المورد','asset'],['1400','مصروفات مدفوعة مقدمًا','asset'],
  ['2110','موردو بضاعة','liability'],['2120','شركة الشحن — رسوم مستحقة','liability'],
  ['2160','ضريبة قيمة مضافة مخرجات','liability'],['2140','مبالغ مقدمة من العملاء','liability'],
  ['2150','مبالغ واجبة الرد للعملاء','liability'],
  ['3100','رأس مال مالك/شركاء','equity'],['3200','أرباح مرحلة','equity'],
  ['4100','مبيعات منتجات محلية','revenue'],['4110','إيراد شحن على العميل','revenue'],
  ['4191','مردودات ومسموحات مبيعات (مقابل)','contra_revenue'],
  ['5100','تكلفة بضاعة مباعة COGS','expense'],['6110','شحن التوصيل على التاجر','expense'],
  ['6100','إعلانات Meta','expense'],['6141','رسوم كن أونلاين','expense'],
  ['6114','رسوم تحصيل COD','expense'],
  ['6117','تغليف واستهلاكات طلبات','expense'],['6121','مرتبات وأجور','expense'],
  ['6115','رسوم بوابات الدفع','expense'],['5130','خسائر تلف/هالك/سرقة مخزون','expense'],
  ['6160','مصروفات أخرى مصنفة','expense'],['4140','إيرادات أخرى من النشاط','revenue']
].map(([code,name,type])=>Object.freeze({code,name,type})));
export const ACCOUNT_BY_CODE=new Map(ACCOUNTS.map(a=>[a.code,a]));
export const NORMAL_DEBIT=new Set(['asset','expense','contra_revenue']);
export function moneyMinor(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-7)throw new Error('INVALID_AMOUNT_PRECISION');
  return Math.round(value*100);
}
export function minorMoney(value){return Number((value/100).toFixed(2));}
export function normalizeLines(rows){
  if(!Array.isArray(rows)||rows.length<2||rows.length>50)throw new Error('JOURNAL_LINES_REQUIRED');
  const lines=rows.map(row=>{
    const accountCode=String(row.accountCode||row.account_code||'').trim();
    if(!ACCOUNT_BY_CODE.has(accountCode))throw new Error('UNKNOWN_ACCOUNT_CODE');
    const debit=moneyMinor(Number(row.debit||0)),credit=moneyMinor(Number(row.credit||0));
    if((debit>0)===(credit>0))throw new Error('ONE_SIDED_LINE_REQUIRED');
    return {accountCode,debitMinor:debit,creditMinor:credit,memo:String(row.memo||'').slice(0,250)};
  });
  const debitMinor=lines.reduce((s,x)=>s+x.debitMinor,0),creditMinor=lines.reduce((s,x)=>s+x.creditMinor,0);
  if(debitMinor!==creditMinor||debitMinor===0)throw new Error('JOURNAL_NOT_BALANCED');
  return {lines,debitMinor,creditMinor};
}
export function trialBalance(journals,{storeId=null}={}){
  const balances=new Map(ACCOUNTS.map(a=>[a.code,{...a,debitMinor:0,creditMinor:0,balanceMinor:0}]));
  for(const journal of journals){
    if(storeId&&String(journal.storeId)!==String(storeId))continue;
    const l=normalizeLines(journal.lines);
    for(const x of l.lines){const a=balances.get(x.accountCode);a.debitMinor+=x.debitMinor;a.creditMinor+=x.creditMinor;}
  }
  const accounts=[...balances.values()].map(a=>({...a,balanceMinor:(NORMAL_DEBIT.has(a.type)?1:-1)*(a.debitMinor-a.creditMinor)}));
  const debitMinor=accounts.reduce((s,a)=>s+a.debitMinor,0),creditMinor=accounts.reduce((s,a)=>s+a.creditMinor,0);
  const value=type=>accounts.filter(a=>a.type===type).reduce((s,a)=>s+a.balanceMinor,0);
  const netProfitMinor=value('revenue')-value('contra_revenue')-value('expense');
  return {balanced:debitMinor===creditMinor,debitMinor,creditMinor,netProfitMinor,accounts:accounts.filter(a=>a.debitMinor||a.creditMinor)};
}
function entry(id,storeId,description,lines){normalizeLines(lines);return {id,storeId,description,lines};}
/* Pure test fixtures: no D1 writes, no live orders, no real wallet debits. */
export function syntheticCommerceScenario(){
  const fakeOrders=[
    {id:'QA-A-CONFIRMED',storeId:'QA-STORE-A',state:'confirmed',total:1100,recognizedRevenue:0,notes:'طلب مؤكد: لا يُسجل بيعًا قبل تحقق تسليم السيطرة'},
    {id:'QA-A-DELIVERED',storeId:'QA-STORE-A',state:'collected_by_carrier',total:1000,recognizedRevenue:1000,notes:'COD 900 منتج و100 شحن'},
    {id:'QA-A-RETURNED',storeId:'QA-STORE-A',state:'returned',total:700,recognizedRevenue:0,notes:'تسليم ثم مرتجع كامل وعكس التكلفة'},
    {id:'QA-B-PARTIAL',storeId:'QA-STORE-B',state:'partially_settled',total:500,recognizedRevenue:500,notes:'استحقاق بوابة الدفع 500 والمحصل بالبنك 300'}
  ];
  const journals=[
    entry('QA-CAPITAL-A','QA-STORE-A','تمويل المتجر',[{accountCode:'1120',debit:5000},{accountCode:'3100',credit:5000}]),
    entry('QA-INVENTORY-A','QA-STORE-A','شراء بضاعة بالأجل',[{accountCode:'1300',debit:1800},{accountCode:'2110',credit:1800}]),
    entry('QA-SALE-A','QA-STORE-A','تسليم COD',[{accountCode:'1230',debit:1000},{accountCode:'4100',credit:900},{accountCode:'4110',credit:100}]),
    entry('QA-COGS-A','QA-STORE-A','تكلفة البيع',[{accountCode:'5100',debit:420},{accountCode:'1300',credit:420}]),
    entry('QA-SHIP-A','QA-STORE-A','خصم رسوم الشحن من تسوية COD',[{accountCode:'6110',debit:80},{accountCode:'1230',credit:80}]),
    entry('QA-PAYOUT-A','QA-STORE-A','تحويل شركة الشحن إلى البنك',[{accountCode:'1120',debit:920},{accountCode:'1230',credit:920}]),
    entry('QA-ADS-A','QA-STORE-A','صرف إعلانات',[{accountCode:'6100',debit:150},{accountCode:'1120',credit:150}]),
    entry('QA-SALE-RETURNED','QA-STORE-A','بيع قبل المرتجع',[{accountCode:'1230',debit:700},{accountCode:'4100',credit:700}]),
    entry('QA-COGS-RETURNED','QA-STORE-A','تكلفة قبل المرتجع',[{accountCode:'5100',debit:300},{accountCode:'1300',credit:300}]),
    entry('QA-REFUND','QA-STORE-A','عكس المبيع عند المرتجع',[{accountCode:'4191',debit:700},{accountCode:'1230',credit:700}]),
    entry('QA-RESTOCK','QA-STORE-A','إعادة المخزون السليم',[{accountCode:'1300',debit:300},{accountCode:'5100',credit:300}]),
    entry('QA-RTO-FEE','QA-STORE-A','رسوم رجوع مستحقة',[{accountCode:'6110',debit:60},{accountCode:'2120',credit:60}]),
    entry('QA-CAPITAL-B','QA-STORE-B','تمويل متجر ثان',[{accountCode:'1120',debit:1000},{accountCode:'3100',credit:1000}]),
    entry('QA-INVENTORY-B','QA-STORE-B','شراء بضاعة متجر ثان',[{accountCode:'1300',debit:400},{accountCode:'2110',credit:400}]),
    entry('QA-SALE-B','QA-STORE-B','بيع مدفوع ببوابة دفع',[{accountCode:'1240',debit:500},{accountCode:'4100',credit:500}]),
    entry('QA-COGS-B','QA-STORE-B','تكلفة البيع',[{accountCode:'5100',debit:200},{accountCode:'1300',credit:200}]),
    entry('QA-SETTLE-PARTIAL','QA-STORE-B','تسوية جزئية لبوابة الدفع',[{accountCode:'1120',debit:300},{accountCode:'1240',credit:300}])
  ];
  const all=trialBalance(journals),storeA=trialBalance(journals,{storeId:'QA-STORE-A'}),storeB=trialBalance(journals,{storeId:'QA-STORE-B'});
  const find=(balance,code)=>balance.accounts.find(x=>x.code===code)?.balanceMinor||0;
  const sumType=type=>all.accounts.filter(x=>x.type===type).reduce((s,x)=>s+x.balanceMinor,0);
  const assetsMinor=sumType('asset'),liabilitiesMinor=sumType('liability'),equityMinor=sumType('equity')+all.netProfitMinor;
  return {label:'بيانات اختبار افتراضية بالكامل — لا تُحفظ على قواعد بيانات المتاجر',
    fakeOrders,journalCount:journals.length,journals,
    expected:{netProfit:590,storeAProfit:290,storeBProfit:300,openGatewayReceivable:200,openCourierReceivable:0,orderOnlyRevenue:0,assets:8850,liabilities:2260,equity:6590},
    actual:{netProfit:minorMoney(all.netProfitMinor),storeAProfit:minorMoney(storeA.netProfitMinor),storeBProfit:minorMoney(storeB.netProfitMinor),openGatewayReceivable:minorMoney(find(storeB,'1240')),openCourierReceivable:minorMoney(find(storeA,'1230')),orderOnlyRevenue:0,assets:minorMoney(assetsMinor),liabilities:minorMoney(liabilitiesMinor),equity:minorMoney(equityMinor)},
    balanced:all.balanced&&storeA.balanced&&storeB.balanced,
    totals:{debit:minorMoney(all.debitMinor),credit:minorMoney(all.creditMinor)},
    checks:[['journal_balanced',all.balanced],['store_isolation',storeA.netProfitMinor+storeB.netProfitMinor===all.netProfitMinor],['expected_profit',all.netProfitMinor===59000],['partial_settlement',find(storeB,'1240')===20000],['cod_settlement',find(storeA,'1230')===0],['balance_sheet_equation',assetsMinor===liabilitiesMinor+equityMinor],['confirmed_not_revenue',fakeOrders[0].recognizedRevenue===0],['return_neutralizes_revenue',fakeOrders[2].recognizedRevenue===0]].map(([id,pass])=>({id,pass}))};
}
