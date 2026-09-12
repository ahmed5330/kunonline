import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [index,bootstrap,main,customer,dashboard,dashboardInputs,reset,backendWrapper,backendSafety,currentCost,migration]=await Promise.all([
  read('public/v2/index.html'),
  read('public/v2/modules-v84-jt-create-setup.js'),
  read('public/v2/modules-v85-system-safety.js'),
  read('public/v2/modules-v85-customer-service.js'),
  read('public/v2/modules-v85-dashboard.js'),
  read('public/v2/modules-v86-dashboard-input-details.js'),
  read('public/v2/modules-v85-reset-center.js'),
  read('src/index-commerce-v38.js'),
  read('src/index-commerce-v38-safety.js'),
  read('src/dashboard-live-product-cost-v2.js'),
  read('migrations/0023_system_safety_controls.sql')
]);
const backend=`${backendWrapper}\n${backendSafety}`;
assert.ok(index.includes('/v2/modules-v84-jt-create-setup.js?v=84.4'),'global page must cache-bust and load the v84.4 bootstrap host');
assert.ok(index.includes('/v2/modules-v86-dashboard-input-details.js?v=86.0'),'global page must directly load the v86 dashboard input drilldown module');
assert.ok(bootstrap.includes('/v2/modules-v85-system-safety.js?v=85.0'),'v84 bootstrap host must load v85 safety globally');
assert.ok(bootstrap.includes('/v2/modules-v86-dashboard-input-details.js?v=86.0'),'v84 bootstrap host must also recover the v86 dashboard input drilldown module');
for(const [name,source] of [['main',main],['customer',customer],['dashboard',dashboard],['dashboardInputs',dashboardInputs],['reset',reset]])assert.doesNotThrow(()=>new Function(source),`${name} system module must parse`);
for(const source of [main,customer,dashboard,dashboardInputs,reset])assert.equal(source.includes('location.reload'),false,'system modules must never refresh the whole browser page');
for(const marker of ['/api/system/undo','modules-v85-customer-service.js','modules-v85-dashboard.js','modules-v85-reset-center.js'])assert.ok(main.includes(marker),`v85 bootstrap missing ${marker}`);
for(const marker of ['/api/system/orders/','العميل لا يرد — يرجّع القطعة للمخزون','سجل العمليات','KunCustomerServiceV31?.moveState?.'])assert.ok(customer.includes(marker),`Customer Service v85 missing ${marker}`);
for(const marker of ['/api/system/dashboard/expense-details','/api/system/dashboard/active-ads','هذا الأسبوع','الأسبوع الماضي','من بداية الشهر','الشهر الماضي','مدة معينة','XMLHttpRequest','data-kun85-provinces-body','data-kun85-active-ads-body'])assert.ok(dashboard.includes(marker),`dashboard v85 missing ${marker}`);
assert.ok(dashboard.includes('Active فقط'),'dashboard copy must make active-only ad scope explicit');
for(const marker of ['/api/system/dashboard/input-details','الإيراد المتوقع','تكلفة المنتج','كل المصروفات التشغيلية','صافي الربح','هامش الربح','kun86-input-click',"setAttribute('role','button')",'عرض المدخلات'])assert.ok(dashboardInputs.includes(marker),`dashboard v86 input drilldown missing ${marker}`);
assert.ok(dashboardInputs.includes("observe(root,{childList:true,subtree:false})"),'dashboard v86 observer must stay root-only');
for(const marker of ['/api/system/reset-center','/api/system/reset-password','/api/system/reset-section','section:sectionId','section.canReset','مركز تصفير الأقسام'])assert.ok(reset.includes(marker),`reset center v85 missing ${marker}`);
for(const marker of ["p==='/api/dashboard'&&m==='GET'",'applyCurrentInventoryCostsV2','/api/system/dashboard/expense-details','/api/system/dashboard/active-ads','/api/system/undo','/api/system/reset-center','/api/system/reset-password','/api/system/reset-section','resetOrderStockAllocationForRepair','customer-service-backward-state','recordOrderMutation',"target==='no_answer'&&['confirmed','preparing']","status:'active'"])assert.ok(backend.includes(marker),`v38 backend missing ${marker}`);
for(const marker of ["import safety from './index-commerce-v38-safety.js'","import core from './index-commerce-v38-core.js'",'isAuthFailure',"code:'AUTH_REQUIRED'",'response.status!==500',',401)'])assert.ok(backendWrapper.includes(marker),`v38 auth-status wrapper missing ${marker}`);
assert.ok(backendWrapper.includes("if(isAuthFailure(data))return json({...data,code:'AUTH_REQUIRED'},401)"),'v85 anonymous auth failures must stay 401 instead of being rewritten to SYSTEM_V85_ERROR/500');
for(const marker of ['normalizeDashboardContract',"productCostSource:'current_inventory'","source:'current_inventory'","resolution:'current_inventory_resolved'","url.pathname==='/api/dashboard'"])assert.ok(backendWrapper.includes(marker),`v38 dashboard compatibility contract missing ${marker}`);
for(const marker of ['/api/system/dashboard/input-details','dashboardInputDetails','operatingExpenses','expectedRevenue','productCost','netProfit','profitMargin','resolveCurrentInventoryOrderCost','expenseInputs','productCostRows'])assert.ok(backendWrapper.includes(marker),`v38 dashboard input-details backend missing ${marker}`);
for(const marker of ['variantById','variantBySku','productBySku','productByName','lineLevelHistoricalFallback','current_inventory_resolved'])assert.ok(currentCost.includes(marker),`current cost resolver missing ${marker}`);
for(const marker of ['system_undo_actions','section_reset_credentials','section_reset_log'])assert.ok(migration.includes(marker),`system safety migration missing ${marker}`);
console.log('System safety v85/v86 contract passed');
