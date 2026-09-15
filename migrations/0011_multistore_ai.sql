-- Multi-store + AI insight foundation for Preview.
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  currency TEXT DEFAULT 'EGP',
  timezone TEXT DEFAULT 'Africa/Cairo',
  status TEXT DEFAULT 'active',
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_client_code ON stores(client_id, code);
CREATE INDEX IF NOT EXISTS idx_stores_client_status ON stores(client_id, status);

CREATE TABLE IF NOT EXISTS user_store_access (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  role TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_store_unique ON user_store_access(client_id,user_id,store_id);
CREATE INDEX IF NOT EXISTS idx_user_store_lookup ON user_store_access(user_id,client_id);

CREATE TABLE IF NOT EXISTS ai_insight_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  insight_type TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  title TEXT NOT NULL,
  rationale TEXT,
  metric_json TEXT DEFAULT '{}',
  suggested_action_type TEXT,
  suggested_payload_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  generated_at TEXT NOT NULL,
  dismissed_at TEXT,
  dismissed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_client ON ai_insight_snapshots(client_id,status,generated_at);
CREATE INDEX IF NOT EXISTS idx_ai_insights_store ON ai_insight_snapshots(client_id,store_id,status);
