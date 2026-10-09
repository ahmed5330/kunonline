-- AI Marketing Analyst: isolate model reports by tenant and store; strictly limited daily slots.
CREATE TABLE IF NOT EXISTS ai_marketing_reports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),
  window_days INTEGER NOT NULL CHECK(window_days IN (1,2,3)),
  status TEXT NOT NULL CHECK(status IN ('running','ready','failed')),
  model TEXT NOT NULL,
  report_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id,store_id,usage_day,slot)
);
CREATE INDEX IF NOT EXISTS idx_ai_marketing_store_recent ON ai_marketing_reports(client_id,store_id,created_at DESC);
