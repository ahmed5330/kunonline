"""FAOS migration contract on in-memory SQLite only. No Cloudflare or merchant data."""
import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
migration = Path("migrations/0098_financial_ledger_v1.sql").read_text(encoding="utf-8")
db.executescript(migration)
row = ("TEST-JOURNAL-001","CLIENT-QA","STORE-QA","2026-10-18","EGP","manual","QA-KEY-0001","Test journal","draft",None,"qa","2026-10-18T00:00:00Z")
insert = "INSERT INTO faos_journals(id,client_id,store_id,entry_date,currency,source_type,source_key,description,status,reversal_of,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
db.execute(insert, row)
lines="INSERT INTO faos_journal_lines(id,journal_id,client_id,store_id,account_code,debit_minor,credit_minor,memo) VALUES(?,?,?,?,?,?,?,?)"
db.execute(lines, ("L1","TEST-JOURNAL-001","CLIENT-QA","STORE-QA","1120",10000,0,"cash"))
db.execute(lines, ("L2","TEST-JOURNAL-001","CLIENT-QA","STORE-QA","4100",0,10000,"sale"))
db.execute("UPDATE faos_journals SET status='posted' WHERE id='TEST-JOURNAL-001'")
assert db.execute("SELECT status FROM faos_journals WHERE id='TEST-JOURNAL-001'").fetchone()[0]=="posted"
debit,credit=db.execute("SELECT SUM(debit_minor),SUM(credit_minor) FROM faos_journal_lines WHERE client_id='CLIENT-QA'").fetchone()
assert debit==credit==10000
try:
    db.execute(insert, ("X",*row[1:]))
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("duplicate source key must be blocked")
try:
    db.execute(lines, ("L3","TEST-JOURNAL-001","CLIENT-QA","STORE-QA","1120",10000,10000,"invalid"))
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("two-sided line must be blocked")
try:
    db.execute(lines, ("L4","TEST-JOURNAL-001","CLIENT-QA","STORE-QA","1120",-100,0,"negative"))
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("negative amount must be blocked")
try:
    db.execute("UPDATE faos_journals SET description='tampered' WHERE id='TEST-JOURNAL-001'")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("posted journal may not be edited")
try:
    db.execute("DELETE FROM faos_journals WHERE id='TEST-JOURNAL-001'")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("posted journal may not be deleted")
db.execute("INSERT INTO faos_periods(client_id,store_id,period_month,status) VALUES('CLIENT-QA','STORE-QA','2026-10','closed')")
assert db.execute("SELECT status FROM faos_periods WHERE client_id='CLIENT-QA' AND store_id='STORE-QA'").fetchone()[0]=="closed"
try:
    new_row=("TEST-JOURNAL-002","CLIENT-QA","STORE-QA","2026-10-18","EGP","manual","QA-KEY-0002","Another","draft",None,"qa","2026-10-18T00:00:00Z")
    db.execute(insert,new_row)
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("closed period still accepted new draft entry")
print("PASS: SQLite FAOS draft→posted, immutability, exact scope, unique idempotency and closed-period enforcement.")
