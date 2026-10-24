# Easy Orders incident — release checklist and stop/go criteria

**As of October 24, 2026:** fixes are tested in **Draft** PR #225 (Production gateway), #226 (canonical Preview/data Worker), and #209 (larger unrelated auth audit); **none are live**. One public, anonymous **read-only** health check at 13:37 UTC still reported **2 Easy Orders integrations / 1 healthy / 1 error**, `EASYORDERS_SYNC_ERROR`, with **zero** invalid or unreadable API keys. The dedicated `kunonline-sync-preview` worker responds on `/healthz`, but an HTTP-200 RPC health response **does not prove scheduled Cron execution**.

## Known verified code defects, with synthetic regression coverage

- Concurrent webhooks and recovery jobs overwrote `store_connections.config_json`; tenant-scoped CAS/monotonic checkpoints prevent regression.
- Same Easy Orders external ID can exist in different clients/stores; Kun IDs and status callbacks are store scoped and retry cross-tenant insert races.
- Global 30-request Cron budget could indefinitely starve stores; least-recently-checked scheduling rotates opportunities.
- Unverified external store must fail closed; recovery ignores records belonging to other verified external stores.
- HTTP 429 and HTTP 503 with misleading `record not found` body must NOT increment cursor beyond the unread Short ID; unsuccessful HTTP attempts consume budget.
- A recovery attempt with actual provider errors/rate-limiting reports `ok:false`, even if other integrations succeeded. Ordinary budget deferral is not an error.
- The five-minute RPC now converts failed recovery results into sanitized thrown error codes, so Cloudflare Cron is not falsely successful.
- Newly recovered orders' management fee reconciliation now reports attempted/failed counts; a fee failure is reflected in failed Cron status instead of being silently swallowed. No fee rate/formula changed, and committed orders are retained on an accounting failure. Existing scheduled management-fee reconciliation can independently detect missing/reversed shipped-order fees, but must itself be validated against the live schema before release.
- The real Production gateway's tenant-scoped dashboard/Android source transport and stalled-scheduler warning have separate fake tests.

## Mandatory privileged read-only diagnosis — no deployment yet

1. Obtain explicit approval to access the **protected Preview GitHub environment** and use a scoped Cloudflare read-only token (or equivalent approved Cloudflare-console access). The GET-only metadata workflow from Draft PR #227 failed at the environment gate **before any step ran**. **Never bypass the approval by moving Cloudflare credentials into an unprotected workflow.**
2. Inventory effective deployed bindings/triggers and Worker versions of `kunonline-sync-preview`, `kunonline-preview`, and `kunonline`. Expected: scheduler Cron `*/5 * * * *`, `APP_SYNC` service binding to `kunonline-preview` with `SyncEntrypoint`; the Production gateway uses `PREVIEW_APP` and `PREVIEW_DB`. Verify deployed versions, not only `wrangler.toml`.
3. Inspect **only safe aggregate fields** on the actual bound Preview D1, not a guessed database UUID. This read-only query reports no customer rows or secrets:
   ```sql
   SELECT COUNT(*) AS connections,
     SUM(CASE WHEN json_extract(config_json,'$.easyOrdersRecoveryLastStatus')='error' THEN 1 ELSE 0 END) AS error_count,
     SUM(CASE WHEN json_extract(config_json,'$.easyOrdersRecoveryLastStatus')='rate_limited' THEN 1 ELSE 0 END) AS throttled_count,
     SUM(CASE WHEN json_extract(config_json,'$.easyOrdersRecoveryLastRunAt') IS NULL THEN 1 ELSE 0 END) AS never_checked
   FROM store_connections WHERE provider='easyorders' AND status='connected';
   ```
   Only with explicit operator access, separately inspect the one affected connection's sanitized `last_error` **internally** without copying provider error bodies, routes, keys, customer names/phones, order content, or D1 UUIDs into chat/CI logs.
4. Check Cloudflare cron execution history and retry/runtime errors, upstream Easy Orders `401/403/429/5xx` results, connection's known external-store binding and last Short ID/cursor. A successful scheduler `/healthz` is insufficient. Do not reset otherwise valid API keys or remove/rebind webhooks blindly.
5. Compare last received webhook and last recovery timestamp against missing orders from October 23 onward **within the authorized store only**. Preserve raw provider IDs and Kun IDs; do not invent missing order counts from aggregated health.

## Controlled release — only after prerequisites above

1. Record actual **Production/Preview Worker versions and D1 binding IDs**, backup the correct canonical Preview D1, verify backup retention/restoration ability and compatible migration ledger. Fix the parent PR #209's conflicting session-revocation migrations separately; the Easy Orders PRs do not require the auth schema change.
2. Approve a short release window, prepare exact rollback commands using previously recorded deployed Worker versions. Stage the **canonical Preview Worker** changes in PR #226 and separately review the dedicated scheduler Worker source/binding; independently approve any Cron deployment. Avoid a blind merge: develop/Preview may serve real Production orders.
3. Use a verified isolated store/API test connection and synthetic Easy Orders webhooks/API fixtures before replaying real missing orders. Verify that two external shops with the same order ID remain separate, HTTP 429/503 retry preserves the cursor, the manual and Cron response statuses are truthful, and fee reconciliation handles both shipped and pending orders idempotently.
4. Once authorized, run an idempotent, bounded recovery for affected connection(s), preserve rate-limit budget, compare actual previously missing IDs with recovered canonical Preview D1 IDs **inside a restricted diagnostic context**. Avoid exposing any PII.
5. Confirm exactly the same scoped orders/states are visible in web Customer Service and Android `/api/mobile/state-sync`, including switching between stores, cancellation/shipping status, call notes and date filters.
6. Review the Production gateway PR #225 rollout independently; validate new scoped dashboard stale-Cron indicators and post-deploy smoke tests. Main merges can automatically deploy; keep the PR Draft until signed off.
7. Confirm the failing connection becomes healthy or has a proven diagnosed upstream block, Cron ticks at five-minute intervals, no new order gaps accumulate, and accounting fees are consistent. If smoke fails, **rollback Worker version and stop manual recovery**, leaving customer orders intact; do not revert already committed customer D1 changes blindly.

## Evidence and release blockers

- Public live health, no credentials: https://github.com/ahmed5330/kunonline/actions/runs/40094356960 (attempt 2).
- Protected Preview GET-only Worker inventory stopped before execution: https://github.com/ahmed5330/kunonline/actions/runs/40093947315.
- Source CI exact SHA evidence: PR #225, #226 and #209 Actions attached to their current heads. A green CI SHA is *not* permission to deploy.
- **No cloud database, Worker deployments, customer order recovery or APK signing occurred in these audit tests.** Do not label the incident resolved until live post-release verification proves it.
