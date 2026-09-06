-- kun online Commerce OS foundation migration
-- Safe additive tables for procurement, automation, audit and channel attribution.

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft/sent/partial/received/cancelled
  order_date TEXT NOT NULL,
  expected_date TEXT,
  currency TEXT DEFAULT 'EGP',
  subtotal REAL DEFAULT 0,
  shipping_cost REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_client_date ON purchase_orders(client_id, order_date);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  product_name TEXT,
  sku TEXT,
  qty_ordered INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  supplier_id TEXT,
  received_at TEXT NOT NULL,
  received_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_po ON goods_receipts(purchase_order_id, received_at);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  purchase_order_item_id TEXT,
  product_id TEXT,
  variant_id TEXT,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON goods_receipt_items(receipt_id);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  definition_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflows_client ON workflows(client_id, active);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trigger_entity_type TEXT,
  trigger_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  log_json TEXT DEFAULT '[]',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_client ON workflow_runs(client_id, started_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_client_time ON audit_log(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS marketing_touchpoints (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  customer_id TEXT,
  order_id TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  adset TEXT,
  ad TEXT,
  platform TEXT,
  click_id TEXT,
  session_id TEXT,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_touch_client_time ON marketing_touchpoints(client_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_touch_order ON marketing_touchpoints(order_id);
CREATE INDEX IF NOT EXISTS idx_touch_customer ON marketing_touchpoints(customer_id, occurred_at);
