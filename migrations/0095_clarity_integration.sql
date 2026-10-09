-- Microsoft Clarity: per-store encrypted project integration + aggregate 24h snapshots.
-- Preview only. This migration must not target production D1.
CREATE TABLE IF NOT EXISTS clarity_connections (
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  token_ciphertext_b64 TEXT,
  token_iv_b64 TEXT,
  status TEXT NOT NULL DEFAULT 'configured',
  last_sync_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  quota_day TEXT,
  quota_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(client_id, store_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clarity_project_unique ON clarity_connections(project_id);
CREATE INDEX IF NOT EXISTS idx_clarity_sync_due ON clarity_connections(last_attempt_at,last_sync_at);

CREATE TABLE IF NOT EXISTS clarity_snapshots (
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  campaign_json TEXT NOT NULL,
  device_json TEXT NOT NULL,
  PRIMARY KEY(client_id, store_id, synced_at)
);
CREATE INDEX IF NOT EXISTS idx_clarity_history ON clarity_snapshots(client_id, store_id, synced_at DESC);
