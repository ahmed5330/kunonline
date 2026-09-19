-- Kun Online v27 — additive Preview migration only.
-- Control plane, feature entitlements, atomic wallet billing, order timeline,
-- real marketing attribution, Ad Studio and AI intelligence persistence.

CREATE TABLE IF NOT EXISTS tenant_modules (
  client_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  per_order_fee_delta REAL NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  configured_by TEXT,
  configured_at TEXT NOT NULL,
  PRIMARY KEY (client_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_modules_enabled ON tenant_modules(client_id,enabled,module_key);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  client_id TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  base_order_fee REAL NOT NULL DEFAULT 2,
  min_order_fee REAL NOT NULL DEFAULT 2,
  max_order_fee REAL NOT NULL DEFAULT 5,
  credit_limit REAL NOT NULL DEFAULT 0,
  billing_version TEXT NOT NULL DEFAULT 'legacy',
  billing_start_rowid INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL,
  CHECK (min_order_fee >= 0),
  CHECK (max_order_fee >= min_order_fee),
  CHECK (balance >= (0 - credit_limit))
);

-- Existing wallet_log already receives store_id from migration 0013.
ALTER TABLE wallet_log ADD COLUMN order_id TEXT;
ALTER TABLE wallet_log ADD COLUMN reference_type TEXT;
ALTER TABLE wallet_log ADD COLUMN reference_id TEXT;
ALTER TABLE wallet_log ADD COLUMN idempotency_key TEXT;
ALTER TABLE wallet_log ADD COLUMN metadata_json TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_log_idempotency
  ON wallet_log(client_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_log_order ON wallet_log(client_id,order_id);

CREATE TABLE IF NOT EXISTS wallet_topup_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  sender_phone TEXT NOT NULL,
  transfer_method TEXT NOT NULL DEFAULT 'wallet_transfer',
  proof_data_url TEXT,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (amount > 0),
  CHECK (status IN ('pending','approved','rejected','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_queue ON wallet_topup_requests(status,requested_at);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_client ON wallet_topup_requests(client_id,requested_at);

CREATE TABLE IF NOT EXISTS order_billing (
  order_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  wallet_log_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  charged_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('pending','charged','pending_insufficient','waived','failed'))
);
CREATE INDEX IF NOT EXISTS idx_order_billing_reconcile ON order_billing(client_id,status,updated_at);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_user_id TEXT,
  actor_email TEXT,
  source TEXT NOT NULL DEFAULT 'ui',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_timeline ON order_events(client_id,order_id,created_at);

CREATE TABLE IF NOT EXISTS order_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(client_id,order_id,created_at);

CREATE TABLE IF NOT EXISTS customer_channel_identities (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  customer_id TEXT,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  handle TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identity_unique
  ON customer_channel_identities(client_id,channel,external_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_identity_customer
  ON customer_channel_identities(client_id,customer_id);

CREATE TABLE IF NOT EXISTS order_attribution (
  order_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  platform TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'unknown',
  external_click_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  attributed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_attribution_campaign
  ON order_attribution(client_id,store_id,campaign_id,attributed_at);

ALTER TABLE campaign_daily_metrics ADD COLUMN reach INTEGER DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN frequency REAL DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN cpm REAL DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN ctr REAL DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN cpc REAL DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN leads INTEGER DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN platform_purchases INTEGER DEFAULT 0;
ALTER TABLE campaign_daily_metrics ADD COLUMN platform_purchase_value REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ad_studio_drafts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  product_id TEXT,
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'sales',
  target_audience TEXT,
  offer_text TEXT,
  product_context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_drafts_client ON ad_studio_drafts(client_id,store_id,created_at);

CREATE TABLE IF NOT EXISTS ad_creative_assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  draft_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  asset_url TEXT,
  label TEXT,
  angle TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_assets_draft ON ad_creative_assets(client_id,draft_id,created_at);

CREATE TABLE IF NOT EXISTS ad_draft_variants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT,
  draft_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  angle TEXT,
  hook TEXT,
  primary_text TEXT,
  headline TEXT,
  description TEXT,
  cta TEXT,
  audience_json TEXT NOT NULL DEFAULT '{}',
  campaign_plan_json TEXT NOT NULL DEFAULT '{}',
  ai_engine TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_variants_draft ON ad_draft_variants(client_id,draft_id,created_at);

-- ai_insight_snapshots already exists since migration 0011. v27 intentionally reuses
-- its generated_at/metric_json/suggested_payload_json schema to preserve Preview data.

CREATE TABLE IF NOT EXISTS platform_client_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_client_notes ON platform_client_notes(client_id,status,updated_at);
