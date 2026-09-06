-- Named inventory batches / stock lots.
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  name TEXT NOT NULL,
  stock_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_scope ON inventory_batches(client_id,store_id,stock_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_status ON inventory_batches(client_id,store_id,status);

CREATE TABLE IF NOT EXISTS inventory_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT,
  product_id TEXT,
  variant_id TEXT,
  product_name TEXT NOT NULL,
  initial_qty REAL NOT NULL DEFAULT 0,
  remaining_qty REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_batch_item_unique ON inventory_batch_items(batch_id,product_id,COALESCE(variant_id,''));
CREATE INDEX IF NOT EXISTS idx_inventory_batch_items_scope ON inventory_batch_items(client_id,store_id,product_id,batch_id);

CREATE TABLE IF NOT EXISTS order_stock_allocations (
  order_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  batch_id TEXT NOT NULL,
  batch_item_id TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  qty REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'allocated',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_stock_alloc_scope ON order_stock_allocations(client_id,store_id,batch_id,status);

ALTER TABLE stock_log ADD COLUMN batch_id TEXT;
ALTER TABLE stock_log ADD COLUMN batch_name TEXT;
