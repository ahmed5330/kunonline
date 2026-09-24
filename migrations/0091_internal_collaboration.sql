-- Internal team collaboration for each store/branch.
-- Additive only: no existing rows are deleted or reset.

CREATE TABLE IF NOT EXISTS collab_conversations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'group',
  name TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  direct_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_collab_conversations_store ON collab_conversations(client_id,store_id,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_direct_unique ON collab_conversations(client_id,store_id,direct_key) WHERE type='direct' AND direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS collab_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_members_user ON collab_members(user_id,conversation_id);

CREATE TABLE IF NOT EXISTS collab_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  assigned_to_user_id TEXT,
  assigned_to_name TEXT,
  task_id TEXT,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_messages_conversation ON collab_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_collab_messages_order ON collab_messages(client_id,store_id,order_id,created_at);

CREATE TABLE IF NOT EXISTS collab_message_mentions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(message_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_mentions_user ON collab_message_mentions(user_id,read_at,created_at);

CREATE TABLE IF NOT EXISTS collab_reads (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,user_id)
);

CREATE TABLE IF NOT EXISTS collab_tasks (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  conversation_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  order_id TEXT,
  assigned_to_user_id TEXT,
  assigned_to_name TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_store ON collab_tasks(client_id,store_id,status,priority,updated_at);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_assignee ON collab_tasks(client_id,store_id,assigned_to_user_id,status);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_order ON collab_tasks(client_id,store_id,order_id);

CREATE TABLE IF NOT EXISTS collab_order_assignments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  assigned_to_user_id TEXT NOT NULL,
  assigned_to_name TEXT,
  assigned_by_user_id TEXT NOT NULL,
  assigned_by_name TEXT,
  conversation_id TEXT,
  message_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_order_assignments_order ON collab_order_assignments(client_id,store_id,order_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_collab_order_assignments_user ON collab_order_assignments(client_id,store_id,assigned_to_user_id,status,updated_at);

ALTER TABLE orders ADD COLUMN assigned_user_id TEXT;
ALTER TABLE orders ADD COLUMN assigned_user_name TEXT;
ALTER TABLE orders ADD COLUMN assigned_at TEXT;
ALTER TABLE orders ADD COLUMN assigned_by_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_assignment ON orders(client_id,store_id,assigned_user_id,state);
