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
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
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

-- Journals are created as DRAFT then posted in the SAME atomic D1 batch.
-- The posting transition itself validates the double-entry equation.
CREATE TRIGGER IF NOT EXISTS faos_journal_must_start_draft
BEFORE INSERT ON faos_journals
WHEN NEW.status <> 'draft'
BEGIN SELECT RAISE(ABORT,'FAOS_MUST_POST_ATOMICALLY'); END;

CREATE TRIGGER IF NOT EXISTS faos_journal_no_closed_period
BEFORE INSERT ON faos_journals
WHEN EXISTS (
 SELECT 1 FROM faos_periods p WHERE p.client_id=NEW.client_id AND p.store_id=NEW.store_id
 AND p.period_month=substr(NEW.entry_date,1,7) AND p.status='closed'
)
BEGIN SELECT RAISE(ABORT,'FAOS_PERIOD_CLOSED'); END;

CREATE TRIGGER IF NOT EXISTS faos_journal_post_balanced
BEFORE UPDATE OF status ON faos_journals
WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
 SELECT CASE WHEN
   (SELECT COUNT(*) FROM faos_journal_lines WHERE journal_id=NEW.id) < 2
   OR (SELECT COALESCE(SUM(debit_minor),0) FROM faos_journal_lines WHERE journal_id=NEW.id) <= 0
   OR (SELECT COALESCE(SUM(debit_minor-credit_minor),0) FROM faos_journal_lines WHERE journal_id=NEW.id) <> 0
 THEN RAISE(ABORT,'FAOS_JOURNAL_NOT_BALANCED') END;
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM faos_periods p WHERE p.client_id=NEW.client_id AND p.store_id=NEW.store_id
   AND p.period_month=substr(NEW.entry_date,1,7) AND p.status='closed'
 ) THEN RAISE(ABORT,'FAOS_PERIOD_CLOSED') END;
END;

CREATE TRIGGER IF NOT EXISTS faos_journal_immutable_update
BEFORE UPDATE ON faos_journals WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT,'FAOS_POSTED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS faos_journal_immutable_delete
BEFORE DELETE ON faos_journals WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT,'FAOS_POSTED_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS faos_line_scope_and_draft
BEFORE INSERT ON faos_journal_lines
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM faos_journals j
  WHERE j.id=NEW.journal_id AND j.client_id=NEW.client_id AND j.store_id=NEW.store_id AND j.status='draft'
 ) THEN RAISE(ABORT,'FAOS_JOURNAL_NOT_DRAFT_OR_SCOPE_INVALID') END;
END;
CREATE TRIGGER IF NOT EXISTS faos_line_immutable_update
BEFORE UPDATE ON faos_journal_lines
BEGIN SELECT RAISE(ABORT,'FAOS_LINE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS faos_line_immutable_delete
BEFORE DELETE ON faos_journal_lines
BEGIN SELECT RAISE(ABORT,'FAOS_LINE_IMMUTABLE'); END;

-- All financial corrections use reversal journals; historical rows are immutable.
