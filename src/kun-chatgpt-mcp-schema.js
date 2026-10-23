// Dedicated, append-only OAuth grant tables. Created lazily on the Preview-backed D1
// when an owner explicitly starts account-linking, never on ordinary dashboard loads.
const SCHEMA=[
 `CREATE TABLE IF NOT EXISTS kun_mcp_codes (
 code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL,store_id TEXT NOT NULL,
 user_id TEXT NOT NULL, oauth_client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,
 resource TEXT NOT NULL, challenge TEXT NOT NULL, scope TEXT NOT NULL,
 expires_at INTEGER NOT NULL, used_at INTEGER,created_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS kun_mcp_access (
 token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL,store_id TEXT NOT NULL,
 user_id TEXT NOT NULL, oauth_client_id TEXT NOT NULL,resource TEXT NOT NULL,
 scope TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER,
 created_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS kun_mcp_refresh (
 token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL,store_id TEXT NOT NULL,
 user_id TEXT NOT NULL, oauth_client_id TEXT NOT NULL,resource TEXT NOT NULL,
 scope TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER,
 created_at INTEGER NOT NULL)`,
 'CREATE INDEX IF NOT EXISTS idx_kun_mcp_access_tenant ON kun_mcp_access(client_id,store_id,user_id)',
 'CREATE INDEX IF NOT EXISTS idx_kun_mcp_refresh_tenant ON kun_mcp_refresh(client_id,store_id,user_id)'
];
let cache=new WeakSet();
export async function ensureKunMcpSchema(env){
 if(cache.has(env.DB))return;
 for(const sql of SCHEMA)await env.DB.prepare(sql).run();
 cache.add(env.DB);
}
