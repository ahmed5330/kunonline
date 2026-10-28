import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {accountingOverview,listManagementFeeEntries} from '../src/accounting.js';
import {collectedProfitOverview} from '../src/collected-profit.js';
import {computeDashboardSnapshot} from '../src/dashboard-intelligence.js';

// Real SQL executed with an isolated in-memory replica of the financial
// tables. No network/database credentials and no user records are involved.
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT,name TEXT,currency TEXT,management_fee_pct REAL);
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,collected_amount REAL,collected_at TEXT,product_cost REAL,ref TEXT,name TEXT);
CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT);
CREATE TABLE order_management_fees(order_id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,rate_pct REAL,base_amount REAL,amount REAL,status TEXT,activated_at TEXT,reversed_at TEXT,updated_at TEXT);
CREATE TABLE transactions(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,type TEXT,date TEXT,created_at TEXT,category TEXT,amount REAL,note TEXT,method TEXT,counterparty TEXT);
CREATE TABLE campaign_daily_metrics(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,metric_date TEXT,spend REAL);
`);
const stmt=(sql,args)=>db.prepare(sql).run(...args);
stmt('INSERT INTO stores VALUES(?,?,?,?,?)',['store','client','اختبار مالية','EGP',5]);
const addOrder=(id,date,state,total,collected,collectedAt,cost)=>stmt(
 'INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
 [id,'client','store',date,date+'T11:00:00Z',state,total,collected,collectedAt,cost,id,'عميل تجريبي']
);
addOrder('COD-1','2026-09-25','collected',1000,870,'2026-10-11',400);
addOrder('COD-DUP','2026-09-25','collected',1000,870,'2026-10-11',400);
addOrder('COD-2','2026-10-11','collected',500,null,'2026-10-11',0);
addOrder('OPEN-1','2026-10-11','shipped',600,null,null,200);
stmt('INSERT INTO order_duplicate_links VALUES(?,?)',['COD-DUP','COD-1']);
stmt("INSERT INTO order_management_fees VALUES(?,?,?,?,?,?,?,NULL,NULL,?)",['COD-1','client','store',5,1000,50,'active','2026-09-25T12:00:00Z']);
stmt("INSERT INTO order_management_fees VALUES(?,?,?,?,?,?,?,NULL,NULL,?)",['COD-DUP','client','store',5,1000,50,'active','2026-09-25T12:00:00Z']);
for(const [id,cat,amt] of [['GEN','إيجار',30],['ADS','Meta Ads',20]])
 stmt("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)",[id,'client','store','expense','2026-10-11','2026-10-11T09:00:00Z',cat,amt,'تجريبي','bank','QA']);
stmt('INSERT INTO campaign_daily_metrics VALUES(?,?,?,?,?)',['MET-1','client','store','2026-10-11',100]);
class Statement{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}first(){return Promise.resolve(db.prepare(this.sql).get(...this.args)||null)}all(){return Promise.resolve({results:db.prepare(this.sql).all(...this.args)})}}
const env={DB:{prepare:sql=>new Statement(sql)}};
const oct={clientId:'client',storeId:'store',from:'2026-10-11',to:'2026-10-11'};
const overview=await accountingOverview(env,oct);
assert.equal(overview.collectedRevenue,1370,'cash must use COD amount rather than original 1500 EGP orders');
assert.equal(overview.verifiedCollectedRevenue,870,'only explicit COD collected_amount is verified in Accounts');
assert.equal(overview.estimatedCollectedRevenue,500,'missing COD amount still tracked as fallback for legacy reconciliation');
assert.equal(overview.verifiedNetCash,820,'verified COD + income - expenses excludes fallback values');
assert.equal(overview.netCashIncludesEstimatedCOD,true,'account net cash is not a verified bank or settlement balance');
assert.equal(overview.collectionBasis,'settlement_date_with_estimated_order_total_fallback');
assert.equal(overview.collectedOrders,2,'linked duplicate must not inflate settled order count');
assert.equal(overview.unverifiedCollectedOrders,1,'historical collected order without explicit amount must be flagged');
assert.equal(overview.deliveredRevenue,500,'operating sales must use order date, not collection date');
assert.equal(overview.manualExpenses,50,'accounting must include real registered expenses');
assert.equal(overview.managementFees,0,'fee on September order is not an October shipping expense');
assert.equal(overview.netCash,1320,'registered cash estimate must use actual collection and booked expenses');
const sep=await accountingOverview(env,{...oct,from:'2026-09-25',to:'2026-09-25'});
assert.equal(sep.collectedRevenue,0,'September sales cannot show October COD');
assert.equal(sep.verifiedCollectedRevenue,0);
assert.equal(sep.estimatedCollectedRevenue,0);
assert.equal(sep.netCashIncludesEstimatedCOD,false);
assert.equal(sep.deliveredRevenue,1000,'linked duplicate excluded from order-date sales');
assert.equal(sep.managementFees,50,'duplicate linked order management fee cannot inflate expenses');
assert.equal(sep.netCash,0,'accrued management fee on prior orders is not evidence of cash paid');
assert.equal(sep.accruedManagementFeesExcludedFromCash,50);
const feesDetail=await listManagementFeeEntries(env,{...oct,from:'2026-09-25',to:'2026-09-25'});
assert.equal(feesDetail.length,1,'visible management-fee detail rows must be as deduplicated as the dashboard and accounting fee totals');
assert.equal(feesDetail[0].amount,50);

const collected=await collectedProfitOverview(env,{...oct,includeDetails:true});
assert.equal(collected.collectedGross,1370,'collection report must agree with accounting settlement cash');
assert.equal(collected.verifiedCollectedGross,870,'only collected_amount is a recorded COD amount');
assert.equal(collected.unverifiedCollectionFallbackGross,500,'missing COD amount is not verified cash');
assert.equal(collected.missingCollectionAmountOrders,1);
assert.equal(collected.collectionQuality,'partially_estimated_from_order_total');
assert.equal(collected.collectedProfitIsFullyVerified,false,'unreconciled COD and shipping disallow verified-profit status');
assert.equal(collected.orders.find(x=>x.id==='COD-2').collectionAmountEstimated,true);

assert.equal(collected.collectedOrders,2,'collection report must exclude linked duplicate');
assert.equal(collected.productCost,400,'recorded order inventory cost must be deducted from collected margin');
assert.equal(collected.managementFees,50,'collection margin subtracts active management fees for collected orders');
assert.equal(collected.adSpend,100,'integrated ads override manually-entered duplicate ad line');
assert.equal(collected.generalExpenses,30,'general expenses use collection-date reporting window');
assert.equal(collected.periodExpenses,130);
assert.equal(collected.collectedProfit,790,'1370 cash - 400 COGS - 50 management - 130 period expenses');
assert.equal(collected.missingProductCostOrders,1,'missing historical cost must be flagged, not claimed complete');
assert.equal(collected.profitCompleteness,'partial_missing_order_cost');
assert.equal(collected.expenses.from,'2026-10-11');
assert.equal(collected.expenses.to,'2026-10-11');

const day='2026-10-11';
const orders=[
 {id:'OPEN-1',date:day,state:'shipped',total:600,product_cost:200,shipping_cost:20,other_cost:5,source:'manual'},
 {id:'PENDING-1',date:day,state:'pending',total:250,product_cost:90,shipping_cost:0,other_cost:0,source:'easyorders'},
];
const report=computeDashboardSnapshot({
 orders,historyOrders:orders,transactions:[
  {date:day,category:'Meta Ads',amount:20},{date:day,category:'إيجار',amount:30}
 ],
 billingRows:[{order_id:'OPEN-1',fee:150,status:'pending_insufficient'},
              {order_id:'PENDING-1',fee:150,status:'failed'}],
 dailyAds:[{metric_date:day,spend:100}],
 marketing:{total:{spend:400,confirmedOrders:1,deliveredOrders:0},campaigns:[]},
 products:[],from:day,to:day,today:day
});
assert.equal(report.overview.adSpend,100,'dashboard must prefer date-scoped integrated daily ad spend rather than mismatched campaign sum');
assert.equal(report.ads.spend,100);
assert.equal(report.trend.points[0].adSpend,100,'daily trend should reconcile to dashboard headline');
assert.equal(report.finance.expenseBreakdown.admin,0,'unpaid wallet obligations are NOT expense or cash deductions');
assert.equal(report.overview.activeProductCost,200);
assert.equal(report.overview.expectedProfit,375,'600-200 COGS-20 direct shipping-5 other, before overhead');
assert.equal(report.overview.expectedProfitPerActiveOrder,375);
assert.equal(report.finance.netProfit,405,'850 revenue - 290 COGS - 100 ads - 30 rent - 20 ship - 5 order costs');
console.log('Financial reconciliation SQL QA PASS: settlement dates, actual COD, duplicate fees, COGS, pending wallets, ad-spend chart');
// Legacy blank dates must agree across accounting and collected-profit reports.
const dates={clientId:'dates-client',storeId:'dates-store',from:'2026-10-28',to:'2026-10-28'};
stmt('INSERT INTO stores VALUES(?,?,?,?,?)',['dates-store','dates-client','Dates fixture','EGP',5]);
for(const [i,date] of [null,'','   '].entries()){
  stmt('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[
    `DATE-${i}`,'dates-client','dates-store',date,'2026-10-28T10:00:00Z','collected',100,90,date,30,`DATE-${i}`,'Synthetic'
  ]);
  stmt('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)',[
    `TX-DATE-${i}`,'dates-client','dates-store','expense',date,'2026-10-28T10:00:00Z','Rent',10,'Synthetic','bank','QA'
  ]);
  stmt('INSERT INTO order_management_fees VALUES(?,?,?,?,?,?,?,?,?,?)',[
    `DATE-${i}`,'dates-client','dates-store',5,100,5,'active','2026-10-28',null,'2026-10-28'
  ]);
}
const missingDates=await accountingOverview(env,dates);
assert.equal(missingDates.manualExpenses,30,'null, empty and spaces use creation date in finance');
assert.equal(missingDates.deliveredRevenue,300);
assert.equal(missingDates.managementFees,15);
assert.equal(missingDates.collectedRevenue,270,'blank settlement dates fall back without changing recorded COD amounts');
assert.equal(missingDates.verifiedCollectedRevenue,270);
const missingCollected=await collectedProfitOverview(env,{...dates,includeDetails:true});
assert.equal(missingCollected.collectedOrders,3);
assert.equal(missingCollected.generalExpenses,30);
assert.equal(missingCollected.collectedProfit,135);
assert.equal((await listManagementFeeEntries(env,dates)).length,3);
stmt('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[
  'EXPLICIT-OLD','dates-client','dates-store','2026-09-01','2026-10-28T10:00:00Z','signed',999,null,null,1,'OLD','Synthetic'
]);
stmt('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)',[
  'EXPLICIT-TX','dates-client','dates-store','expense','2026-09-01','2026-10-28T10:00:00Z','Rent',999,'Synthetic','bank','QA'
]);
assert.equal((await accountingOverview(env,dates)).deliveredRevenue,300,'explicit old order date beats recent creation date');
assert.equal((await accountingOverview(env,dates)).manualExpenses,30,'explicit transaction date keeps its original period');
assert.equal((await accountingOverview(env,{...dates,storeId:'other-store'})).collectedRevenue,0,'other store never receives these collections');
assert.equal((await accountingOverview(env,{...dates,clientId:'other-client'})).manualExpenses,0,'other client never receives these expenses');
console.log('Blank-date financial SQL PASS: accounting, COD, profit, fees, explicit-date precedence and store/client isolation.');
for(const field of ['shipping_cost','other_cost','gov','source','customer_id','product_id','qty'])db.exec(`ALTER TABLE orders ADD COLUMN ${field}`);
const actualQueries=file=>[...readFileSync(new URL('../src/'+file,import.meta.url),'utf8').matchAll(/env\.DB\.prepare\(`(SELECT[\s\S]*?)`\)/g)].map(m=>m[1]);
const binds=['dates-client','dates-store','2026-10-28','2026-10-28'];
const dashboardQueries=actualQueries('dashboard-intelligence.js').filter(q=>q.includes('FROM orders WHERE'));
assert.equal(dashboardQueries.length,2);
const dashboardOrders=dashboardQueries.map(sql=>db.prepare(sql.replaceAll('${storeClause}',' AND store_id=?')).all(...binds));
for(const rows of dashboardOrders)assert.equal(rows.length,3,'selected and 30-day dashboard SQL includes blanks, excludes explicit older dates');
const snapshot=computeDashboardSnapshot({orders:dashboardOrders[0],historyOrders:dashboardOrders[1],from:dates.from,to:dates.to,today:dates.to});
assert.equal(snapshot.rates.selected.total,3,'JS rate calculation agrees with actual SQL after whitespace fallback');
assert.equal(snapshot.rates.d30.total,3);
const briefQueries=actualQueries('business-intelligence.js');
const briefOrders=briefQueries.find(q=>q.includes('FROM orders WHERE'));
assert.equal(db.prepare(briefOrders.replaceAll('${storeSql}',' AND store_id=?')).get(...binds).total,3);
const briefFinance=briefQueries.find(q=>q.includes('FROM transactions WHERE'));
assert.equal(db.prepare(briefFinance.replaceAll('${storeSql}',' AND store_id=?')).get(...binds).expenses,30);
console.log('Blank-date dashboard and business brief SQL PASS: selected/30-day totals and finance agree.');
db.close();
