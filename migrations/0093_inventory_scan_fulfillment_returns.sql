-- v129 serialized fulfillment scanning and return inspection.
-- Additive only. Runtime bootstrap creates the same tables in Production, where deploys remain migration-free.

CREATE TABLE IF NOT EXISTS inventory_scan_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT NOT NULL,
  scan_context TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  order_scan_code TEXT,
  expected_units INTEGER NOT NULL DEFAULT 0,
  scanned_units INTEGER NOT NULL DEFAULT 0,
  awb TEXT,
  actor TEXT,
  actor_user_id TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_scan_sessions_order
ON inventory_scan_sessions(client_id,order_id,scan_context,status,updated_at);

CREATE TABLE IF NOT EXISTS inventory_scan_events (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT,
  unit_id TEXT,
  unit_code TEXT,
  scan_context TEXT NOT NULL,
  scan_kind TEXT NOT NULL,
  result TEXT NOT NULL,
  awb TEXT,
  actor TEXT,
  actor_user_id TEXT,
  device_id TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_scan_events_order
ON inventory_scan_events(client_id,order_id,scan_context,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_scan_events_unit
ON inventory_scan_events(client_id,unit_id,created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_scan_events_session
ON inventory_scan_events(session_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_scan_unit_accept_unique
ON inventory_scan_events(session_id,unit_id,scan_kind)
WHERE unit_id IS NOT NULL AND result='accepted';
