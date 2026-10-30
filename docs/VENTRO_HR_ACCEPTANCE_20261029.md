# HR stage — source #320–332

The owner explicitly selected **net actual collections after returns** as the commission basis on 29 October 2026. `src/hr-payroll-core.js` implements a pure draft engine and employee validation for this basis; it does not expose a database or live route and cannot post or pay money.

Actual collection/refund evidence must be verified by a future authenticated adapter against genuine settlement/bank documents, linked order and employee attribution. A caller-controlled `verified` boolean is not proof; the pure engine validates a preverified contract and must **never** be wired directly to a client-submitted financial-facts endpoint. Order status/value, a shipped label, wallet funding and a mere return status are not cash evidence.

The engine uses integer cents and deterministic rounding, rejects duplicate conflicting evidence and tenant/store/employee collisions, deducts verified actual refunds, and handles Cairo reporting months. A negative month from prior-period refunds requires review: no automatic deduction from basic salary or invented carry-forward policy. Bonuses/deductions require documented approval references. The output is a **draft before statutory deductions**, with posting/payment explicitly false; it is not a paid salary or a closed month.

## Remaining acceptance per original item

| ID | Source requirement | Required completion evidence |
|---|---|---|
|320|HR workspace|Permissioned directory/payroll UI with live reads only after safe schema approval|
|321|Add employee|Scoped employee creation, immutable audit, duplicate-code and concurrency checks|
|322|Employee register|Paginated scoped records; no user-login/RBAC mutation|
|323|Employee search|Name/code search and correct page totals under store isolation|
|324|Enable commissions|Persisted per-employee toggle with approval/effective dates; pure calculation already tested|
|325|Commission rules|Persisted rate/effective policy plus verified net cash adapter; math already tested|
|326|Bonuses/deductions|Audited approved adjustments, closed-period protection; draft math already tested|
|327|Salary history|Immutable per-month employee snapshots linking original evidence and FAOS journal, not estimates|
|328|Close payroll month|Independent approval, unique month/employee, all evidence settled, atomic snapshot and existing FAOS posting, retry protection|
|329|Disburse advance|Approved actual payment through existing financial ledger, single effect, durable proof; no standalone balance mutation|
|330|Register advance|Link employee/store, paid journal reference, outstanding amount and repayment schedule without duplicating cash movement|
|331|Full history|Append-only actor/time/event history for employees, policy, payroll and advances with source links|
|332|HR export|Permissioned CSV/XLSX for exact selected filters; neutralize spreadsheet formulas and exclude unnecessary personal data|

Update 30 October: #343 adds the private scoped directory, create/register/search, effective dated salary and commission policies, immutable employee/policy history and filtered formula-safe CSV. SQLite and Chromium fixtures pass. Proposed schema lives in docs/sql and has NOT been applied remotely; writes remain sandbox-only. See VENTRO_HR_DIRECTORY_20261029.md. #325 still needs trusted server cash evidence, #326 approved adjustment persistence, #327–330 actual payroll/advance workflows, and #331 complete financial history. No live payroll, month close or payout is available. Directory success is not payroll completion.
