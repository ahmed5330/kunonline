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
5. In an isolated QA store only, manually post debit Bank 1010 100 / credit Capital 3000 100.
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
