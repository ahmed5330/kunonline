import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [worker,ui,index,migration,legacy,batches,v30,cs,v39,v50,batchMigration]=await Promise.all([
  read('src/index-commerce-v31.js'),read('public/v2/modules-v37-inventory.js'),read('public/v2/index.html'),read('migrations/0016_inventory_stock_date.sql'),read('src/index.js'),read('src/inventory-batches.js'),read('src/index-commerce-v30.js'),read('src/customer-service.js'),read('public/v2/modules-v39-stock-batches.js'),read('public/v2/modules-v50-stock-batch-variants.js'),read('migrations/0017_inventory_batches.sql')
]);
new Function(ui);new Function(v39);new Function(v50);
for(const marker of ['/api/inventory/stock-adjust','/api/inventory/stock-log','validStockDate','stockDate','stock_date','STOCK_DATE_INVALID','inventoryScope','requirePermission(me,\'inventory\',\'write\')','requirePermission(me,\'inventory\',\'read\')','supplier_name','created_by'])assert.ok(worker.includes(marker),`Inventory worker missing ${marker}`);
for(const marker of ['تاريخ المخزون','v37StockDate','/api/inventory/stock-adjust','سجل إضافات المخزون','/api/inventory/stock-log','وقت التسجيل','v37AddStockFromHistory'])assert.ok(ui.includes(marker),`Inventory UI missing ${marker}`);
for(const marker of ['ALTER TABLE stock_log ADD COLUMN stock_date TEXT','UPDATE stock_log','idx_stocklog_stock_date','trg_stock_log_default_stock_date'])assert.ok(migration.includes(marker),`Inventory migration missing ${marker}`);
for(const marker of ['inventory_batches','inventory_batch_items','order_stock_allocations','batch_id','batch_name','variant_id'])assert.ok(batchMigration.includes(marker),`Batch migration missing ${marker}`);
for(const marker of ['listInventoryBatches','createInventoryBatch','assertProductCanDelete','prepareOrderStockTransition','rollbackOrderStockTransition','finalizeOrderStockTransition','remaining_qty','STOCK_BATCH_REQUIRED','PRODUCT_HAS_BATCH_STOCK','variantId','product_variants','variant_id'])assert.ok(batches.includes(marker),`Stock batch domain missing ${marker}`);
for(const marker of ["path==='/api/inventory/batches'",'createInventoryBatch','listInventoryBatches','assertProductCanDelete',"requirePermission(me,'inventory','write')","requirePermission(me,'products','write')"])assert.ok(v30.includes(marker),`v30 stock-batch API missing ${marker}`);
for(const marker of ['prepareOrderStockTransition','rollbackOrderStockTransition','finalizeOrderStockTransition','stockBatchId','stock_batch_id','stock_batch_name','order_stock_allocations'])assert.ok(cs.includes(marker),`Customer Service batch allocation missing ${marker}`);
for(const marker of ['data-order-v27','حذف المنتج','+ إضافة استوك جديد','اسم/تسمية الاستوك','تاريخ إضافة المخزون','أول استوك','/api/inventory/batches','activeOnly=1','stockBatchId','اختيار الاستوك ونقل لجاري الشحن'])assert.ok(v39.includes(marker),`v39 UI missing ${marker}`);
for(const marker of ['/api/catalog/products','rowsFromCatalog','product.variants','optionValues','data-v50-variant-id','variantId:input.dataset.v50VariantId','كميات المنتجات والمتغيرات داخل هذا الاستوك','كل لون / مقاس / متغير من Easy Orders','المتاح حاليًا','/api/inventory/batches'])assert.ok(v50.includes(marker),`Variant stock-batch UI missing ${marker}`);
assert.ok(index.includes('modules-v37-inventory.js?v=37.0'),'Inventory v37 module is not loaded');
assert.ok(index.includes('modules-v39-stock-batches.js?v=39.0'),'Stock batches v39 module is not loaded');
assert.ok(index.includes('modules-v50-stock-batch-variants.js?v=50.0'),'Variant stock-batch v50 module is not loaded');
assert.ok(legacy.includes('INSERT INTO stock_log'),'Legacy stock writes must remain supported by the migration trigger');
console.log('Inventory contract passed: historic dates, named multi-product/variant batches, variant-aware quantities, order allocation, depletion hiding, explicit product/order delete UI and safeguards are wired.');
