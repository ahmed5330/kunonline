# Root-cause audit: Easy Orders missing orders and Android 0 Today (23–24 October 2026)

Date: 2026-10-24 (Africa/Cairo). Scope: Kun Online / وفاق. **No live Wefaq customer records were accessed, edited, or recovered** in this investigation. This is an evidence-based code/release review, not a claim of a completed production recovery.

## Grounded outcomes

### 1. What ChatGPT changed yesterday (23 Oct)

- **PR #210** merged into `main` at 2026-10-23 15:47:09 UTC; its file changes were Android notifications, deep links, test fixture, and `src/mobile-order-alerts.js` enrichment. It did **not** directly edit the Easy Orders webhook, recovery scanner, scheduler, or order table. Therefore no evidence that PR #210 alone broke upstream Easy Orders ingestion.
- Android stable v2.9.17 Build 148 was built, signed and published by [workflow 39981253241](https://github.com/ahmed5330/kunonline/actions/runs/39981253241), success.
- Production [workflow 39981253275](https://github.com/ahmed5330/kunonline/actions/runs/39981253275) has overall **cancelled** conclusion, but crucially its step **Deploy production Worker only — no migrations succeeded**, and initial live dashboard/asset checks succeeded. Later *Android update feed verification was cancelled* and remaining checks skipped. Thus **deploy happened, smoke-test completion did not**. Do not mislabel as "no deploy" or "release fully verified".
- PR #209 with auth/COD/session and SYNC-01 is draft/unmerged; its migration changes could not have caused the live incident by themselves. Avoid merging it wholesale with conflicting session revocation migrations.
- Oct 23 merges #204/#206/#207 touched AI integrations and MCP; their primary diff does not show a direct Easy Orders recovery scanner change. No proof those deployments caused Wefaq gaps.

### 2. Independent pre-existing code defects that can cause persistent missing orders

Source history places `src/easyorders-order-reconciliation.js` core changes on **30–31 Aug 2026** and dedicated scheduler logic on **31 Aug–6 Sep 2026**, i.e. **before** yesterday.
- **Checkpoint skip on 429:** historical `reconcileConnection` loop in `main` increments cursor after `inspect(cursor)` even when that call responds with rate limiting. A later retry may never revisit that Short ID. PR #226 corrects this and fake SQLite tests cover it.
- **Misclassified provider failures:** historical `easyOrdersGet` could treat a non-404 5xx carrying a "not found"-looking message as a missing order, allowing the cursor to advance. PR #226 requires real HTTP 404 or successful explicit not-found payload; 401/403/5xx fail closed.
- **Concurrent config overwrite:** a Webhook update to high-water/short-id state can be lost when scheduler reads/writes the same config non-atomically. PR #226 CAS reconciliation addresses this.
- **Unequal Cron budgets:** sorting by connection `updated_at` can repeatedly allocate limited provider calls to the same connections; others may starve. PR #226 distributes by least recently checked.
- **Incorrect tenant/store match:** legacy existence lookup can treat same external order ID on a different store as already imported. PR #226 and #231 add precise tenant/store collision handling and create-only imports.
- **Historical gaps outside scan horizon:** lookback=80 IDs cannot prove older gaps filled. PR #230 adds explicit **read-only** bounded historical scan; PR #231 adds feature-gated admin-only create-only replay preserving notes and shipped/confirmed state, with fake tests passing. Neither is deployed.

These defects are **plausible mechanisms**, not proof of which one lost which real Wefaq order; that requires source↔Kun D1 ID comparison.

### 3. Misleading diagnostics we verified

- Main frontend `modules-v121-dashboard-sync-guard.js` reads public platform aggregate `/health/easyorders-sync` and can show an error to an unrelated tenant. Public health reports two integrations / one error but cannot identify Wefaq. Extracted tenant-and-store-specific fix as independent **Draft PR #233**, without PR #209's auth migrations. Latest automated tests passed on head e3ba4ec1a6dd445c22f25cb904cd91de906f012a.
- Configured Preview entrypoint is `src/index-commerce-v38.js`, but GET `/api/preview/version` delegates to inner v36 route and RPC health inherits v35 `build`. Therefore **a v36/v35 public build label does not prove the deployed outer Worker is stale.** Draft **PR #232** adds explicit outer entrypoint build attestation; its fake checks passed. Only the approved Cloudflare deployment inventory proves deployed versions.
- Scheduler GET /healthz returning HTTP 200 proves RPC reachability, **not** that the five-minute Cron executed or imported orders.
- Android Today=0 / Other periods=666 proves only the filtered view. It does not establish 666 missing orders, nor that current-day Easy Orders source orders exist. PR #229 (unpublished Android v2.9.18 Build 149 candidate) repairs local date fallback and redundant filter/network refresh. It cannot import missing source orders.

### 4. Validated fixes and blocked rollout path

Proposed staging chain (all draft, no merge without protected approval):
1. **Cloudflare read-only inventory #227**: identify production gateway, canonical Preview D1, scheduler service RPC target, actual deployed versions and Cron history. Existing job 40093947315 failed before providing usable diagnostic steps; failure reason unverified. Don't assume secrets or approval solely from its failure.
2. Independently verify Wefaq's exact client/store/connection IDs and source Short IDs; no inference from global counts or stale historical identifiers. Audit and backup the **actual** canonical D1, never a merely named database.
3. Release **Preview recovery #226** in an isolated Sandbox first (not live-linked Preview), run synthetic collision/429/503 and fee tests and confirm acceptance. Production gateway health **#225** needs its own scoped rollout validation.
4. Run scoped historical gap audit **#230**, compare provider IDs to authorised D1, then selectively recover only confirmed missing IDs via **#231** with flag disabled by default, store/tenant authorization, verified backup and explicit admin approval. No overwrite of existing shipped/confirmed orders.
5. Validate web Customer Service, printing, mobile state sync, date views, notification feed, and financial fees against the **same** scoped provider order set.
6. Merge/deploy focused tenant health **#233** separately and ship **#229** signed Android only after compatible backend acceptance; read changes are not evidence of recovered orders.
7. Verify repeated Cron runs and disappearance of gaps; record imported IDs/counts privately without PII in CI logs; revert Worker version on failed smoke, not live customer rows.

## Latest live checks and constraints

The last public health check (Oct 24 ~20:27 Cairo) returned HTTP 200 from scheduler and Preview, but an aggregate app-level `EASYORDERS_SYNC_ERROR` with 2 connected / 1 healthy / 1 failing. These counts **do not identify Wefaq**. Canonical operator-only D1 and provider data access is unavailable from this chat; no live Wefaq order recovery performed. Protected Cloudflare diagnostic workflow failed before completing, so neither a specific credential failure nor broken Cron schedule is confirmed.

**Status:** isolated code corrections and synthetic tests done, actual Wefaq root cause / missing IDs / live recovery **not yet proven**. Never mark resolved until authenticated two-system reconciliation on 23–24 Oct and backfill confirm real orders.
