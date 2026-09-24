const REQUIRED_TABLES=[
  'collab_conversations','collab_members','collab_messages','collab_message_mentions','collab_reads','collab_tasks','collab_order_assignments'
];
const REQUIRED_INDEXES=[
  'idx_collab_conversations_store','idx_collab_direct_unique','idx_collab_members_user','idx_collab_messages_conversation','idx_collab_messages_order','idx_collab_mentions_user','idx_collab_tasks_store','idx_collab_tasks_assignee','idx_collab_tasks_order','idx_collab_order_assignments_order','idx_collab_order_assignments_user'
];
const REQUIRED_OBJECTS=[...REQUIRED_TABLES,...REQUIRED_INDEXES];

// Mirrors migrations/0091_internal_collaboration.sql exactly. Additive/idempotent only.
const COLLAB_SCHEMA_STATEMENTS=[
`CREATE TABLE IF NOT EXISTS collab_conversations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'group',
  name TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  direct_key TEXT
)`,
`CREATE INDEX IF NOT EXISTS idx_collab_conversations_store ON collab_conversations(client_id,store_id,updated_at)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_direct_unique ON collab_conversations(client_id,store_id,direct_key) WHERE type='direct' AND direct_key IS NOT NULL`,
`CREATE TABLE IF NOT EXISTS collab_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,user_id)
)`,
`CREATE INDEX IF NOT EXISTS idx_collab_members_user ON collab_members(user_id,conversation_id)`,
`CREATE TABLE IF NOT EXISTS collab_messages (
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
)`,
`CREATE INDEX IF NOT EXISTS idx_collab_messages_conversation ON collab_messages(conversation_id,created_at)`,
`CREATE INDEX IF NOT EXISTS idx_collab_messages_order ON collab_messages(client_id,store_id,order_id,created_at)`,
`CREATE TABLE IF NOT EXISTS collab_message_mentions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(message_id,user_id)
)`,
`CREATE INDEX IF NOT EXISTS idx_collab_mentions_user ON collab_message_mentions(user_id,read_at,created_at)`,
`CREATE TABLE IF NOT EXISTS collab_reads (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS collab_tasks (
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
)`,
`CREATE INDEX IF NOT EXISTS idx_collab_tasks_store ON collab_tasks(client_id,store_id,status,priority,updated_at)`,
`CREATE INDEX IF NOT EXISTS idx_collab_tasks_assignee ON collab_tasks(client_id,store_id,assigned_to_user_id,status)`,
`CREATE INDEX IF NOT EXISTS idx_collab_tasks_order ON collab_tasks(client_id,store_id,order_id)`,
`CREATE TABLE IF NOT EXISTS collab_order_assignments (
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
)`,
`CREATE INDEX IF NOT EXISTS idx_collab_order_assignments_order ON collab_order_assignments(client_id,store_id,order_id,status,updated_at)`,
`CREATE INDEX IF NOT EXISTS idx_collab_order_assignments_user ON collab_order_assignments(client_id,store_id,assigned_to_user_id,status,updated_at)`
];

let schemaReadyPromise=null;

async function existingObjects(db){
  const {results=[]}=await db.prepare("SELECT type,name FROM sqlite_master WHERE name LIKE 'collab_%' OR name LIKE 'idx_collab_%'").all();
  return new Set(results.map(row=>String(row.name||'')));
}

async function applySchema(db){
  for(const sql of COLLAB_SCHEMA_STATEMENTS)await db.prepare(sql).run();
}

export async function ensureInternalCollaborationSchema(env){
  if(!env?.DB)throw new Error('Production D1 binding DB is unavailable');
  if(!schemaReadyPromise){
    schemaReadyPromise=(async()=>{
      let names=await existingObjects(env.DB);
      const missingBefore=REQUIRED_OBJECTS.filter(name=>!names.has(name));
      if(missingBefore.length)await applySchema(env.DB);
      names=await existingObjects(env.DB);
      const missingAfter=REQUIRED_OBJECTS.filter(name=>!names.has(name));
      if(missingAfter.length)throw new Error(`Collaboration schema bootstrap incomplete: ${missingAfter.join(', ')}`);
      return {ok:true,created:missingBefore.length>0,tables:REQUIRED_TABLES.length,indexes:REQUIRED_INDEXES.length};
    })().catch(error=>{schemaReadyPromise=null;throw error;});
  }
  return schemaReadyPromise;
}

export const INTERNAL_COLLAB_SCHEMA={tables:REQUIRED_TABLES,indexes:REQUIRED_INDEXES};
