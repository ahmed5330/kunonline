import fs from 'node:fs';
import assert from 'node:assert/strict';

const html=fs.readFileSync('public/v2/index.html','utf8');
const finance=fs.readFileSync('public/v2/modules-v96-finance-command-center.js','utf8');
const accounts=fs.readFileSync('public/v2/modules-v36-accounting.js','utf8');
const dashboard=fs.readFileSync('public/v2/modules-v126-dashboard-finance-top.js','utf8');
const collectedProfitUI=fs.readFileSync('public/v2/modules-v47-collected-profit.js','utf8');
const accountingBackend=fs.readFileSync('src/accounting.js','utf8');
const detail=fs.readFileSync('src/index-commerce-v38-base.js','utf8');

assert.match(html,/modules-v96-finance-command-center\.js\?v=96\.2/,
  'finance command center must be loaded in the real user-facing V2 HTML');
assert.match(finance,/version:'96\.2'/);
assert.match(finance,/accountingNet=Math\.round\(\(net\+manualIncome\)\*100\)\/100/,
  'finance must distinguish operational and accounting net profitability');
assert.ok(finance.includes('صافي الربح المحاسبي'),'accounting net must be visible in Finance');
assert.ok(finance.includes('صافي الربح التشغيلي'),'operating net must be visible in Finance');
assert.ok(accounts.includes('صافي الربح المحاسبي للشهر'),'Accounts must expose matching definition');
assert.match(html,/modules-v36-accounting\.js\?v=100\.3/);
assert.ok(accounts.includes('تحصيل بمبلغ مسجل فقط'),'Monthly Accounts must identify explicitly recorded collections');
assert.ok(accounts.includes('cash.verifiedNetCash'),'Monthly Accounts must keep unverified COD out of verified movements');
assert.ok(finance.includes('a.estimatedCollectedRevenue'),'Finance must distinguish estimated COD totals');
assert.ok(finance.includes('a.verifiedCollectedRevenue'),'Finance must display verified COD and reconcile it to collection details');
assert.ok(dashboard.includes("card('pnl','صافي الربح التشغيلي'"),'dashboard must not mislabel operating profit');
assert.ok(finance.includes('ليس رصيد البنك'),'registered cash flow must not be marketed as bank cash');
for(const metric of ['التحصيل: المالية × الحسابات','صافي التشغيل × معادلة P&L','إجمالي المصروفات × بنودها','إعلانات الداشبورد × المالية','مبالغ تحصيل تقديرية']) assert.ok(finance.includes(metric),`missing live reconciliation status: ${metric}`);
assert.ok(accountingBackend.includes('netCash=r2(collectedRevenue+manualIncome-manualExpenses)'),
  'accrued management fees must not distort registered inflow/outflow balance');
assert.ok(detail.includes("AND NOT EXISTS (SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=orders.id) ORDER BY"),
  'dashboard cost breakdown must use only canonical orders');
assert.match(html,/modules-v47-collected-profit\.js\?v=47\.3/);
assert.ok(collectedProfitUI.includes('missingCollectionAmountOrders'),'collected-profit UI must disclose estimated COD fallback');
assert.ok(collectedProfitUI.includes('unverifiedCollectionFallbackGross'),'unverified order amount must be visible to merchants');
assert.ok(collectedProfitUI.includes('collectionAmountEstimated'),'individual collected rows must expose legacy estimation');
assert.doesNotThrow(()=>new Function(collectedProfitUI),'collected-profit UI must parse');
assert.doesNotThrow(()=>new Function(finance),'finance UI must parse as JS');
assert.doesNotThrow(()=>new Function(dashboard),'consolidated dashboard UI must parse as JS');
console.log('Finance UI cross-section consistency PASS');
