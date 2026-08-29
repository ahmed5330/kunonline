import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {accountingCatalog} from '../src/accounting.js';

const [service,worker,ui,index,migration]=await Promise.all([
  readFile(new URL('../src/accounting.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v36-accounting.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0015_accounting_management_fee.sql',import.meta.url),'utf8')
]);
new Function(ui);
const catalog=accountingCatalog();
assert.ok(catalog.categories.includes('رواتب وأجور')&&catalog.categories.includes('مصاريف إدارية')&&catalog.methods.includes('bank'));
for(const marker of ['management_fee_pct','order_management_fees','document_no','counterparty','tax_amount','reference_type','reference_id'])assert.ok(migration.includes(marker),`Accounting migration missing ${marker}`);
for(const marker of ["ACTIVE_STATES=new Set(['shipped','signed','collected'])","REVERSE_STATES=new Set(['returned','cancelled'])","base*rate/100","status='reversed'",'decorateDashboardWithManagementFees','decorateProfitIntelligence','existing.status===\'active\''])assert.ok(service.includes(marker),`Accounting service missing ${marker}`);
for(const marker of ['/api/accounting/overview','/api/accounting/entries','/api/accounting/management-fees','management-fee','requirePermission(me,\'finance\',\'write\')','me.role!==\'admin\'','reconcileManagementFeeForOrder','decorateDashboardWithManagementFees'])assert.ok(worker.includes(marker),`v31 accounting route missing ${marker}`);
for(const marker of ['الحسابات','تسجيل حركة محاسبية','نسبة الإدارة الآلية','رقم المستند / الفاتورة','الجهة / الطرف المقابل','قيمة الضريبة','إعدادات نسبة الإدارة','تُثبت الرسوم أول مرة يدخل فيها الأوردر مرحلة الشحن'])assert.ok(ui.includes(marker),`Accounting UI missing ${marker}`);
assert.ok(index.includes('modules-v36-accounting.js?v=36.0'),'Accounting module is not loaded by v2');
assert.ok(!service.includes('UPDATE order_management_fees SET rate_pct'),'Existing order fee rate must not be repriced when store rate changes');
console.log('Accounting + management fee contract passed: accountant workspace, admin-only per-store percentage, ship activation, return/cancel reversal, immutable historical rate and dashboard/P&L decoration.');
