-- Preview-only operational reliability layer
CREATE TABLE IF NOT EXISTS execution_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT,
  last_error TEXT,
  available_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_jobs_idempotency ON execution_jobs(client_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_execution_jobs_queue ON execution_jobs(client_id,status,available_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  entity_type TEXT,
  entity_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_client ON notifications(client_id,read_at,created_at);

CREATE TABLE IF NOT EXISTS integration_health (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  latency_ms INTEGER,
  metadata_json TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(client_id,provider)
);
CREATE INDEX IF NOT EXISTS idx_integration_health_client ON integration_health(client_id,status);
