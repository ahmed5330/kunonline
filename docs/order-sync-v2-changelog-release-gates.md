# Orders synchronization v2 — staged D1 change feed (2026-10-31)

Status: **code and synthetic QA only**. Not live, not a complete push architecture.

## Problem and invariant

The currently deployed `/api/mobile/state-sync` compares whole authorised
`/api/state` snapshots in a Worker-local, short-lived cache. Worker restarts
and expiry can trigger full resets and the request still reads D1. Android
v2.9.22 (Build 153) persists an encrypted offline snapshot, but it does not
give reliable background push or conflict-safe offline writes.

A new change feed MUST NOT claim an order update succeeded before D1
acknowledgement, MUST NOT use a cached ACL for access, and MUST never return
a false `unchanged` when journal/authorization is down.

## What this branch implements

- Unapplied SQL migration `migrations/0100_order_change_journal.sql` creates
  `order_change_log`, scoped index and three database triggers (INSERT/UPDATE/
  DELETE). This captures order writes from every path using the canonical
  `orders` table, including webhook and shipping handlers, inside their
  existing database transaction. No PII or order JSON is stored in events.
- An UPDATE that does not change tracked order fields emits no event. A
  change of tenant/store emits a tombstone in the prior scope and an upsert
  in the new scope. DELETE emits a tombstone. Rollback rolls back the
  journal entry.
- `GET /api/mobile/order-changes` is disabled unless
  `ORDER_CHANGE_FEED_ENABLED=1` **and** migration 0100 is present in the
  canonical DB. It checks real user access through
  `/api/mobile/store-options` on every poll; optional caller-supplied
  `clientId` and `storeId` can narrow authorised scopes, never expand them.
- Cursor HMAC is tied to the authenticated session, active authorised store
  grants and requested scope, and is stable across Worker isolates. It uses
  `SESSION_SECRET` that is already environment-managed (never exposed).
- Initial/invalid/revoked-scope/too-old cursor returns `mode=reset`, forcing
  an authoritative full fetch. `mode=changes` returns up to 50 ordered IDs
  and operations with `hasMore` pagination; `unchanged` is returned only
  after a successful D1 and live-ACL query. Missing migration returns 503
  with `resetRequired`.
- Order IDs are **invalidation hints only**. The client must retrieve the
  existing ACL-checked order state or detail endpoint and must not treat an
  ID from this feed as proof of customer data access or mutation success.

## Android consumer on this branch (not yet released)

- `MobileOrderChangeFeed.kt` fetches the feature-gated endpoint in the foreground.
  It persists the cursor with Android Keystore encryption scoped to the session
  and selected client/store, and clears the cursor on login, logout and switching.
- When a changed/reset hint arrives, the app first fetches a full authorised
  snapshot. Only after that succeeds does it commit the proposed cursor.
  `unchanged` can advance the cursor after successful server-side ACL checks
  while the app retains a previously authenticated snapshot.
- The foreground UI checks hints every 15 seconds when enabled and keeps its
  existing authoritative 60-second reconciliation for **non-order** changes,
  expired sessions, unavailable endpoints and missed hints. It does not
  increase full-state requests to every 15 seconds.
- 404/405/503 pauses hint attempts for five minutes while normal full-state
  sync remains active; a malformed response cannot be acknowledged.
- Android build number intentionally stays unchanged in the **draft** branch.
  A release build version increment and signed-APK QA gate are required before
  merging any Android changes into main.

### Remaining Android acceptance tests

- [ ] Unit and Gradle build green for the latest exact PR HEAD.
- [ ] Two real devices + browser: insert/update/delete, move between stores,
  stale cursor, revoked grants, offline/online, cold start and >50 event backlog.
- [ ] Android idle battery/network measurements; do not publish until
  incremental mode saves actual D1 reads.
- [ ] Confirm feature flag remains OFF before migration approval and that
  missing schema causes the safe legacy sync path without user-visible breakage.

## Hardening and schema-contract findings (31 October)

- A schema-accurate synthetic test now starts with the actual original
  `orders` DDL in migration 0001 and applies all order columns from 0013,
  0020, 0024 and 0090. It explicitly compares **every** real migrated
  column with the UPDATE trigger guard: contact-claim, J&T address and
  shipping-finance edits must emit change IDs. A primary-key change emits
  a tombstone for the previous ID. Existing D1 versions must still be
  audited before applying migration 0100.
