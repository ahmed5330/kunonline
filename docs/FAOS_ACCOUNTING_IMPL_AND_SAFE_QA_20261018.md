# FAOS accounting section — Preview implementation and safe QA
Date: 2026-10-18. Reference: Kun Online Financial & Accounting OS v1 (23 chapters).

## What was built
- Additive tenant/store isolated double-entry schema in `migrations/0098_financial_ledger_v1.sql`.
- Read-only legacy vs FAOS diagnostic overview in `/api/accounting/faos/overview`.
- Account chart, journal posting with idempotency, immutable reversal, closed-period enforcement.
- Arabic FAOS workspace embedded within existing **الحسابات والحركات** section.
- 4 isolated fake orders, 17 journal fixtures, 2 stores, partial gateway remittance, courier COD, full return and ad expense.
- Unit QA plus schema QA; fixture endpoints neither insert orders nor charge the wallet.

## Invariants
- Do not migrate or auto-post live operations until source-event contracts and live reconciliation are signed off.
- Operational order status is NOT sufficient proof of an accounting sale.
- `legacy.collectedRevenue` may be estimated from order total; mark it as **unverified**, never bank cash.
- This module does NOT modify Easy Order, existing order states, J&T, wallets, production D1 or ad sync.
- `faos_journals` are posted independently; never add their totals to existing P&L.
- Post only in active store; never cross client/store even if an idempotency key matches.
- Reverse a posted journal rather than deleting it; a closed accounting period blocks posting.
- Preview-only migrations first, migration must succeed before POST entry testing.
- Scenario QA is visibly labeled imaginary. Do not promote fixture IDs into production data.

## Manual checklist (isolated Preview only)
1. Apply migration to preview D1 using the existing preview-specific CI/CD mechanism, after CI passes.
2. Sign in to two test stores and open **الحسابات والحركات**.
3. Open FAOS simulation; assert 4 fake orders, 17 journals, 8 checks passed.
4. Open FAOS review: ensure warnings for unverified amounts and separate ledger vs legacy indicators.
5. In an isolated QA store only, manually post debit Bank 1120 100 / credit Capital 3100 100.
6. Replay identical request with same idempotency key: still one journal.
7. Reverse by journal ID: zero economic impact, preserved history; second reverse is idempotent.
8. Close a period in QA database then verify new posting returns 409.
9. Verify finance-read user cannot POST; worker from other store cannot query/write.
10. Verify no live Easy Order order, J&T label, wallet debit, notification or stock movement resulted from scenario.

## Findings in current legacy accounting
- `src/accounting.js:accountingOverview()` allows `collected_amount ?? total` for collected orders, so missing settlement amounts are estimates.
- `src/accounting-monthly.js` combines operational dashboard profit and manual entries; do not treat as posted GL.
- `src/accounting.js:deleteAccountingEntry()` deletes historical manual transactions; the new ledger reverses instead.
- Some manual 'مشتريات' amounts may be expensed in addition to COGS. Verify item-level cost policy.
- Platform SaaS wallet must be a separate legal book from a merchant's commerce ledger.

## Release gates to address before production
- End-to-end event source mapping (store sale after delivery/control, returns, stock costing, gateway and courier reconciliation).
- Opening balances and historical cutover with matched zero differences, not blind replay.
- Currency / VAT and tax-policy configuration per legal entity; this v1 posts EGP only.
- Automated contract tests against authentic anonymized operational datasets.
- Actual Preview database migrations, browser E2E and permission tests.
- Audit of cash account vs bank statements and independent QA signoff.


## Continuation — stricter accounting controls (18 October 2026)
- Idempotent posting now checks *all economic inputs*, not just the transaction key. A reused key with a different amount, accounts, date or description receives `409 FAOS_IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Identical retries succeed even after the underlying period closes. New entries for closed months are blocked; reversals are recorded in an open month, not by editing closed history.
- Real API journal tests execute against SQLite in-memory using the FAOS D1 schema. They confirm atomic posting, two-store/tenant isolation, duplicate replays, reversal idempotency and period-close behavior.
- The initial arbitrary 27 account numbers had important collisions with the project's **156-account reference chart**. The active subset is now remapped to the actual reference (1230 courier COD, 1240 gateway, 1120 bank, 1300 inventory, 5100 COGS, 6110 shipping, 6100 Meta, 6141 Kun Online management etc.). All 156 accounts are *not* enabled as posting accounts yet; each additional head requires explicit accounting-policy review.
- The verified commerce event projector `src/accounting-faos-event-projector.js` emits **draft only** journals for verified delivery, inventory COGS snapshot, courier COD settlement, approved return, inspected return stock and bank-verified refunds. It refuses inconsistent amounts, missing approved evidence types and unsupported SaaS wallet transactions.
- `operationalQuality` evaluates the real canonical order SQL (when Preview/Production is eventually connected) and reports unverified COD, pending shipping pipeline amounts, missing sold-item costs, wrong active management fees and manual purchases/ads requiring deduplication.
- Legacy monthly accounting now exposes separate `verifiedCollectedRevenue` (recorded collection amount) and `estimatedCollectedRevenue` (fallback from order total); neither alone proves money arrived at the bank. The UI explicitly distinguishes them.

### Important data-policy and implementation limits
- Delivery status alone never proves COD cash remittance. `signed` may establish delivery, but `collected` requires a settlement file, carrier record and bank reconciliation before treating it as bank cash.
- A `verified` flag supplied by client input is not cryptographic evidence. Before automatic posting, ingestion services must authenticate provider signatures, verify external references and prevent events from other tenants or stores.
- Shipping revenue is included only when the merchant is entitled to recognize it (principal/agent assessment); tax treatments are entity-specific. The projector presently requires normalized externally approved accounting events and cannot decide policy itself.
- There is **no event auto-posting**, **no live legacy reclassification/backfill**, **no production database migration**, **no production deploy**, and **no certified cash reconciliation** in this PR.
- Full release requires an independently isolated Preview QA tenant/database with real schema, provider fixtures, source authenticity checks, legally approved chart and month-open/close procedures, then repeated zero-difference reconciliation by journal and store.

### Required production acceptance report, per store and month
| Check | Source A | Source B | Acceptance |
|---|---|---|---|
| Payment settlements | Carrier/PSP statement | COD and gateway clearing GL | Every receipt matched or flagged with owner |
| Merchant cash | Bank ledger/statement | Bank GL | Zero unexplained variance |
| Revenue | Delivery-confirmed events | Sales GL | No pre-delivery revenue, proper VAT |
| COGS | Serialized stock/bundle cost at sale | Inventory and COGS GL | No missing or double-counted unit cost |
| Returns | Refund/inspection/shipping statements | Return and stock GL | Reversals and remaining liabilities reconcile |
| Marketing | Platform daily spend + invoice | Expense GL | No duplicate manual and API spend |
| Kun SaaS wallet | Platform wallet order-billing | Platform ledger only | Separate from merchant books |
| Period close | Approved close document | GL write guard + reversal history | Closed books immutable |

No release may be represented as 'accounting fully integrated' until the above checks have been run against a real isolated environment and the decisions have been explicitly approved.
