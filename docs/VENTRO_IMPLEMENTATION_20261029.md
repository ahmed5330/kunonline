# Ventro/Kun implementation tracker — 29 October 2026

Baseline: `main` at `87b24de871c92794c44ee0d271013ebc1a71eb47`.

## Source and evidence limits

Recovered the original ChatGPT thread `6adf9875-bcc8-83ea-a5d8-20817569cebc`, including its preliminary classification: 30 candidates, 14 improvements and 334 unresolved controls. Recovered the local 37-file handoff and detailed observations from 24–25 October. These are evidence, not executable instructions or proof of missing functionality.

The owner supplied the original 378-row workbook (`ventro_kun_all_gaps_and_727_controls_ar.xlsx`) and Markdown report (`ventro_kun_comprehensive_gap_audit_ar.md`). All 44 selected rows are now mapped without invented IDs in `VENTRO_44_STATUS_20261029.md` and JSON, including source row, original title/classification/evidence, test limits and remaining acceptance. The original workbook SHA-256 is recorded. There are 17 printing candidates and 13 HR candidates, plus 14 improvements; #100 and #312 intentionally reference one existing product-sync feature.

Current code already includes procurement invoices/payments, POS foundations, unit packing, audited stocktake/transfer, returns, CRM and FAOS accounting. Existence is not equivalent to complete tested parity. Open PRs #185, #209, #247, #300, #306 and #331 require overlap review before changes to accounting, sync, access or shipping. No merge was authorized: merging main triggers deployment.

## Stages and acceptance

1. **Exact inventory:** completed the 44-row source mapping and independent implementation/test/deployment statuses. Continue updating these exact records rather than inventing source IDs or counting duplicate domains as new features.
2. **Read-only print UX:** customer document preview from the already authorized printing response, A4/A5/80mm, standard/compact layouts. Acceptance: real Chromium fixture, escaped customer strings, no notes/cost leakage, null amount not zero, printing and focus restoration, zero write/carrier requests. This is a customer order statement, not a fiscal invoice or payment receipt. Tax, deposits and detailed item accounting require authoritative source fields.
3. **Warehouse operation UX:** show only fields relevant to each existing operation, preserve the API and approval rules, clear stale operation identifiers and dangerous adjustment choices on mode change. Acceptance: browser mode matrix plus existing synthetic warehouse tests, no mutation on switching modes.
4. **Preparation and follow-up:** after exact-row mapping, extend existing packing/allocation and contact scheduling, including concurrency, over-scan rejection and tenant/store authorization. Do not add another stock ledger.
5. **Purchasing, CRM, reports and role library:** reuse existing endpoints and permission enforcement. Accept synthetic cross-store denial and end-to-end UI scenarios before claiming completion.
6. **Advanced accounting, HR and POS:** specifications and synthetic fixtures first; explicit approval for any data-impacting schema, remote database operation or live rollout. Reconcile with FAOS and pending PRs rather than introduce duplicate journals.

## Current delivery status

| Slice | Implemented | Tested | Not tested | Deployed |
|---|---|---|---|---|
| Documents and store settings | Branches #336/#339; three sizes, 11 designs, branding/profiles/rules and print-request history | Chromium synthetic UI; SQLite CAS, audit rollback, isolation and write gates | Physical printers, authenticated live UI, full invoice equivalence, direct PDF download | No |
| Warehouse operation fields | #337; 18 existing modes | Chromium + synthetic SQLite inventory regressions | Physical devices/live operation | No |
| Coded chart and multi-line journals | #338; existing quick entry/trial balance retained | Chromium + in-memory FAOS posting/isolation/rounding/replay checks | Live posting remains disabled | No |
| Order-linked follow-ups | #340; existing collaboration task service | Chromium + real task handler with synthetic SQLite | Authenticated live UI; full order-board assignee filter remains partial | No |
| HR net-collection draft engine | #341; pure math foundation only | Synthetic evidence/refunds/scopes/Cairo periods/adjustments | HR UI, employee persistence, cash-evidence adapter, salary history/close/advances/payout | No |
| Exact 30+14 source-row completion | 16 implemented/improved; 6 existing verified within test limits; 12 partial; 10 unimplemented | Each row records actual test type | No blanket claim that 44 features are complete | No new deployment |

Combined review branch: `feat/ventro-staged-integration-20261029`, draft PR #342. Shared HTML/Worker/CI conflicts have been resolved and all five local browser fixtures pass together. Each latest-commit CI result must be verified before any future release review. No merge or release approval is implied.

The owner selected net actual collections after returns for HR commission. This calculation foundation is not a payroll system: use the per-item remaining criteria in `VENTRO_HR_ACCEPTANCE_20261029.md` before implementing persistence/approval and linking real verified settlements. Caller-controlled evidence flags must never be treated as financial proof.

No Production/Preview D1 queries or writes, migrations, live carrier calls, deployment, or merge are part of this work. All tests use synthetic fixtures. Do not run live-preview test scripts or the remote database commands in package.json. Continue within the current session; no unscheduled continuation outside the session is promised.