- The outer Worker returns an explicit JSON HTTP 404 when
  `ORDER_CHANGE_FEED_ENABLED` is absent, rather than forwarding an unknown
  route to Preview. A disabled route or malformed HTTP 200 response cannot
  cause repeated full state scans every 15 seconds.
- Android never holds a synchronized cursor lock across the network
  call. Logging out or switching stores can revoke its local cursor even
  during a request timeout. Malformed/server-error hints back off without
  interfering with the 60-second authorized refresh.
- Tests additionally cover bad HMAC cursors, multiple authorized stores,
  grant revocation and prefix-retention gaps. Do **not** prune arbitrary
  events out of the middle of the journal; retention must be prefix-based
  with a safe gap-detection checkpoint.

### Production schema and cost gates

The configured Production Worker uses `PREVIEW_DB` as the canonical
customer-data binding in `previewRuntimeEnv`. A migration on only the
separate Production `DB` would **not** enable the endpoint. Both binding
identity and migration ledger must be confirmed read-only before choosing
the actual target D1. This document does not authorize writing either DB.

Before any migration, check with read-only diagnostics that `orders` has
all columns referenced by the trigger, and count legacy records with
`store_id IS NULL`. Null-store orders cannot safely be assigned to a
particular employee's store event feed; resolve them under the existing
canonical authorization rules before relying on incremental delivery.

**Important cost limitation:** every 15-second hint currently checks the
live store ACL and queries the journal. The app also retains full-state
reconciliation every 60 seconds for non-order changes. That means this
stage improves detection latency but does **not yet** guarantee fewer D1
reads or lower cost than the original implementation. Benchmark requests,
rows_read, per-device battery/network and p95 latency under realistic
concurrency before enabling the flag. Do not claim efficient delta
synchronization until the authoritative data path actually fetches only
changed rows and uses durable checkpoints.

## Known boundaries

This journal tracks the `orders` table only, not related catalog,
accounting, contact, collaboration and shipping tables. Thus existing
`state-sync` / `board-sync` are still the authoritative full-state
transport, and may continue scanning D1 for unrelated changes. External
providers must first commit to canonical D1. A notification in an incoming
provider queue without a canonical write is not yet an order change.

A per-user journal *hint* does not itself deliver push while the app is
closed. True background event delivery requires Firebase project
registration, Android FCM configuration and server credentials; no such
credentials are embedded in this repository or added by this PR. Android
OS may defer/stop delivery under Doze, force-stop, user permission changes
or prolonged offline periods. The next foreground sync must reconcile.

Offline mutation outbox is **not enabled** until each write route supports
server-enforced `order_version` preconditions and durable idempotency. Blind
retry of legacy order mutations can duplicate orders or overwrite another
employee's changes.

## Rollout/rollback gates — not authorized by this PR

1. Inventory canonical Preview/Production D1 versions, existing migration
   ledgers, triggers, table columns and backup/restore points read-only.
2. Execute migration 0100 **only in an isolated throwaway D1 sandbox**;
   run schema compatibility, concurrent replay, webhook, shipping, edits,
   rollback, tenant transfer and delete tests with synthetic fixtures.
3. Confirm trusted owner approval for a separate canonical DB schema
   migration, backup, rollback and expected D1 cost.
4. Stage feature flag disabled and run no live database writes until
   migration is applied and verified. Flag remains OFF by default.
5. Add client consumption behind capability negotiation, with initial
   full snapshot **after** reading reset cursor and atomic cursor commit
   **only after** successful authorised state save.
6. Measure max journal lag, p95 order freshness, rows_read vs full scan,
   missed updates, 50-event pagination, 401/403, multi-store grants and
   long-disconnected reset. Retention pruning must preserve a safe
   oldest-sequence checkpoint to detect gaps; don't simply truncate.
7. For FCM, use device-scoped token registration, ACL recheck and event IDs
   (never PII) as push payload, re-sync after wake, and revocation cleanup.
   Never publish Firebase service credentials to GitHub or client code.

## Offline tests

`node scripts/mobile-order-change-journal-sqlite-test.mjs`

This uses `node:sqlite` on Node 22 with a disposable in-memory SQLite DB.
It verifies atomic insert/update/delete/transfer/rollback, tenant/store
boundaries, session-binding, paging and 503 on schema absence. Tests are
CI-gated by PR validation and use only synthetic data.

**Reminder:** This is phase 2 scaffolding, not a claim that live sync
has been converted or that Firebase background notifications are working.
