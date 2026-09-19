CREATE TABLE IF NOT EXISTS meta_ad_entities (
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL CHECK(level IN ('adset','ad')),
  external_id TEXT NOT NULL,
  external_campaign_id TEXT,
  external_adset_id TEXT,
  name TEXT NOT NULL,
  status TEXT,
  effective_status TEXT,
  optimization_goal TEXT,
  budget REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  created_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_id, store_id, level, external_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_entities_scope
  ON meta_ad_entities(client_id, store_id, level, external_campaign_id, external_adset_id);

CREATE TABLE IF NOT EXISTS meta_ad_daily_metrics (
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL CHECK(level IN ('adset','ad')),
  external_id TEXT NOT NULL,
  external_campaign_id TEXT,
  external_adset_id TEXT,
  metric_date TEXT NOT NULL,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  leads REAL NOT NULL DEFAULT 0,
  purchases REAL NOT NULL DEFAULT 0,
  purchase_value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_id, store_id, level, external_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_metrics_scope_date
  ON meta_ad_daily_metrics(client_id, store_id, level, metric_date, external_campaign_id, external_adset_id);
