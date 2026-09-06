-- Preview-only SaaS control plane foundation
CREATE TABLE IF NOT EXISTS tenant_settings (
  client_id TEXT PRIMARY KEY,
  display_name TEXT,
  timezone TEXT DEFAULT 'Africa/Cairo',
  currency TEXT DEFAULT 'EGP',
  locale TEXT DEFAULT 'ar-EG',
  plan TEXT DEFAULT 'trial',
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'trialing',
  billing_cycle TEXT DEFAULT 'monthly',
  amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'EGP',
  period_start TEXT,
  period_end TEXT,
  provider TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions(client_id,status,period_end);

CREATE TABLE IF NOT EXISTS usage_daily (
  client_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  orders_count INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  ai_actions INTEGER DEFAULT 0,
  automation_runs INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  storage_bytes INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(client_id,usage_date)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'open',
  created_by TEXT,
  assigned_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_client ON support_tickets(client_id,status,created_at);

CREATE TABLE IF NOT EXISTS store_connections (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  store_name TEXT,
  external_store_id TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  scopes_json TEXT DEFAULT '[]',
  config_json TEXT DEFAULT '{}',
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_connection_unique ON store_connections(client_id,provider,external_store_id);
