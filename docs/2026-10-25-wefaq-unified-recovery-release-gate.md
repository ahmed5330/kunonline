# Kun Online / وفاق — Easy Orders unified recovery release gate
**Date:** 25 October 2026 | **State:** code-only candidate; no live recovery executed.

## What this candidate combines
- #226: safe Easy Orders webhook/Cron sync, CAS checkpoints, fair per-store scheduler, 429/503 handling, quota pause.
- #230: read-only historical Short ID gap audit, explicit client/store/connection identity.
- #231: disabled-by-default admin-only targeted replay, real canonical create-only import, safe financial fee reconciliation, no rewinding global cursor.
- #232: outer Preview Worker build attestation, not inherited inner v35/v36 labels.
- #234 (this candidate): one complete CI gate, 404 unresolved queue is never falsely healthy, real default importer+SQLite end-to-end regression, independent Worker/Cron dry-bundle tests.

**Do not merge into `main`, `develop/ux-system-upgrade`, or deploy to the current Preview/Production** based only on this document. The existing Preview D1 may contain real customer orders.

## Pre-release gate (requires authorized Cloudflare operator)
- [ ] Protected `preview` environment GitHub Actions run #227 actually completes with readable (redacted) steps. Last run 40093947315 failed before any job steps (no attribution of cause).
- [ ] Verify account ID, Worker deployed script/sha, Cron triggers and service binding for `kunonline`, `kunonline-preview`, `kunonline-sync-preview`; identify the **effective** D1 database for live Wefaq orders rather than trusting a similarly named preview DB.
- [ ] Verify Wefaq's current Kun `clientId`, `storeId`, Easy Orders `connectionId`, and provider `external_store_id` from owner-authorized configuration. Public global health reports 2 integrations / 1 error; it **cannot** identify Wefaq.
- [ ] Export or create a point-in-time backup **of the actual live D1** and rehearse restoration against an isolated database. Record restore test and backup reference privately.
- [ ] Deploy only to isolated Sandbox Worker and isolated D1, not the existing `kunonline-preview` that handles live orders. Complete compatible schema tests; do not merge PR #209's session migration conflicts.
- [ ] Check all unit/SQLite CI tests and both Preview/Scheduler Wrangler **dry-run bundles** on PR #234.
- [ ] Confirm the provider's per-minute quota before any 30-ID read-only batch; stop on 429/403/5xx and resume at the exact unprocessed Short ID.

## Read-only historical gap verification — Wefaq
With an operator-authorized `orders.read` session, use `POST /api/commerce/order-sync/audit-gaps` only after the candidate is safely deployed to an approved environment. Request explicit `clientId`, `storeId`, `connectionId` and inclusive `fromShortId/toShortId` (maximum 30 IDs/batch). The source IDs and dates must come from the actual Wefaq provider order list, not sample numbers, the 666 old-order count or another store's IDs.

Classify and log redacted:
1. Present in provider and Kun, same exact tenant/store: **alreadyInKun** — NEVER import again.
2. Present in provider but absent from Kun in correct store: **gaps** — approved for selective replay only.
3. HTTP 404: **missingAtProvider** (could arrive late) — retry as required; no fake success.
4. Provider belongs to another store: **foreignStoreSkipped** — never write across tenants.
5. Older unscoped order ID collision: **ambiguousLegacyOrders** — operator review; do not import automatically.

## Replay under separate write approval
- [ ] Feature `EASYORDERS_TARGETED_RECOVERY_ENABLED` disabled by default. Only the verified operator can explicitly enable it for a short window after documenting the D1 backup and its restore test.
- [ ] Request via authenticated `orders.write` **platform admin** identity; provide matching `confirmStoreId` and `confirmBackup:true` only when backed up.
- [ ] Submit at most **10 confirmed missing Short IDs** per `POST /api/commerce/order-sync/recover-gaps` request. Do not send any unverified sample IDs.
- [ ] Use create-only canonical webhook semantics. If an order exists or another webhook wins the race, skip it and preserve shipping status, staff notes, calls, history and accounting values.
- [ ] Stop at 429/5xx, record the exact retry Short ID, and check feeFailures. Do not claim financial success until fee reconciliation checks pass.
- [ ] Resolve `EASYORDERS_RECOVERY_LEGACY_ORDER_AMBIGUOUS` manually for orders with `store_id IS NULL`; the recovery intentionally does **not** bind them to Wefaq or rewrite their state. Do not bypass this check to make counts match.
- [ ] Treat any `unresolvedAheadCount>0` as `catching_up`, even when `nextShortId>highestShortId`; do not close the incident while queued 404 Short IDs remain.
- [ ] Return feature flag to **disabled** as soon as the approved replay is over.

## Acceptance criteria: prove recovery, do not assume
- [ ] Authoritative provider↔Kun IDs for **all desired Wefaq ranges** exactly match; confirmed missing gaps = 0, with unresolved 404/legacy collisions tracked separately.
- [ ] The same orders and stages appear in web Orders, Customer Service, Printing, J&T transitions and Android (version compatibility tested).
- [ ] Store totals and FAOS accounting, management fees, delivered/collected orders and wallet balances remain consistent.
- [ ] 2+ successive five-minute scheduled Cron executions have **actual** Cron receipts and no replay/gap regressions; HTTP 200 health alone is insufficient.
- [ ] Only then approve release of separately reviewed production health #225, tenant-scoped diagnostics #233 and signed Android UI/performance #229.
- [ ] If a live incident occurs: stop replay, disable flag, revert only the Worker deployment; do **not** blindly roll back customer order rows.

## Auditable results as of candidate preparation
The offline suite tests real in-memory SQLite, provider fakes, canonical webhook default selective importer, replay idempotency, wrong-store rejection, 404/429/503, fee failure handling, Cron priority, job errors, and outer version attestation. Github CI tracks actual pass/fail per SHA. **No Wefaq live customer rows or real provider API credentials have been read through this chat. No real live order was restored.**
