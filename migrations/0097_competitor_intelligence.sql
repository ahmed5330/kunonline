-- Competitor Intelligence v139: separate store-scoped reports and API search usage.
CREATE TABLE IF NOT EXISTS competitor_analysis_reports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),
  input_hash TEXT NOT NULL,
  competitor_name TEXT NOT NULL,
  country TEXT NOT NULL,
  ad_url TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','ready','failed')),
  report_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id,store_id,usage_day,slot)
);
CREATE INDEX IF NOT EXISTS idx_competitor_analysis_store ON competitor_analysis_reports(client_id,store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_analysis_cache ON competitor_analysis_reports(client_id,store_id,input_hash,status,created_at DESC);
CREATE TABLE IF NOT EXISTS competitor_library_search_usage (
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count BETWEEN 0 AND 20),
  PRIMARY KEY(client_id,store_id,usage_day)
);
