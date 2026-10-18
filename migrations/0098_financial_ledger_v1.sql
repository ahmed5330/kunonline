-- FAOS v1: additive, tenant-isolated double-entry book.
-- Intentionally does not backfill or modify existing orders, wallets or settlements.
CREATE TABLE IF NOT EXISTS faos_journals (
 id TEXT PRIMARY KEY,
 client_id TEXT NOT NULL,
 store_id TEXT NOT NULL,
 entry_date TEXT NOT NULL,
 currency TEXT NOT NULL DEFAULT 'EGP',
 source_type TEXT NOT NULL,
 source_key TEXT NOT NULL,
 description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'posted' CHECK(status='posted'),
 reversal_of TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(client_id, source_type, source_key),
 FOREIGN KEY(reversal_of) REFERENCES faos_journals(id)
);
CREATE INDEX IF NOT EXISTS idx_faos_journals_scope ON faos_journals(client_id,store_id,entry_date);
CREATE TABLE IF NOT EXISTS faos_journal_lines (
 id TEXT PRIMARY KEY,
 journal_id TEXT NOT NULL REFERENCES faos_journals(id),
 client_id TEXT NOT NULL,
 store_id TEXT NOT NULL,
 account_code TEXT NOT NULL,
 debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor>=0),
 credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
 memo TEXT,
 CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
);
CREATE INDEX IF NOT EXISTS idx_faos_lines_journal ON faos_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_faos_lines_account ON faos_journal_lines(client_id,store_id,account_code);
CREATE TABLE IF NOT EXISTS faos_periods (
 client_id TEXT NOT NULL,
 store_id TEXT NOT NULL,
 period_month TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 closed_at TEXT,
 closed_by TEXT,
 PRIMARY KEY(client_id,store_id,period_month)
);
-- Do not mutate historical financial rows: corrections use reversal journals.
