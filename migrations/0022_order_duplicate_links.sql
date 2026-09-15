-- Canonical duplicate registry for orders that arrived from both a manual Easy Orders sheet and live Easy Orders sync.
-- We keep the original rows for audit/reversibility and exclude the linked duplicate from operational/reporting reads.
CREATE TABLE IF NOT EXISTS order_duplicate_links (
  duplicate_order_id TEXT PRIMARY KEY,
  canonical_order_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT,
  provider TEXT NOT NULL DEFAULT 'easyorders',
  match_mode TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_duplicate_links_scope
  ON order_duplicate_links(client_id,store_id,provider);
CREATE INDEX IF NOT EXISTS idx_order_duplicate_links_canonical
  ON order_duplicate_links(canonical_order_id);
