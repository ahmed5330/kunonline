-- Preview-only encrypted integration secret storage
CREATE TABLE IF NOT EXISTS integration_secrets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  iv_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id,connection_id,secret_name)
);
CREATE INDEX IF NOT EXISTS idx_integration_secrets_connection ON integration_secrets(client_id,connection_id);
