import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCHEMA_SQL,extractSchemaRows,rehearseSchema,buildMigrationFiles} from './preview-live-schema-rehearsal.mjs';

assert.match(SCHEMA_SQL,/SELECT type,name,sql FROM sqlite_master/);
assert.ok(!/\b(UPDATE|DELETE|INSERT|REPLACE|DROP|ALTER)\b/i.test(SCHEMA_SQL));
assert.ok(!/SELECT\s+\*/i.test(SCHEMA_SQL));
const rows=[
  {type:'trigger',name:'order_creation_guard',sql:"CREATE TRIGGER order_creation_guard AFTER INSERT ON orders BEGIN SELECT 1; END"},
  {type:'index',name:'idx_orders_client',sql:'CREATE INDEX idx_orders_client ON orders(client_id)'},
  {type:'table',name:'orders',sql:'CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT)'},
];
assert.equal(extractSchemaRows([{success:true,results:rows}]).length,3);
assert.throws(()=>extractSchemaRows([{success:true,results:[]}]),/empty/);
assert.throws(()=>extractSchemaRows([{success:false,results:rows}]),/not successful/);
assert.throws(()=>extractSchemaRows([{results:[{type:'table',name:'orders',sql:null}]}]),/Malformed/);
assert.throws(()=>extractSchemaRows([{results:[{type:'table',name:'products',sql:'CREATE TABLE products(id TEXT)'}]}]),/missing orders/);
assert.throws(()=>extractSchemaRows([{results:[...rows,rows[0]]}]),/Duplicate/);
const files=buildMigrationFiles([
  'migrations/0092_inventory_unit_qr_tracking.sql',
  'migrations/0093_inventory_scan_fulfillment_returns.sql',
  'migrations/0094_warehouse_unit_operations.sql'
]);
const success=rehearseSchema(rows,files);
assert.equal(success.ok,true);
assert.equal(success.existingDeclarations,3);
assert.deepEqual(success.applied,files.map(x=>x.name));
assert.throws(()=>rehearseSchema(rows,[{name:'migrations/0092_unit.sql',sql:'INSERT INTO orders(id) VALUES (1); INSERT INTO orders(id) VALUES (1);'}]),/rehearsal failed/);
assert.throws(()=>rehearseSchema(rows,[{name:'migrations/0092_unit.sql',sql:'DROP TABLE IF EXISTS unknown; ALTER TABLE missing_table ADD COLUMN x;'}]),/rehearsal failed/);
assert.throws(()=>buildMigrationFiles(['../../sensitive.txt']),/refused/);
assert.throws(()=>rehearseSchema(rows,[]),/No explicitly reviewed migrations/);
const gate=readFileSync('scripts/preview-db-release-preflight.sh','utf8');
assert(!gate.includes('wrangler d1 export'),'D1 export is disruptive and must never run during shared DB release');
assert(gate.includes('node scripts/preview-live-schema-rehearsal.mjs'));
console.log('Live schema introspection migration rehearsal PASS: no remote export, ordered DDL, real 0092-0094 migration fixtures.');
