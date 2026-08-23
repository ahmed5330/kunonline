-- Preview-only unified channels and campaigns foundation
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_thread_id TEXT,
  customer_id TEXT,
  customer_name TEXT,
  customer_handle TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  unread_count INTEGER DEFAULT 0,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_external ON conversations(client_id,channel,external_thread_id);
CREATE INDEX IF NOT EXISTS idx_conversations_queue ON conversations(client_id,status,last_message_at);

CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  external_message_id TEXT,
  direction TEXT NOT NULL,
  sender_type TEXT,
  sender_id TEXT,
  body TEXT,
  media_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'received',
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_message_external ON channel_messages(client_id,external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation ON channel_messages(conversation_id,sent_at);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_campaign_id TEXT,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT DEFAULT 'unknown',
  currency TEXT DEFAULT 'EGP',
  budget REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_external ON marketing_campaigns(client_id,platform,external_campaign_id);

CREATE TABLE IF NOT EXISTS campaign_daily_metrics (
  client_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  spend REAL DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(client_id,campaign_id,metric_date)
);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_date ON campaign_daily_metrics(client_id,metric_date);
