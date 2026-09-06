-- Kun Online accounting + management percentage. Preview-only additive migration.
-- Production remains untouched by the Preview workflow.

ALTER TABLE stores ADD COLUMN management_fee_pct REAL NOT NULL DEFAULT 0 CHECK (management_fee_pct >= 0 AND management_fee_pct <= 100);

CREATE TABLE IF NOT EXISTS order_management_fees (
  order_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  rate_pct REAL NOT NULL DEFAULT 0,
  base_amount REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inactive',
  activated_at TEXT,
  reversed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (rate_pct >= 0 AND rate_pct <= 100),
  CHECK (base_amount >= 0),
  CHECK (amount >= 0),
  CHECK (status IN ('inactive','active','reversed'))
);
CREATE INDEX IF NOT EXISTS idx_order_management_fee_store ON order_management_fees(client_id,store_id,status,updated_at);

ALTER TABLE transactions ADD COLUMN document_no TEXT;
ALTER TABLE transactions ADD COLUMN counterparty TEXT;
ALTER TABLE transactions ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN due_date TEXT;
ALTER TABLE transactions ADD COLUMN reference_type TEXT;
ALTER TABLE transactions ADD COLUMN reference_id TEXT;
ALTER TABLE transactions ADD COLUMN attachment_url TEXT;
ALTER TABLE transactions ADD COLUMN metadata_json TEXT DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(client_id,store_id,reference_type,reference_id);
