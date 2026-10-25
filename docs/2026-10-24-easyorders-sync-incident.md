# Easy Orders sync incident triage — 23–24 October 2026

**Status:** Source-code defects found and patched in a Draft hotfix PR. **No successful live D1, Webhook, Easy Orders upstream API, scheduler runtime, or Android customer-session inspection has been performed.** A green fake regression does not prove all real missing orders recovered.

## Why orders can go missing from both web and Android

Production's web and Android customer data routes use Preview's canonical D1 through `PREVIEW_APP` and `PREVIEW_DB`, whereas the Preview Worker itself currently has `crons=[]`. A **separate** scheduler Worker `kunonline-sync-preview` in `wrangler.sync.preview.toml` is designed to trigger `SyncEntrypoint.runCron` every 5 minutes. The Production Worker *also* defines a five-minute cron; its fallback `src/index-production-sync.js` is a different legacy recovery path. Review the **deployed versions/triggers and actual bindings** before changing any Cron, as repo configs cannot establish live deployment state.

Observed implementation defects (fixed in this PR):
1. `src/index-commerce-v31.js` webhook health and `src/index-commerce-v34.js` webhook Short ID, plus `src/easyorders-order-reconciliation.js` scheduled cursor, all rewrote `store_connections.config_json` from stale snapshots. Concurrent cron/webhook activity could erase the newest Short ID or recovery cursor and falsely report success. The new `mutateEasyOrdersConfig` uses tenant-scoped compare-and-swap with bounded retries and monotonic short ID/visited cursor.
2. Recovery had a **global 30-request budget** but always picked connections in `updated_at DESC`. Processing refreshes updated_at; under many connections some could be starved forever. Now least-recently checked connections get the request budget first.
3. Easy Orders external `p.id` is not guaranteed unique across Kun tenants/stores, yet used as global `orders.id` and `ON CONFLICT DO UPDATE` did not scope tenant. The fix retains existing legacy IDs, uses deterministic `EO-<SHA256-prefix>` when a cross-store/tenant collision exists, and guards updates by client/store; status callbacks are scoped to the connection's Kun store as well.
4. Some provider selection paths chose deprecated `config.storeId` before `config.kunStoreId`. The canonical Kun store now has precedence.

## Operator-only read-only diagnosis (required before live promotion)

1. Inspect *deployed* `kunonline`, `kunonline-preview` and `kunonline-sync-preview` versions, service bindings, D1 UUIDs and cron ownership. Verify the dedicated Preview scheduler is deployed, active and that `APP_SYNC` RPC targets the actual `SyncEntrypoint`. Don't infer from GitHub source.
2. Obtain authorized **read-only** D1 metadata for the actual Preview-backed auth/order database. For each affected connection, inspect only scoped `provider,status,updated_at,last_sync_at` and metadata keys `config_json.webhookLastReceivedAt`, `webhookLastStatus`, `webhookLastHttpStatus`, `webhookLastShortId`, `easyOrdersRecoveryHighestShortId`, `easyOrdersRecoveryCursor`, `easyOrdersRecoveryLastRunAt`, `easyOrdersRecoveryLastStatus`, `easyOrdersRecoveryLastError` and sanitized aggregates. Avoid returning webhook route tokens, API keys, customer/order details or decrypted secrets in logs.
3. Compare webhook diagnostics against recovery status *per tenant and selected store*, not merely the aggregate Production `/health/easyorders-sync`. `/api/commerce/order-sync/diagnostics` and `/api/commerce/order-sync/recovery-status` are authenticated; use approved QA accounts and no data mutation.
4. Identify the first affected order date (October 23, 2026) and the last successful webhook receipt. `401` route rejection can arise from a stale registered URL or a rotated HMAC route secret; `401/403` from upstream read indicates an Easy Orders API key/permission issue; `429` implies provider throttling; stale cron timestamps suggest the dedicated scheduler/RPC isn't active. Do not reset credentials without identifying the cause.
5. Verify the same synthetic order in **canonical Preview D1**, `/api/state`, web Customer Service, `/api/mobile/state-sync` and Android Customer Service (including store switching and date filters); ensure both web and mobile show the same order id/state/store and that the order is not filtered out or deduplicated by mistake.
6. No automatic repair/POST to the live provider or D1 before backup, provider-rate-limit consideration, schema verification and explicit authorized release. An approved manual reconcile should be idempotent and measured by actual newly recovered orders, not a `200` from an API alone.

## Test proof for this Draft hotfix

`npm run test:easyorders-sync-concurrency` exercises real in-memory SQLite for racing config updates, monotonic Short ID, recovery fairness and tenant/store-safe order/status upserts. Full `npm test`, `scripts/mobile-state-sync-test.mjs` and `scripts/dashboard-sync-guard-test.mjs` are CI-gated on Linux; the sync fixture also runs on Windows. No worker publish, production database changes or Android signed release is included.

**Release gate:** This PR targets `main` separately from Draft audit PR #209; merging to `main` can trigger automatic Production deployment. It MUST remain Draft until exact-head CI, read-only live environment diagnostics, rollback and authorized release approval are complete.
