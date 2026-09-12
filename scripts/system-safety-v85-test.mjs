import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [index,bootstrap,main,customer,dashboard,reset,backend,currentCost,migration]=await Promise.all([
  read('public/v2/index.html'),
  read('public/v2/modules-v84-jt-create-setup.js'),
  read('public/v2/modules-v85-system-safety.js'),
  read('public/v2/modules-v85-customer-service.js'),
  read('public/v2/modules-v85-dashboard.js'),
  read('public/v2/modules-v85-reset-center.js'),
  read('src/index-commerce-v38.js'),
  read('src/dashboard-live-product-cost-v2.js'),
  read('migrations/0023_system_safety_controls.sql')
]);
assert.ok(index.includes('/v2/modules-v84-jt-create-setup.js?v=84.3'),'global page must still load the v84 bootstrap host');
assert.ok(bootstrap.includes('/v2/modules-v85-system-safety.js?v=85.0'),'v84 bootstrap host must load v85 safety globally');
for(const [name,source] of [['main',main],['customer',customer],['dashboard',dashboard],['reset',reset]])assert.doesNotThrow(()=>new Function(source),`${name} v85 module must parse`);
for(const source of [main,customer,dashboard,reset])assert.equal(source.includes('location.reload'),false,'v85 modules must never refresh the whole browser page');
for(const marker of ['/api/system/undo','modules-v85-customer-service.js','modules-v85-dashboard.js','modules-v85-reset-center.js'])assert.ok(main.includes(marker),`v85 bootstrap missing ${marker}`);
for(const marker of ['/api/system/orders/','العميل لا يرد — يرجّع القطعة للمخزون','سجل العمليات','KunCustomerServiceV31?.moveState?.'])assert.ok(customer.includes(marker),`Customer Service v85 missing ${marker}`);
for(const marker of ['/api/system/dashboard/expense-details','/api/system/dashboard/active-ads','هذا الأسبوع','الأسبوع الماضي','من بداية الشهر','الشهر الماضي','مدة معينة','XMLHttpRequest','data-kun85-provinces-body','data-kun85-active-ads-body'])assert.ok(dashboard.includes(marker),`dashboard v85 missing ${marker}`);
assert.ok(dashboard.includes('Active فقط'),'dashboard copy must make active-only ad scope explicit');
for(const marker of ['/api/system/reset-center','/api/system/reset-password','/api/system/reset-section','section:sectionId','section.canReset','مركز تصفير الأقسام'])assert.ok(reset.includes(marker),`reset center v85 missing ${marker}`);
for(const marker of ["p==='/api/dashboard'&&m==='GET'",'applyCurrentInventoryCostsV2','/api/system/dashboard/expense-details','/api/system/dashboard/active-ads','/api/system/undo','/api/system/reset-center','/api/system/reset-password','/api/system/reset-section','resetOrderStockAllocationForRepair','customer-service-backward-state','recordOrderMutation',"target==='no_answer'&&['confirmed','preparing']","status:'active'"])assert.ok(backend.includes(marker),`v38 backend missing ${marker}`);
for(const marker of ['variantById','variantBySku','productBySku','productByName','lineLevelHistoricalFallback','current_inventory_resolved'])assert.ok(currentCost.includes(marker),`current cost resolver missing ${marker}`);
for(const marker of ['system_undo_actions','section_reset_credentials','section_reset_log'])assert.ok(migration.includes(marker),`system safety migration missing ${marker}`);
console.log('System safety v85 contract passed');