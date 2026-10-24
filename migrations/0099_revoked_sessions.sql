-- Additive session revocation. Apply before deploying the session reader.
-- Only SHA-256 fingerprints are retained; no raw tokens or credentials.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expiry ON revoked_sessions(expires_at);
