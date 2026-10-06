-- Unit-level inventory lineage and QR tracking.
-- Additive only: no existing inventory/order data is deleted or rewritten.
CREATE TABLE IF NOT EXISTS product_tracking_codes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_tracking_code_unique
ON product_tracking_codes(client_id,code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_tracking_entity_unique
ON product_tracking_codes(client_id,product_id,COALESCE(variant_id,''));

CREATE TABLE IF NOT EXISTS inventory_units (
  id TEXT PRIMARY KEY,
  unit_code TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  batch_id TEXT,
  batch_item_id TEXT,
  product_name TEXT,
  sku TEXT,
  status TEXT NOT NULL DEFAULT 'in_stock',
  current_order_id TEXT,
  last_order_id TEXT,
  received_at TEXT,
  reserved_at TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  returned_at TEXT,
  retired_at TEXT,
  source TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unit_code_unique
ON inventory_units(client_id,unit_code);
CREATE INDEX IF NOT EXISTS idx_inventory_units_stock
ON inventory_units(client_id,store_id,product_id,variant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_units_batch
ON inventory_units(client_id,batch_item_id,status);
CREATE INDEX IF NOT EXISTS idx_inventory_units_order
ON inventory_units(client_id,current_order_id,status);

CREATE TABLE IF NOT EXISTS inventory_unit_events (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  source TEXT,
  actor TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_unit
ON inventory_unit_events(client_id,unit_id,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_code
ON inventory_unit_events(client_id,unit_code,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_order
ON inventory_unit_events(client_id,order_id,created_at);

CREATE TABLE IF NOT EXISTS order_unit_allocations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT NOT NULL,
  order_item_id TEXT,
  stock_allocation_id TEXT,
  unit_id TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  released_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_unit_unique
ON order_unit_allocations(order_id,unit_id);
CREATE INDEX IF NOT EXISTS idx_order_unit_order
ON order_unit_allocations(client_id,order_id,status);
CREATE INDEX IF NOT EXISTS idx_order_unit_unit
ON order_unit_allocations(client_id,unit_id,created_at);
