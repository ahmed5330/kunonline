-- Preview migration: COD reconciliation foundation
-- Additive only. Applied by Preview CI/CD to kunonline-preview.

CREATE TABLE IF NOT EXISTS cod_reconciliations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open / reconciled / disputed / cancelled
  expected_amount REAL NOT NULL DEFAULT 0,
  actual_amount REAL,
  difference REAL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  reconciled_at TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cod_recon_client_time ON cod_reconciliations(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cod_recon_status ON cod_reconciliations(client_id, status);

CREATE TABLE IF NOT EXISTS cod_reconciliation_items (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  awb TEXT,
  expected_amount REAL NOT NULL DEFAULT 0,
  actual_amount REAL,
  difference REAL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending / matched / short / over / disputed
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cod_recon_order_unique ON cod_reconciliation_items(client_id, order_id);
CREATE INDEX IF NOT EXISTS idx_cod_recon_items_batch ON cod_reconciliation_items(reconciliation_id);
