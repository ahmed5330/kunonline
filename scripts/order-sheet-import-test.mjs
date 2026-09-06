import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {orderSheetSources,normalizeImportedState} from '../src/order-sheet-import.js';

const [ui,backend,reconciliation,migration,index,worker,css,details]=await Promise.all([
  readFile(new URL('../public/v2/modules-v35-order-import.js',import.meta.url),'utf8'),
  readFile(new URL('../src/order-sheet-import.js',import.meta.url),'utf8'),
  readFile(new URL('../src/order-import-reconciliation.js',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0018_order_import_reconciliation.sql',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v14.css',import.meta.url),'utf8'),
  readFile(new URL('../src/order-details.js',import.meta.url),'utf8')
]);
new Function(ui);
assert.deepEqual(orderSheetSources().map(x=>x.id),['easyorders','woocommerce','shopify','salla','zid','custom']);
for(const [input,expected] of [['pending','pending'],['تم التأكيد','confirmed'],['التجهيز والتغليف','preparing'],['جاري الشحن','shipped'],['delivered','signed'],['تم التحصيل','collected'],['مرتجع','returned'],['تم إلغاء الطلب','cancelled']])assert.equal(normalizeImportedState(input),expected,`Imported state ${input} should map to ${expected}`);
for(const header of ['ID','Status','FullName','Phone','City','Address','Total Cost','Product Cost','Shipping Cost','Coupon','Coupon Discount','Product Name','Variant','Quantity','SKU','Item Price','CreatedAt','Extra Data','Extra Data2','Alt Phone','Note','Ref','Utm Source','Utm Campaign','Payment Method','Payment Status','Funnel ID','Order ID','Referral Code','External Order ID'])assert.ok(ui.includes(header),`Easy Orders mapping missing exact header: ${header}`);
for(const marker of ["externalId:['Order ID']","platformProductSubtotal:['Product Cost']",'DecompressionStream(\'deflate-raw\')','xl/sharedStrings.xml','worksheets','getElementsByTagName','excelDate','v35ImportOrders','استيراد شيت','معاينة قبل الحفظ','WooCommerce','Shopify','سلة','زد','شيت مخصص','items','lineKey','stockAllocated','stockRestored','stockShortageOrders','35.1'])assert.ok(ui.includes(marker),`Order sheet UI missing ${marker}`);
assert.ok(!ui.includes("productCost:val(raw,'platformProductSubtotal')"),'Easy Orders Product Cost must not be treated as Kun COGS');
for(const marker of ['sheet:${source}:','orders.sheet_import','billOrder','store_id IS ?','platformProductSubtotal','source===\'easyorders\'','externalOrderId','ORDER_IMPORT_STORE_REQUIRED','reconcileManagementFeeForOrder','syncImportedOrderItems','reconcileImportedOrderInventory','stockAllocated','stockRestored','stockShortageOrders','variantSku','productCost=r2(items.reduce'])assert.ok(backend.includes(marker),`Order sheet backend missing ${marker}`);
for(const marker of ['order_item_stock_allocations','inventory_batch_items','ORDER BY b.stock_date ASC','date(b.stock_date)<=date(?)','stockDate:order.date',"status='allocated'","status='returned'"])assert.ok(reconciliation.includes(marker),`Historical stock reconciliation missing ${marker}`);
for(const marker of ['CREATE TABLE IF NOT EXISTS order_items','CREATE TABLE IF NOT EXISTS order_item_stock_allocations','idx_order_items_line','idx_order_item_alloc_order'])assert.ok(migration.includes(marker),`Import reconciliation migration missing ${marker}`);
for(const marker of ["path==='/api/orders/sheet-import'","path==='/api/orders/sheet-import/sources'","requirePermission(me,'orders','write')","resolveStoreScope(env,me,clientId"])assert.ok(worker.includes(marker),`v31 order import route missing ${marker}`);
for(const marker of ['kun-v14.css?v=14.0','modules-v35-order-import.js?v=35.1'])assert.ok(index.includes(marker),`index missing ${marker}`);
for(const marker of ['.v35-map-grid','.v35-summary','.v35-preview','.v35-result-grid','@media(max-width:760px)'])assert.ok(css.includes(marker),`Order import CSS missing ${marker}`);
for(const marker of ['sheet:easyorders:','order_items','importedLineItems'])assert.ok(details.includes(marker),`Order details imported-line fallback missing ${marker}`);
console.log('Order sheet import contract passed: exact Easy Orders mapping, preserved line items, per-item catalog COGS, historical state/date, management-fee reconciliation, FIFO named-batch stock deduction/restoration, idempotency and detail fallback.');
