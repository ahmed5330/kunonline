-- Preserve imported order line items and their idempotent inventory allocations.
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT,
  line_key TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  sku TEXT,
  product_name TEXT NOT NULL,
  variant_label TEXT,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  line_total REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_line ON order_items(order_id,line_key);
CREATE INDEX IF NOT EXISTS idx_order_items_scope ON order_items(client_id,store_id,order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(client_id,store_id,product_id,variant_id);

CREATE TABLE IF NOT EXISTS order_item_stock_allocations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT,
  batch_id TEXT NOT NULL,
  batch_item_id TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  qty REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'allocated',
  stock_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_item_alloc_order ON order_item_stock_allocations(client_id,store_id,order_id,status);
CREATE INDEX IF NOT EXISTS idx_order_item_alloc_item ON order_item_stock_allocations(order_item_id,status);
CREATE INDEX IF NOT EXISTS idx_order_item_alloc_batch ON order_item_stock_allocations(batch_id,batch_item_id,status);
