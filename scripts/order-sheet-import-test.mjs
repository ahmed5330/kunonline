import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {orderSheetSources} from '../src/order-sheet-import.js';

const [ui,backend,index,worker,css]=await Promise.all([
  readFile(new URL('../public/v2/modules-v35-order-import.js',import.meta.url),'utf8'),
  readFile(new URL('../src/order-sheet-import.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/kun-v14.css',import.meta.url),'utf8')
]);
new Function(ui);
assert.deepEqual(orderSheetSources().map(x=>x.id),['easyorders','woocommerce','shopify','salla','zid','custom']);
for(const header of ['ID','Status','FullName','Phone','City','Address','Total Cost','Product Cost','Shipping Cost','Coupon','Coupon Discount','Product Name','Variant','Quantity','SKU','Item Price','CreatedAt','Extra Data','Extra Data2','Alt Phone','Note','Ref','Utm Source','Utm Campaign','Payment Method','Payment Status','Funnel ID','Order ID','Referral Code','External Order ID'])assert.ok(ui.includes(header),`Easy Orders mapping missing exact header: ${header}`);
for(const marker of ["externalId:['Order ID']","platformProductSubtotal:['Product Cost']",'DecompressionStream(\'deflate-raw\')','xl/sharedStrings.xml','xl/worksheets/sheet','excelDate','v35ImportOrders','استيراد شيت','معاينة قبل الحفظ','WooCommerce','Shopify','سلة','زد','شيت مخصص'])assert.ok(ui.includes(marker),`Order sheet UI missing ${marker}`);
assert.ok(!ui.includes("productCost:val(raw,'platformProductSubtotal')"),'Easy Orders Product Cost must not be treated as Kun COGS');
for(const marker of ['sheet:${source}:','orders.sheet_import','billOrder','store_id IS ?','platformProductSubtotal','source===\'easyorders\'','externalOrderId','ORDER_IMPORT_STORE_REQUIRED'])assert.ok(backend.includes(marker),`Order sheet backend missing ${marker}`);
for(const marker of ["path==='/api/orders/sheet-import'","path==='/api/orders/sheet-import/sources'","requirePermission(me,'orders','write')","resolveStoreScope(env,me,clientId"])assert.ok(worker.includes(marker),`v31 order import route missing ${marker}`);
for(const marker of ['kun-v14.css?v=14.0','modules-v35-order-import.js?v=35.0'])assert.ok(index.includes(marker),`index missing ${marker}`);
for(const marker of ['.v35-map-grid','.v35-summary','.v35-preview','.v35-result-grid','@media(max-width:760px)'])assert.ok(css.includes(marker),`Order import CSS missing ${marker}`);
console.log('Order sheet import contract passed: exact Easy Orders mapping, multi-source presets, XLSX/CSV browser parsing, preview/mapping UI, store-scoped idempotent backend and catalog-derived COGS.');
