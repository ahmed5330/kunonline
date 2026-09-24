-- Kun Online internal collaboration — store-scoped chat, mentions, tasks and order assignments.
CREATE TABLE IF NOT EXISTS collab_channels (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL CHECK (type IN ('group','direct')),
  direct_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_collab_channels_store ON collab_channels(client_id,store_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_channels_direct ON collab_channels(client_id,store_id,direct_key) WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS collab_channel_members (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at TEXT NOT NULL,
  UNIQUE(channel_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_members_user ON collab_channel_members(client_id,store_id,user_id,channel_id);

CREATE TABLE IF NOT EXISTS collab_messages (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','order','assignment','system')),
  order_id TEXT,
  assigned_user_id TEXT,
  assigned_user_name TEXT,
  reply_to_message_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collab_messages_channel ON collab_messages(client_id,store_id,channel_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_messages_order ON collab_messages(client_id,order_id,created_at DESC);

CREATE TABLE IF NOT EXISTS collab_message_mentions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  mentioned_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(message_id,mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_mentions_user ON collab_message_mentions(client_id,store_id,mentioned_user_id,read_at,created_at DESC);

CREATE TABLE IF NOT EXISTS collab_channel_reads (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  UNIQUE(channel_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_reads_user ON collab_channel_reads(client_id,store_id,user_id);

CREATE TABLE IF NOT EXISTS collab_tasks (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  channel_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  assigned_to TEXT,
  assigned_to_name TEXT,
  order_id TEXT,
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_store ON collab_tasks(client_id,store_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_assignee ON collab_tasks(client_id,store_id,assigned_to,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_order ON collab_tasks(client_id,order_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS collab_order_assignments (
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  assigned_to_user_id TEXT NOT NULL,
  assigned_to_name TEXT NOT NULL,
  assigned_by_user_id TEXT NOT NULL,
  assigned_by_name TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_id,order_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_assignments_user ON collab_order_assignments(client_id,store_id,assigned_to_user_id,updated_at DESC);
