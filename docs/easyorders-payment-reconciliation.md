# Easy Orders: safe historical payment reconciliation

**Status:** read-only audit tooling in PR #352. No live DB connection, migration, or backfill is authorized by this document.

## Why historical paid badges can remain blank
A shipping state (`confirmed`, `shipped`, `signed`, `collected`) is not evidence of electronic payment. Prior versions could conflate a provider `paid` callback with a shipping/COD collected state. The app now reads a separate verified payment event in `orders.history`; old orders without that event are **unknown**, not unpaid.

## Offline audit
An authorized operator may export a **minimal local JSON array** containing only:
`client_id`, `store_id`, `source`, `ref`, `state`, `history`.
The export must stay local/private: historical `history` may contain employee notes. Never commit, upload, paste or share the export in GitHub or CI.

```bash
node scripts/payment-history-audit.mjs /secure/local/easyorders-minimal-export.json
```

The tool performs no network access and no writes. It outputs counts by tenant/store:
- `verifiedPaid` — verified provider payment evidence already stored
- `verifiedRefunded` — refund evidence already stored
- `unknownNeedsProviderCheck` — no trustworthy payment evidence
- `codCollectedIsNotProof` — unknown payment with a COD-collection state

The aggregate report contains no customer name, phone, raw order ID, order history or notes.

## Future authorized backfill — blocked pending review
1. Identify the actual canonical D1 binding for each deployment (do **not** assume production binding names), take a tested backup, and obtain explicit owner approval before any operations.
2. Query **read-only** for orders lacking verified payment events, scoped by client/store and Easy Orders connection.
3. Fetch the **authoritative provider payment event or transaction** for each candidate using the correct tenant's integration credential. Do not infer from shipping state, payment method, last edited status or transaction amount.
4. Resolve ambiguous refunds, partial payments, double charges and missing provider timestamps manually. Keep an immutable reconciliation evidence log.
5. Propose a separate opt-in, idempotent, tenant-scoped backfill PR; keep rollback and audit checks. Never auto-append `paid` for unknown records.
6. Verify badges in web board, native Android and overlay, including after cached-sync reload and cross-tenant switching.

## Release safety
- PR #352: payment UI, provider event journal, privacy and caching; remains a Draft until accepted.
- PR #351 / Issue #346: durable change feed and FCM push for background updates are separate, unmerged workstreams.
- Deployments, D1 migrations, historical backfills, and live data modifications require explicit prior approval.
