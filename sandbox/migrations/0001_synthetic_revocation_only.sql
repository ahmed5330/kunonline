-- ONLY for a newly-provisioned, isolated audit sandbox D1.
-- Never include in or automatically apply against Production/Preview.
-- The source schemas match main 0099 and Draft PR209 respectively.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expiry ON revoked_sessions(expires_at);

CREATE TABLE IF NOT EXISTS revoked_session_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_session_expiry ON revoked_session_tokens(expires_at);
