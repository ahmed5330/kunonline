-- Self-service email activation. Additive only; apply deliberately per environment.
-- No changes to existing users, tenant data, subscriptions or balances.
CREATE TABLE IF NOT EXISTS signup_pending (
  email TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  store_name TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_pending_expiry ON signup_pending(expires_at);

-- Durable claim prevents another free trial for a previously activated email,
-- even if an operator subsequently deletes its users row.
CREATE TABLE IF NOT EXISTS signup_trial_claims (
  email TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  activated_at TEXT NOT NULL
);

-- Anonymous, HMAC-obfuscated IP/email buckets, no raw IP addresses stored.
CREATE TABLE IF NOT EXISTS signup_throttle (
  bucket TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
