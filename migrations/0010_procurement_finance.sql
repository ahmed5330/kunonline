-- Preview-only procurement finance and returns foundation.
-- D1-compatible: schema only. Runtime stock validation/decrement belongs in
-- the Worker layer; multi-statement CREATE TRIGGER bodies are intentionally
-- avoided because Wrangler remote migrations can reject them as incomplete SQL.

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  purchase_order_id TEXT,
  invoice_number TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  currency TEXT DEFAULT 'EGP',
  status TEXT NOT NULL DEFAULT 'unpaid',
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_client ON supplier_invoices(client_id,supplier_id,status,due_date);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  invoice_id TEXT,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'EGP',
  method TEXT,
  reference TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_client ON supplier_payments(client_id,supplier_id,payment_date);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  purchase_order_id TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  total REAL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_client ON purchase_returns(client_id,supplier_id,created_at);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  product_name TEXT,
  qty INTEGER NOT NULL,
  unit_cost REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items ON purchase_return_items(return_id);
