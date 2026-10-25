// Real 0092-0094 migration SQL on isolated, synthetic SQLite fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const db=new DatabaseSync(':memory:');
const migrations=[
  '0092_inventory_unit_qr_tracking.sql',
  '0093_inventory_scan_fulfillment_returns.sql',
  '0094_warehouse_unit_operations.sql'
];
for(const filename of migrations) db.exec(fs.readFileSync(new URL('./fixtures/inventory/'+filename,import.meta.url),'utf8'));
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
for(const table of [
  'inventory_units','inventory_unit_events','order_unit_allocations','inventory_scan_events',
  'inventory_return_cases','inventory_exchange_cases','inventory_shipments','inventory_shipment_units'
]) assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n,1,table);
const t='2026-10-15T12:00:00Z';
const createUnit=(id,client)=>db.prepare(
  'INSERT INTO inventory_units(id,unit_code,client_id,store_id,product_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
).run(id,id+'-QR',client,'STORE','PRODUCT','in_stock',t,t);
createUnit('u1','TENANT');
createUnit('u2','OTHER');
const allocate=(id,client,order,unit)=>db.prepare(
  "INSERT INTO order_unit_allocations(id,client_id,order_id,unit_id,unit_code,status,created_at,updated_at) VALUES(?,?,?,?,?,'reserved',?,?)"
).run(id,client,order,unit,unit+'-QR',t,t);
allocate('a1','TENANT','ORDER1','u1');
assert.throws(()=>allocate('a2','TENANT','ORDER2','u1'),/UNIT_ACTIVE_ALLOCATION_CONFLICT/);
allocate('a3','OTHER','ORDER2','u2');
db.prepare(
  "INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,event_type,created_at) VALUES(?,?,?,?,?,?)"
).run('event1','u1','u1-QR','TENANT','received',t);
assert.throws(()=>db.prepare("UPDATE inventory_unit_events SET event_type='shipped' WHERE id='event1'").run(),/UNIT_AUDIT_IMMUTABLE/);
assert.throws(()=>db.prepare("DELETE FROM inventory_unit_events WHERE id='event1'").run(),/UNIT_AUDIT_IMMUTABLE/);
for(const filename of migrations) db.exec(fs.readFileSync(new URL('./fixtures/inventory/'+filename,import.meta.url),'utf8'));
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_units").get().n,2,'No duplicated units during repeat migration');
assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_unit_events").get().n,1,'No rewritten audit history');
db.close();
console.log('Inventory migrations 0092-0094 PASS: additive, repeatable, tenant-scoped allocation guard, immutable audit');
