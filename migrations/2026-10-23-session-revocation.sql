-- SEC-02: hashed per-token logout revocation, not bearer tokens.
-- Apply to an ISOLATED test D1 first; run Production migration only in the approved release window.
CREATE TABLE IF NOT EXISTS revoked_session_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_session_expiry ON revoked_session_tokens (expires_at);
-- Expired rows may be removed by an approved maintenance task after expiry.
