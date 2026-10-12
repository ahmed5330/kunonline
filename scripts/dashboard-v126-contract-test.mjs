import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui=fs.readFileSync('public/v2/modules-v126-dashboard-finance-top.js','utf8');
const preview=fs.readFileSync('src/index-commerce-v38.js','utf8');
const production=fs.readFileSync('src/index-production-mobile-update.js','utf8');

for(const label of ['صافي التحصيل التقديري','هامش الطلبات النشطة','صافي الربح التشغيلي','التفاصيل ←']) assert.ok(ui.includes(label),`missing label: ${label}`);
for(const token of ['/api/accounting/collected-profit','/api/system/dashboard/input-details','expectedProfit','netProfit']) assert.ok(ui.includes(token),`missing data contract: ${token}`);
assert.ok(ui.includes('data-dashboard-finance-top="126"'),'top finance section marker is required');
for(const marker of ["card('cpp','سعر الطلب الفعلي'","const actualCpp=orders?money(adSpend/orders,c):'—'","data-f126-detail","if(type==='cpp')return cppDetails()","إجمالي مصروفات الإعلانات خلال الفترة ÷ جميع الأوردرات"]) assert.ok(ui.includes(marker),`missing actual system-wide order-cost card: ${marker}`);
assert.doesNotThrow(()=>new Function(ui),'top eight KPIs dashboard browser module must parse');
assert.ok(ui.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),'desktop layout must support four cards per row');

assert.ok(preview.includes('/v2/modules-v126-dashboard-finance-top.js?v=126.5'),'preview must load v126');
assert.ok(production.includes('/v2/modules-v126-dashboard-finance-top.js?v=126.5'),'production html must load v126');
for(const unsafe of ['DROP TABLE','DELETE FROM','ALTER TABLE','CREATE TABLE','migrations/']) assert.ok(!ui.includes(unsafe),`unexpected DB mutation token: ${unsafe}`);


// One consolidated summary is the only visible KPI surface above analyses.
for(const label of ['ملخص الأداء','عدد الأوردرات','الإيرادات المتوقعة','صافي الربح التشغيلي','سعر الطلب الفعلي','صافي التحصيل التقديري','هامش الطلبات النشطة','نسبة التأكيد','نسبة التسليم'])
  assert.ok(ui.includes(label),`missing consolidated top KPI: ${label}`);
assert.ok(ui.includes('dash-f126-grid'),'summary must own all eight cards');
assert.ok(ui.includes('const sources=entries(d,\'مصادر الطلبات\')'),'summary must show all order sources without removing manual entries');
assert.ok(ui.includes("statuses=entries(d,'حالات الطلبات')"),'summary must show all order statuses');
assert.ok(ui.includes('selectedRates(d)'),'selected period must drive confirmation/delivery rates');
assert.ok(ui.includes('[data-dash-executive="122"]')&&ui.includes('#cp47Section')&&ui.includes('[data-dash-section="overview"]'),'old duplicate dashboard sections must be hidden');
assert.ok(ui.includes('if(old?.__kunSummarySig===signature)return'),'render must not loop on its own MutationObserver updates');
assert.ok(ui.includes('data-f126-refresh')&&ui.includes('KunDashboardV33?.reload'),'unified dashboard must remain refreshable');
const executive=fs.readFileSync('public/v2/modules-v122-dashboard-experience.js','utf8');
const collected=fs.readFileSync('public/v2/modules-v47-collected-profit.js','utf8');
assert.ok(executive.includes("window.KunDashboardFinanceTopV126?.version==='126.4'"),'legacy dark executive must not recreate itself');
assert.ok(collected.includes("window.KunDashboardFinanceTopV126?.version==='126.4'"),'legacy standalone collected cards must not reappear/poll');
console.log('dashboard v126 finance top contract: ok');
