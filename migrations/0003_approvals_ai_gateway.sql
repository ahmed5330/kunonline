-- Preview-only: approval center + AI action gateway
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'workflow',
  source_id TEXT,
  action_type TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'sensitive',
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_client_status ON approval_requests(client_id,status,requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_idempotency ON approval_requests(client_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_action_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  risk TEXT NOT NULL DEFAULT 'safe',
  status TEXT NOT NULL DEFAULT 'proposed',
  approval_request_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_action_client_status ON ai_action_requests(client_id,status,created_at);
