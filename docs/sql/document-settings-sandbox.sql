-- Review-only schema. NOT in the automatic migrations queue. Execute locally for tests only.
-- Any remote application requires separately approved isolated resources and a backup/release plan.
CREATE TABLE document_settings (
 client_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 config_json TEXT NOT NULL, update_token TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
 PRIMARY KEY(client_id,store_id)
);
CREATE TABLE document_settings_audit (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 config_json TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE document_print_events (
 id TEXT NOT NULL, client_id TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL,
 template_id TEXT NOT NULL, paper_size TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(client_id,store_id,id)
);
CREATE INDEX document_print_order ON document_print_events(client_id,store_id,order_id,created_at);
CREATE TRIGGER document_audit_no_update BEFORE UPDATE ON document_settings_audit BEGIN SELECT RAISE(ABORT,'DOCUMENT_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER document_audit_no_delete BEFORE DELETE ON document_settings_audit BEGIN SELECT RAISE(ABORT,'DOCUMENT_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER document_print_no_update BEFORE UPDATE ON document_print_events BEGIN SELECT RAISE(ABORT,'DOCUMENT_PRINT_IMMUTABLE'); END;
CREATE TRIGGER document_print_no_delete BEFORE DELETE ON document_print_events BEGIN SELECT RAISE(ABORT,'DOCUMENT_PRINT_IMMUTABLE'); END;
