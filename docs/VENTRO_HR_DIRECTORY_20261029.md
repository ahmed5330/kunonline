# HR directory stage — original items #320–325, #331–332

Adds an actual permissioned employee workspace, not login accounts. Employee creation/editing, name/code search, exact filtered counts/pages, per-employee commission toggle/rate, effective-month policy history and filtered CSV export use a dedicated store-scoped service. A policy-at-month resolver never applies a future salary policy to an earlier month.

Only `hr.read` permits salary reads; `finance.read/write` alone does not. Writes require `hr.write`, writable store access and BOTH `APP_ENV=sandbox` / `HR_DIRECTORY_WRITE_ENABLED=1`. Export separately requires `hr.export`. Owners/admins retain existing permission semantics. No role defaults or login records were changed.

The review-only schema is `docs/sql/hr-directory-sandbox.sql`, outside the automatic migration queue. No remote schema/resource/env was touched. Missing schema returns explicit 503 rather than a healthy empty register. Revisions are CAS-protected, employee codes unique per store, retrying an identical initial creation is deduplicated, and policy plus audit insert share the update transaction. Audit failures roll back the whole update. No hard delete route; policy/audit rows reject UPDATE and DELETE. Employee changes do not alter historical policy snapshots.

CSV export matches the search/status filter across pages (up to a disclosed 10000-record limit), neutralizes formula-leading names/codes and excludes unrelated personal data. Basic salary uses integer cents and rates integer basis points. The UI discloses future effective months and write restrictions.

Passed: actual handler in-memory SQLite permission/store/tenant denial, missing schema, duplicate code/replay, concurrent updates, audit rollback, period-effective policy, immutable history, literal search/pagination and CSV formula safety. Local Chromium synthetic fixture covers navigation/read-only mode, create/edit with exact money/rates, escaped names, effective policy history, search and stale-store denial. No authenticated live UI or real employees were exercised.

**Not payroll completion:** #325 still needs a trusted cash-evidence/employee-attribution adapter; #326–330 remain unfinished beyond the pure calculation foundation. This directory does not close payroll, post FAOS, create financial balances, register paid advances, move money or send messages. #331 here is the complete employee/policy change history, not a nonexistent paid-salary/advance history. #332 exports the employee register, not a claim that a paid-payroll report exists.
