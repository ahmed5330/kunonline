import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {dashboardData} from '../src/dashboard-intelligence.js';
import {reconcileMonthlyShippingTotals} from '../src/production-finance-presentation.js';

// SQL-level reconciliation, with tenant/store isolation and linked order duplicates.
// Uses only synthetic records in a local in-memory database (no production reads).
const db=new DatabaseSync(':memory:');
db.exec(`
 CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT,currency TEXT);
 CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,product_cost REAL,shipping_cost REAL,other_cost REAL,gov TEXT,source TEXT,customer_id TEXT,product_id TEXT,qty REAL);
 CREATE TABLE order_duplicate_links(duplicate_order_id TEXT PRIMARY KEY,canonical_order_id TEXT);
 CREATE TABLE transactions(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,type TEXT,date TEXT,created_at TEXT,category TEXT,amount REAL,note TEXT);
 CREATE TABLE order_billing(order_id TEXT PRIMARY KEY,client_id TEXT,fee REAL,status TEXT);
 CREATE TABLE products(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,cost REAL);
 CREATE TABLE campaign_daily_metrics(id TEXT PRIMARY KEY,campaign_id TEXT,client_id TEXT,store_id TEXT,metric_date TEXT,spend REAL,impressions REAL,reach REAL,clicks REAL,leads REAL,platform_purchases REAL,conversions REAL,platform_purchase_value REAL,revenue REAL);
 CREATE TABLE marketing_campaigns(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,platform TEXT,external_campaign_id TEXT,name TEXT,objective TEXT,status TEXT,currency TEXT,budget REAL,updated_at TEXT);
 CREATE TABLE order_attribution(order_id TEXT,client_id TEXT,campaign_id TEXT);
 CREATE TABLE ai_insight_snapshots(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,insight_type TEXT,severity TEXT,title TEXT,rationale TEXT,metric_json TEXT,suggested_payload_json TEXT,generated_at TEXT,status TEXT);
`);
const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const v=k=>d.find(p=>p.type===k)?.value||'';
const day=`${v('year')}-${v('month')}-${v('day')}`;
const run=(sql,...args)=>db.prepare(sql).run(...args);
run('INSERT INTO stores VALUES(?,?,?)','store','client','EGP');
run('INSERT INTO stores VALUES(?,?,?)','store2','other','EGP');
for(const [id,client,store,state,total,cost,source,customer] of [
 ['CANON','client','store','confirmed',500,120,'easyorders','C1'],
 ['DUP','client','store','confirmed',500,120,'easyorders','C1'],
 ['MANUAL','client','store','collected',300,80,'manual','C2'],
 ['OTHER','other','store2','confirmed',2000,200,'manual','C3']
]){
 run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,client,store,day,day+'T09:00:00Z',state,total,cost,0,0,'القاهرة',source,customer,null,1);
}
run('INSERT INTO order_duplicate_links VALUES(?,?)','DUP','CANON');
run('INSERT INTO marketing_campaigns VALUES(?,?,?,?,?,?,?,?,?,?,?)','CAM','client','store','meta','META-1','Campaign','sales','active','EGP',100,day);
run('INSERT INTO campaign_daily_metrics VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)','AD','CAM','client','store',day,100,1000,700,50,0,0,0,0,0);
run('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)','TX','client','store','expense',day,day+'T11:00:00Z','Meta Ads',70,'Imported ad transaction, not additional spend');
for(const id of ['CANON','DUP'])run('INSERT INTO order_attribution VALUES(?,?,?)',id,'client','CAM');
class Statement {
 constructor(sql){this.sql=sql;this.args=[];}
 bind(...args){this.args=args;return this;}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
}
const env={DB:{prepare:sql=>new Statement(sql)}};
const data=await dashboardData(env,{clientId:'client',storeId:'store',from:day,to:day});
assert.equal(data.overview.totalOrders,2,'one Easy Orders import plus one manual order; no linked duplicate');
assert.equal(data.overview.expectedRevenue,800,'dashboard sales must exclude the duplicate and other tenant');
assert.equal(data.overview.activeOrders,1);
assert.equal(data.overview.actualOrderCost,50,'actual CPP uses 100 EGP ads ÷ 2 canonical orders');
assert.equal(data.overview.activeProductCost,120);
assert.equal(data.finance.productCost,200);
assert.equal(data.finance.expenseBreakdown.ads,100,'integrated ads suppress double-entered manual ads');
assert.equal(data.ads.spendReconciliation.manualExcludedWhenIntegrated,true,'manual ads require source reconciliation, not automatic double counting');
assert.ok(data.recommendations.some(x=>x.category==='finance'&&x.title.includes('مصاريف إعلانات يدوية')));
assert.equal(data.finance.netProfit,500,'800 sales - 200 COGS - 100 ads');
assert.equal(data.ads.realOrders,2,'Meta attributed reports must agree with the system dashboard');
assert.equal(data.ads.confirmedOrders,2);
assert.equal(data.ads.deliveredOrders,1);
assert.equal(data.ads.realRoas,3,'collected revenue 300 / ads spend 100');
assert.equal(data.ads.campaigns[0].realOrders,1,'linked duplicate attribution must not inflate campaign');
assert.equal(data.trend.points.reduce((sum,p)=>sum+p.orders,0),2,'trend total agrees with KPI');
assert.equal(data.rates.d7.total,2,'rolling rates do not count linked duplicate');
const pnl={sales:{revenue:1000},costs:{shipping:20,operatingExpenses:130},profit:{operatingNetProfit:670,otherIncome:30,accountingNetProfit:700,marginPct:70}};
reconcileMonthlyShippingTotals(pnl,30);
assert.equal(pnl.costs.shipping,30);
assert.equal(pnl.costs.operatingExpenses,140);
assert.equal(pnl.profit.operatingNetProfit,660);
assert.equal(pnl.profit.accountingNetProfit,690);
assert.equal(pnl.profit.marginPct,69);
reconcileMonthlyShippingTotals(pnl,30);
assert.equal(pnl.profit.accountingNetProfit,690,'idempotent if the same shipping basis is applied twice');
// An integrated spend row without a campaign join must still be in the dashboard spend total.
// ROAS must use that same denominator and expose the campaign attribution gap.
run('INSERT INTO campaign_daily_metrics VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)','ORPHAN','NO-MAPPED-CAMPAIGN','client','store',day,40,100,50,5,0,0,0,0,0);
const withOrphan=await dashboardData(env,{clientId:'client',storeId:'store',from:day,to:day});
assert.equal(withOrphan.ads.spend,140,'all integrated daily spend counts, even if a campaign link is missing');
assert.equal(withOrphan.overview.actualOrderCost,70,'CPP denominator remains the two canonical orders');
assert.equal(withOrphan.ads.spendReconciliation.needsReview,true);
assert.equal(withOrphan.ads.spendReconciliation.discrepancy,40);
assert.equal(withOrphan.ads.realRoas,2.14,'Real ROAS must share the recognized integrated ad spend denominator');
assert.equal(withOrphan.finance.netProfit,460,'P&L uses 140 recognized ads, not 100 mapped campaign ads');
assert.ok(withOrphan.recommendations.some(x=>x.category==='finance'&&x.severity==='danger'),'show reconciliation warning');
assert.equal(withOrphan.finance.isCollectedProfit,false,'expected eligible order P&L cannot be called collected profit');
run("UPDATE stores SET currency='SAR' WHERE id='store'");
const wrongCurrency=await dashboardData(env,{clientId:'client',storeId:'store',from:day,to:day});
assert.equal(wrongCurrency.ads.spendReconciliation.currencyMismatch,true,'do not treat EGP ad spend as SAR without FX normalization');
assert.deepEqual(wrongCurrency.ads.spendReconciliation.campaignCurrencies,['EGP']);
assert.equal(wrongCurrency.ads.spendReconciliation.storeCurrency,'SAR');
assert.ok(wrongCurrency.recommendations.some(rec=>rec.title.includes('اختلاف عملة')),'cross-currency warning must be visible');
db.close();
console.log('Finance canonical order and P&L balance SQL QA PASS');
