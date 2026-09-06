-- Preview-only POS foundation
CREATE TABLE IF NOT EXISTS pos_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  register_name TEXT,
  opened_by TEXT,
  opened_at TEXT NOT NULL,
  opening_cash REAL DEFAULT 0,
  closed_by TEXT,
  closed_at TEXT,
  closing_cash REAL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_client ON pos_sessions(client_id,status,opened_at);

CREATE TABLE IF NOT EXISTS pos_sales (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  session_id TEXT,
  customer_id TEXT,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pos_sales_client ON pos_sales(client_id,created_at);

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  product_name TEXT,
  sku TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pos_items_sale ON pos_sale_items(sale_id);
