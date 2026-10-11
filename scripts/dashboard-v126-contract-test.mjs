import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui=fs.readFileSync('public/v2/modules-v126-dashboard-finance-top.js','utf8');
const preview=fs.readFileSync('src/index-commerce-v38.js','utf8');
const production=fs.readFileSync('src/index-production-mobile-update.js','utf8');

for(const label of ['أرباح تم التحصيل','أرباح منتظرة','الربح / الخسارة','عرض المفردات']) assert.ok(ui.includes(label),`missing label: ${label}`);
for(const token of ['/api/accounting/collected-profit','/api/system/dashboard/input-details','expectedProfit','netProfit']) assert.ok(ui.includes(token),`missing data contract: ${token}`);
assert.ok(ui.includes('data-dashboard-finance-top="126"'),'top finance section marker is required');
for(const marker of ["card('cpp','سعر الطلب الفعلي'","const actualCpp=orders?money(adSpend/orders,c):'—'","data-f126-detail","if(type==='cpp')return cppDetails()","إجمالي مصروفات الإعلانات خلال الفترة ÷ جميع الأوردرات"]) assert.ok(ui.includes(marker),`missing actual system-wide order-cost card: ${marker}`);
assert.doesNotThrow(()=>new Function(ui),'top four KPIs dashboard browser module must parse');
assert.ok(ui.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),'all four financial KPIs should share one desktop row');

assert.ok(preview.includes('/v2/modules-v126-dashboard-finance-top.js?v=126.1'),'preview must load v126');
assert.ok(production.includes('/v2/modules-v126-dashboard-finance-top.js?v=126.1'),'production html must load v126');
for(const unsafe of ['DROP TABLE','DELETE FROM','ALTER TABLE','CREATE TABLE','migrations/']) assert.ok(!ui.includes(unsafe),`unexpected DB mutation token: ${unsafe}`);

console.log('dashboard v126 finance top contract: ok');
