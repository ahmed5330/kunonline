-- Review-only; never part of the automatic migration queue. Local synthetic QA only until approved.
CREATE TABLE hr_employees (
 id TEXT NOT NULL,client_id TEXT NOT NULL,store_id TEXT NOT NULL,code TEXT NOT NULL COLLATE NOCASE,
 name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','inactive')),revision INTEGER NOT NULL,
 update_token TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(client_id,store_id,id),UNIQUE(client_id,store_id,code)
);
CREATE TABLE hr_employee_policies (
 client_id TEXT NOT NULL,store_id TEXT NOT NULL,employee_id TEXT NOT NULL,revision INTEGER NOT NULL,
 effective_month TEXT NOT NULL,config_json TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(client_id,store_id,employee_id,revision),
 FOREIGN KEY(client_id,store_id,employee_id) REFERENCES hr_employees(client_id,store_id,id)
);
CREATE TABLE hr_directory_audit (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT NOT NULL,employee_id TEXT NOT NULL,
 revision INTEGER NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,snapshot_json TEXT NOT NULL
);
CREATE INDEX hr_directory_scope ON hr_employees(client_id,store_id,name,id);
CREATE INDEX hr_policy_period ON hr_employee_policies(client_id,store_id,employee_id,effective_month,revision);
CREATE TRIGGER hr_policy_no_update BEFORE UPDATE ON hr_employee_policies BEGIN SELECT RAISE(ABORT,'HR_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER hr_policy_no_delete BEFORE DELETE ON hr_employee_policies BEGIN SELECT RAISE(ABORT,'HR_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER hr_audit_no_update BEFORE UPDATE ON hr_directory_audit BEGIN SELECT RAISE(ABORT,'HR_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER hr_audit_no_delete BEFORE DELETE ON hr_directory_audit BEGIN SELECT RAISE(ABORT,'HR_HISTORY_IMMUTABLE'); END;
