import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {accountingCatalog} from '../src/accounting.js';

const [service,monthly,worker,scheduler,entry,ui,index,migration,financeSync,loader]=await Promise.all([
  readFile(new URL('../src/accounting.js',import.meta.url),'utf8'),
  readFile(new URL('../src/accounting-monthly.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v30.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v36-accounting.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0015_accounting_management_fee.sql',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v101-finance-accounting-sync.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v17.js',import.meta.url),'utf8')
]);
new Function(ui);
new Function(financeSync);
const monthlySyntax=spawnSync(process.execPath,['--check',fileURLToPath(new URL('../src/accounting-monthly.js',import.meta.url))],{encoding:'utf8'});
assert.equal(monthlySyntax.status,0,`Monthly Accounting syntax invalid: ${monthlySyntax.stderr||monthlySyntax.stdout}`);
const financeSyncSyntax=spawnSync(process.execPath,['--check',fileURLToPath(new URL('../public/v2/modules-v101-finance-accounting-sync.js',import.meta.url))],{encoding:'utf8'});
assert.equal(financeSyncSyntax.status,0,`Finance accounting sync syntax invalid: ${financeSyncSyntax.stderr||financeSyncSyntax.stdout}`);
const liveAccountingPath=fileURLToPath(new URL('./live-preview-accounting-test.mjs',import.meta.url));
const syntax=spawnSync(process.execPath,['--check',liveAccountingPath],{encoding:'utf8'});
assert.equal(syntax.status,0,`Live Accounting QA syntax invalid: ${syntax.stderr||syntax.stdout}`);
const catalog=accountingCatalog();
assert.ok(catalog.categories.includes('رواتب وأجور')&&catalog.categories.includes('مصاريف إدارية')&&catalog.methods.includes('bank'));
for(const marker of ['management_fee_pct','order_management_fees','document_no','counterparty','tax_amount','reference_type','reference_id'])assert.ok(migration.includes(marker),`Accounting migration missing ${marker}`);
for(const marker of ["ACTIVE_STATES=new Set(['shipped','signed','collected'])","REVERSE_STATES=new Set(['returned','cancelled'])","base*rate/100","status='reversed'",'decorateDashboardWithManagementFees','decorateProfitIntelligence','existing.status===\'active\''])assert.ok(service.includes(marker),`Accounting service missing ${marker}`);
for(const marker of ['/api/accounting/overview','/api/accounting/entries','/api/accounting/management-fees','management-fee','requirePermission(me,\'finance\',\'write\')','me.role!==\'admin\'','reconcileManagementFeeForOrder','decorateDashboardWithManagementFees'])assert.ok(worker.includes(marker),`v31 accounting route missing ${marker}`);
for(const marker of ['reconcileAutomaticManagementFees','JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id','order_management_fees f',"COALESCE(s.management_fee_pct,0)>0","o.state IN ('shipped','signed','collected')","o.state IN ('returned','cancelled')",'Promise.allSettled(pending)','runScheduledThenReconcile','ctx?.waitUntil?.(task)'])assert.ok(scheduler.includes(marker),`Scheduled accounting reconciliation missing ${marker}`);
assert.ok(scheduler.indexOf('Promise.allSettled(pending)')<scheduler.indexOf('return reconcileAutomaticManagementFees(env)'),'Management fee reconciliation must run after downstream scheduled tasks settle');
assert.ok(!scheduler.includes('o.updated_at'),'Scheduled reconciliation must only use real orders timestamp columns');

for(const marker of ['/api/accounting/monthly','requirePermission(me,\'finance\',\'read\')','accountingOverview','categoryBreakdown','accountingNetProfit','manualExpenses','collectedRevenue','finalDashboard'])assert.ok(monthly.includes(marker),`Monthly accounting service missing ${marker}`);
for(const marker of ['handleAccountingMonthly','if(monthly)return monthly','handleJtHistoryReconcile'])assert.ok(entry.includes(marker),`v38 monthly accounting routing missing ${marker}`);
for(const marker of ['الحسابات والحركات','تسجيل حركة','الحساب الشهري P&amp;L','إيراد المبيعات','المحصل فعليًا','صافي الربح المحاسبي للشهر','المتجر / الفرع','رقم المستند','الجهة / الطرف المقابل','الضريبة','رسوم الإدارة الآلية','المصروف اليدوي يدخل أصلًا ضمن مصروفات التشغيل','kun:accounting-changed'])assert.ok(ui.includes(marker),`Accounting UI missing ${marker}`);
assert.ok(ui.includes('/api/accounting/monthly?month='),'Accounting UI must load the unified monthly summary');
assert.ok(ui.includes("api('/api/accounting/entries',{method:'POST'"),'Accounting UI must create manual entries');
assert.ok(ui.includes("method:'DELETE'"),'Accounting UI must support deleting manual entries');
assert.ok(index.includes('data-view="accounting">الحسابات والحركات</button>'),'Accounting navigation must be present before the base router binds click handlers');
assert.ok(index.includes('modules-v36-accounting.js?v=100.1'),'Accounting v100.1 module is not cache-busted in v2');
for(const marker of ['/api/accounting/monthly','/api/accounting/overview','صافي الربح المحاسبي / الخسارة','إيرادات أخرى مسجلة يدويًا','kun:accounting-changed','operatingNet+otherIncome'])assert.ok(financeSync.includes(marker),`Finance accounting sync missing ${marker}`);
assert.ok(loader.includes('/v2/modules-v101-finance-accounting-sync.js?v=101.0'),'Finance accounting sync asset is not runtime-loaded');
assert.ok(loader.includes('data-kun-finance-accounting-sync="v101"'),'Finance accounting sync loader guard is missing');
assert.ok(!service.includes('UPDATE order_management_fees SET rate_pct'),'Existing order fee rate must not be repriced when store rate changes');
console.log('Accounting + management fee contract passed: unified monthly P&L, store-aware manual movements, cash/revenue separation, management-fee reconciliation, immutable historical rates, static accounting navigation binding, v100 accounting UI and runtime Finance v101 synchronization.');
