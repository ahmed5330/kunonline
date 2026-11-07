-- FOR NEW ISOLATED AUDIT D1 ONLY. Never apply to kunonline or kunonline-preview.
-- No customer/order/account/shipping tables, no PII, no seed data.
CREATE TABLE IF NOT EXISTS qa_sandbox_marker (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
  kind TEXT NOT NULL DEFAULT 'synthetic-only' CHECK(kind = 'synthetic-only')
);
