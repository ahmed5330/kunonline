-- DRAFT / NOT APPLIED. Requires 0100_order_change_journal.sql first.
-- Each row ties one encrypted Firebase token to an authenticated user
-- and ONE server-authorized store. Registration reconciles rows atomically
-- for a single installation. No customer names, phones or order payloads.
CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id TEXT PRIMARY KEY NOT NULL,
  installation_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seq>=0),
  last_attempt_at TEXT,
  retry_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(installation_hash,client_id,store_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_due
  ON mobile_push_devices(retry_after,last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_mobile_push_scope
  ON mobile_push_devices(client_id,store_id,last_seq);
CREATE INDEX IF NOT EXISTS idx_mobile_push_user
  ON mobile_push_devices(user_id,installation_hash);
