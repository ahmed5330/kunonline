-- Preview-safe system controls: two-step undo and password-protected per-client reset center.
CREATE TABLE IF NOT EXISTS system_undo_actions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  label TEXT,
  before_json TEXT NOT NULL,
  after_json TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  created_by TEXT,
  created_at TEXT NOT NULL,
  undone_by TEXT,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_undo_scope ON system_undo_actions(client_id,store_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS section_reset_credentials (
  client_id TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 120000,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS section_reset_log (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  section_id TEXT NOT NULL,
  actor TEXT,
  created_at TEXT NOT NULL,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_section_reset_log_scope ON section_reset_log(client_id,store_id,created_at DESC);
