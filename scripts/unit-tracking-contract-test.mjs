import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const backend=await readFile(new URL('../src/inventory-unit-tracking.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0092_inventory_unit_qr_tracking.sql',import.meta.url),'utf8');
const scanMigration=await readFile(new URL('../migrations/0093_inventory_scan_fulfillment_returns.sql',import.meta.url),'utf8');
const jtPrint=await readFile(new URL('../src/jt-print-workflow-v2.js',import.meta.url),'utf8');
const legacyIndex=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const fifo=await readFile(new URL('../src/inventory-fifo.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v128-unit-tracking.js',import.meta.url),'utf8');
const preview=await readFile(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8');
const production=await readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
const v2Index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');

await import('../src/inventory-unit-tracking.js');
new Function(ui);

for(const table of ['inventory_scan_sessions','inventory_scan_events']){
  assert.ok(scanMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Scan migration missing ${table}`);
  assert.ok(backend.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Runtime scan schema missing ${table}`);
}
assert.ok(scanMigration.includes('idx_inventory_scan_unit_accept_unique'),'Accepted unit scans must be idempotent per session');

for(const table of ['product_tracking_codes','inventory_units','inventory_unit_events','order_unit_allocations']){
  assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Migration missing ${table}`);
  assert.ok(backend.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Runtime schema bootstrap missing ${table}`);
}

assert.ok(migration.includes('UNIQUE INDEX IF NOT EXISTS idx_inventory_unit_code_unique'),'Unit code must be unique per client');
assert.ok(migration.includes('UNIQUE INDEX IF NOT EXISTS idx_order_unit_unique'),'A physical unit must not be duplicated inside the same order');

for(const marker of [
  'return_received_pending_inspection',
  'return_restocked_after_inspection',
  'return_quarantined',
  'return_marked_damaged',
  'picked_and_packed_scan',
  'dispatch_scan_verified',
  'received_into_inventory',
  'reserved_for_order',
  'handed_to_shipping',
  'delivered_to_customer',
  'reservation_released',
  'manual_stock_out',
  'legacy_backfill_outbound',
  'legacy_backfill_recovered'
]) assert.ok((backend+await readFile(new URL('../src/inventory-warehouse-operations.js',import.meta.url),'utf8')).includes(marker),`Unit lifecycle missing ${marker}`);

for(const path of [
  '/api/inventory/stock-adjust',
  '/api/inventory/batches',
  '/api/products',
  '/api/commerce/product-import',
  '/receive',
  '/api/inventory/unit-tracking/summary',
  '/api/inventory/unit-tracking/reconcile',
  '/api/inventory/unit-tracking/lookup',
  '/api/inventory/unit-tracking/units',
  '/api/inventory/unit-tracking/qr',
  '/api/inventory/unit-tracking/barcode',
  '/api/inventory/unit-tracking/order-scan/open',
  '/api/inventory/unit-tracking/order-scan/status',
  '/api/inventory/unit-tracking/order-scan/unit',
  '/api/inventory/unit-tracking/returns',
  '/api/inventory/unit-tracking/returns/disposition'
]) assert.ok(backend.includes(path)||production.includes(path),`Unit tracking integration missing ${path}`);

assert.ok(backend.includes('api\\/jt\\/shipments\\/')&&backend.includes('\\/print$'),'J&T official print route must be a unit lifecycle boundary');
assert.ok(backend.includes("status IN ('legacy_outbound','in_stock','returned_in_stock')"),'Historical outbound pieces must remain claimable by pre-existing live allocations');
assert.ok(backend.includes('desiredAvailable')&&backend.includes('remaining_qty'),'Historical batch backfill must respect remaining physical stock, not initial quantity');
assert.ok(production.includes("if(String(event?.cron||'')==='0 */2 * * *'"),'Periodic uncoded-stock reconciliation must be protected by the two-hour cron');
assert.ok(backend.includes('reconcileTrackedOrderLifecycles'),'Background carrier/order changes must reconcile unit status');
assert.ok(backend.includes("return 'product_import'")&&backend.includes("actor:'product-import:'+actor"),'Imported stock must be unit-coded in the same successful request');
assert.ok(backend.includes('UNIT_TRACKING_STOCK_COVERAGE_MISMATCH')&&backend.includes('const target=Math.max(0,Math.floor(num(p.stock)))'),'Stock adjustments must reconcile idempotently against the final physical stock balance before returning');
assert.ok(backend.includes("source:'qr_lookup'"),'Scanning a unit must refresh its linked order before returning history');

assert.ok(!jtPrint.includes('await assertOrderScanReady'),'Official waybill creation must remain separate from physical packing/handover');
assert.ok(backend.includes("target='returned_pending_inspection'"),'Returned orders must enter pending inspection, never sellable stock directly');
assert.ok(backend.includes("['restock','quarantine','damaged']"),'Return disposition must support restock, quarantine and damaged');
assert.ok(backend.includes("scope==='warehouse'")&&backend.includes("'reserved','returned_pending_inspection','quarantined','damaged'")&&backend.includes('Math.min(10000'),'Bulk label printing must include every physical warehouse unit, including reserved and return-inspection pieces');
assert.ok(legacyIndex.includes('is now the only path that restores stock for new returns'),'Legacy order return transition must no longer auto-restock new returns');
assert.ok(fifo.includes("if(toState==='returned')return {kind:'return_pending_inspection'"),'FIFO must keep returned stock outside sellable lots until inspection');

assert.ok(backend.includes('https://app.kun-online.com/v2/?unit='),'QR payload must point to the authenticated Kun Online unit-history route');
assert.ok(backend.includes("barcodeValue:barcodeValue")&&backend.includes("type','code128'"),'Every unit must expose a Code 128 barcode using the same Unit Code');
assert.ok(!backend.includes('name,phone,date,created_at,return_type FROM orders'),'Unit lookup must not expose customer name/phone merely to render tracking history');

for(const marker of ['BarcodeDetector','getUserMedia','code_128','/api/inventory/unit-tracking/lookup','/api/inventory/unit-tracking/qr','/api/inventory/unit-tracking/barcode','data-unit-code','طباعة QR + باركود','History / خط السير']){
  assert.ok(ui.includes(marker),`Unit tracking UI missing ${marker}`);
}
assert.ok(ui.includes("legacy_outbound:'حركة تاريخية خارج المخزون'"),'Historical outbound units need a visible non-stock status');

for(const source of [preview,production,v2Index]){
  assert.ok(source.includes('/v2/modules-v128-unit-tracking.js?v=128.4'),'v128 tracking UI must be loaded by every canonical app shell');
}
for(const source of [preview,production]){
  assert.ok(source.includes('handleInventoryUnitTracking'),'Tracking APIs/mutations must be intercepted');
  assert.ok(source.includes('syncInventoryTrackingAfterResponse'),'Order lifecycle responses must update exact units');
  assert.ok(source.includes('reconcileTrackedOrderLifecycles'),'Scheduled lifecycle reconciliation must stay wired');
  assert.ok(source.includes('reconcileAllClientsUnitCoverage'),'Scheduled uncoded stock reconciliation must stay wired');
}

assert.ok(ui.includes("new URL(location.href).searchParams.get('unit')"),'Opening a printed QR URL must automatically resolve its unit history');

assert.ok(ui.includes("version:'128.4'")&&ui.includes('طباعة باركود كل القطع الموجودة بالمخزن')&&ui.includes("scope:'warehouse'"),'Unit tracking UI must identify v128.4 and bulk-print current stock');
console.log('Unit tracking v128.4 contract passed: bulk labels, scan-to-pack/dispatch, AWB linkage and inspected return disposition are enforced.');
