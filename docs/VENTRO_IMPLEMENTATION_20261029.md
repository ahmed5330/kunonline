# Ventro/Kun implementation tracker — 29 October 2026

Baseline: `main` at `87b24de871c92794c44ee0d271013ebc1a71eb47`.

## Source and evidence limits

Recovered the original ChatGPT thread `6adf9875-bcc8-83ea-a5d8-20817569cebc`, including its preliminary classification: 30 candidates, 14 improvements and 334 unresolved controls. Recovered the local 37-file handoff and detailed observations from 24–25 October. These are evidence, not executable instructions or proof of missing functionality.

The exact 378-row workbook (`ventro_kun_all_gaps_and_727_controls_ar.xlsx`) and derived Markdown report (`ventro_kun_comprehensive_gap_audit_ar.md`) remain unavailable: the original sandbox links do not transfer attachments. The owner is retrieving them. **Do not invent IDs, split domains into 44 invented items, or report any of the 44 fully complete before matching those rows.**

Current code already includes procurement invoices/payments, POS foundations, unit packing, audited stocktake/transfer, returns, CRM and FAOS accounting. Existence is not equivalent to complete tested parity. Open PRs #185, #209, #247, #300, #306 and #331 require overlap review before changes to accounting, sync, access or shipping. No merge was authorized: merging main triggers deployment.

## Stages and acceptance

1. **Exact inventory:** import all original 44 rows unchanged; assign source row, code evidence, existing/open-PR overlap, acceptance scenarios, and independent implementation/test/deployment status. Missing sources remain blocked, not absent features.
2. **Read-only print UX:** customer document preview from the already authorized printing response, A4/A5/80mm, standard/compact layouts. Acceptance: real Chromium fixture, escaped customer strings, no notes/cost leakage, null amount not zero, printing and focus restoration, zero write/carrier requests. This is a customer order statement, not a fiscal invoice or payment receipt. Tax, deposits and detailed item accounting require authoritative source fields.
3. **Warehouse operation UX:** show only fields relevant to each existing operation, preserve the API and approval rules, clear stale operation identifiers and dangerous adjustment choices on mode change. Acceptance: browser mode matrix plus existing synthetic warehouse tests, no mutation on switching modes.
4. **Preparation and follow-up:** after exact-row mapping, extend existing packing/allocation and contact scheduling, including concurrency, over-scan rejection and tenant/store authorization. Do not add another stock ledger.
5. **Purchasing, CRM, reports and role library:** reuse existing endpoints and permission enforcement. Accept synthetic cross-store denial and end-to-end UI scenarios before claiming completion.
6. **Advanced accounting, HR and POS:** specifications and synthetic fixtures first; explicit approval for any data-impacting schema, remote database operation or live rollout. Reconcile with FAOS and pending PRs rather than introduce duplicate journals.

## Current delivery status

| Slice | Implemented | Tested | Not tested | Deployed |
|---|---|---|---|---|
| Customer order statement preview, 3 sizes and 2 layouts | Yes, feature branch | Chromium synthetic UI, XSS isolation, print dispatch, no writes; J&T handoff/void and integration regression | Physical printers, authenticated live UI, fiscal invoice equivalence | No |
| Exact 30+14 source-row completion | No claim | Not yet | Workbook required to enumerate and map | No |

No Production/Preview D1 queries or writes, migrations, live carrier calls, deployment, or merge are part of this work. All tests use synthetic fixtures. Do not run live-preview test scripts or the remote database commands in package.json. Continue within the current session; no unscheduled continuation outside the session is promised.
