import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const backend=await readFile(new URL('../src/inventory-unit-tracking.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0092_inventory_unit_qr_tracking.sql',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v128-unit-tracking.js',import.meta.url),'utf8');
const preview=await readFile(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8');
const production=await readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
const v2Index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');

await import('../src/inventory-unit-tracking.js');
new Function(ui);

for(const table of ['product_tracking_codes','inventory_units','inventory_unit_events','order_unit_allocations']){
  assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Migration missing ${table}`);
  assert.ok(backend.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Runtime schema bootstrap missing ${table}`);
}

assert.ok(migration.includes('UNIQUE INDEX IF NOT EXISTS idx_inventory_unit_code_unique'),'Unit code must be unique per client');
assert.ok(migration.includes('UNIQUE INDEX IF NOT EXISTS idx_order_unit_unique'),'A physical unit must not be duplicated inside the same order');

for(const marker of [
  'received_into_inventory',
  'reserved_for_order',
  'handed_to_shipping',
  'delivered_to_customer',
  'returned_to_inventory',
  'reservation_released',
  'manual_stock_out',
  'legacy_backfill_outbound',
  'legacy_backfill_recovered'
]) assert.ok(backend.includes(marker),`Unit lifecycle missing ${marker}`);

for(const path of [
  '/api/inventory/stock-adjust',
  '/api/inventory/batches',
  '/api/products',
  '/receive',
  '/api/inventory/unit-tracking/summary',
  '/api/inventory/unit-tracking/reconcile',
  '/api/inventory/unit-tracking/lookup',
  '/api/inventory/unit-tracking/units',
  '/api/inventory/unit-tracking/qr'
]) assert.ok(backend.includes(path)||production.includes(path),`Unit tracking integration missing ${path}`);
assert.ok(backend.includes('api\\/jt\\/shipments\\/')&&backend.includes('\\/print

assert.ok(backend.includes("status IN ('legacy_outbound','in_stock','returned_in_stock')"),'Historical outbound pieces must remain claimable by pre-existing live allocations');
assert.ok(backend.includes('desiredAvailable')&&backend.includes('remaining_qty'),'Historical batch backfill must respect remaining physical stock, not initial quantity');
assert.ok(backend.includes("if(String(event?.cron||'')==='0 */2 * * *'")||production.includes("if(String(event?.cron||'')==='0 */2 * * *'"),'Periodic uncoded-stock reconciliation must be protected by the two-hour cron');
assert.ok(backend.includes('reconcileTrackedOrderLifecycles'),'Background carrier/order changes must reconcile unit status');
assert.ok(backend.includes("source:'qr_lookup'"),'Scanning a unit must refresh its linked order before returning history');

assert.ok(backend.includes('https://app.kun-online.com/v2/?unit='),'QR payload must point to the authenticated Kun Online unit-history route');
assert.ok(!backend.includes('name,phone,date,created_at,return_type FROM orders'),'Unit lookup must not expose customer name/phone merely to render tracking history');

for(const marker of ['BarcodeDetector','getUserMedia','/api/inventory/unit-tracking/lookup','/api/inventory/unit-tracking/qr','data-unit-code','طباعة QR','History / خط السير']){
  assert.ok(ui.includes(marker),`Unit tracking UI missing ${marker}`);
}
assert.ok(ui.includes("legacy_outbound:'حركة تاريخية خارج المخزون'"),'Historical outbound units need a visible non-stock status');

for(const source of [preview,production,v2Index])assert.ok(source.includes('/v2/modules-v128-unit-tracking.js?v=128.0'),'v128 tracking UI must be loaded by every canonical app shell');
for(const source of [preview,production]){
  assert.ok(source.includes('handleInventoryUnitTracking'),'Tracking APIs/mutations must be intercepted');
  assert.ok(source.includes('syncInventoryTrackingAfterResponse'),'Order lifecycle responses must update exact units');
  assert.ok(source.includes('reconcileTrackedOrderLifecycles'),'Scheduled lifecycle reconciliation must stay wired');
  assert.ok(source.includes('reconcileAllClientsUnitCoverage'),'Scheduled uncoded stock reconciliation must stay wired');
}

assert.ok(production.includes("if(String(event?.cron||'')==='0 */2 * * *'"),'Production must only run full stock coverage reconciliation on the two-hour cron');
assert.ok(ui.includes("new URL(location.href).searchParams.get('unit')"),'Opening a printed QR URL must automatically resolve its unit history');

console.log('Unit tracking v128 contract passed: every physical unit has a unique code/QR, lifecycle lineage, scan history and stock coverage reconciliation.');
),'J&T official print route must be a unit lifecycle boundary');

assert.ok(backend.includes("status IN ('legacy_outbound','in_stock','returned_in_stock')"),'Historical outbound pieces must remain claimable by pre-existing live allocations');
assert.ok(backend.includes('desiredAvailable')&&backend.includes('remaining_qty'),'Historical batch backfill must respect remaining physical stock, not initial quantity');
assert.ok(backend.includes("if(String(event?.cron||'')==='0 */2 * * *'")||production.includes("if(String(event?.cron||'')==='0 */2 * * *'"),'Periodic uncoded-stock reconciliation must be protected by the two-hour cron');
assert.ok(backend.includes('reconcileTrackedOrderLifecycles'),'Background carrier/order changes must reconcile unit status');
assert.ok(backend.includes("source:'qr_lookup'"),'Scanning a unit must refresh its linked order before returning history');

assert.ok(backend.includes('https://app.kun-online.com/v2/?unit='),'QR payload must point to the authenticated Kun Online unit-history route');
assert.ok(!backend.includes('name,phone,date,created_at,return_type FROM orders'),'Unit lookup must not expose customer name/phone merely to render tracking history');

for(const marker of ['BarcodeDetector','getUserMedia','/api/inventory/unit-tracking/lookup','/api/inventory/unit-tracking/qr','data-unit-code','طباعة QR','History / خط السير']){
  assert.ok(ui.includes(marker),`Unit tracking UI missing ${marker}`);
}
assert.ok(ui.includes("legacy_outbound:'حركة تاريخية خارج المخزون'"),'Historical outbound units need a visible non-stock status');

for(const source of [preview,production,v2Index])assert.ok(source.includes('/v2/modules-v128-unit-tracking.js?v=128.0'),'v128 tracking UI must be loaded by every canonical app shell');
for(const source of [preview,production]){
  assert.ok(source.includes('handleInventoryUnitTracking'),'Tracking APIs/mutations must be intercepted');
  assert.ok(source.includes('syncInventoryTrackingAfterResponse'),'Order lifecycle responses must update exact units');
  assert.ok(source.includes('reconcileTrackedOrderLifecycles'),'Scheduled lifecycle reconciliation must stay wired');
  assert.ok(source.includes('reconcileAllClientsUnitCoverage'),'Scheduled uncoded stock reconciliation must stay wired');
}

assert.ok(production.includes("if(String(event?.cron||'')==='0 */2 * * *'"),'Production must only run full stock coverage reconciliation on the two-hour cron');
assert.ok(ui.includes("new URL(location.href).searchParams.get('unit')"),'Opening a printed QR URL must automatically resolve its unit history');

console.log('Unit tracking v128 contract passed: every physical unit has a unique code/QR, lifecycle lineage, scan history and stock coverage reconciliation.');
