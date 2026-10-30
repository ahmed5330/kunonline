# Android v2.6.3 mobile sync

The visible home/orders screen polls every 15 seconds. Customer service has its own
15-second poll. The global poll pauses in settings, but stays active during
customer service to keep the complete caller-ID cache current (the board only
contains selected order stages). `repeatOnLifecycle(RESUMED)` stops recurring work when the activity pauses
and refreshes immediately when it resumes. An already running blocking HTTP read
may finish; the periodic background caller cache job remains separate.

Account/store discovery is cached in memory for five minutes, keyed by the exact
session cookie. Manual full refresh and logout invalidate it. Server-side access
checks still run for EVERY sync request; cached scope is never an authorization.

`/api/mobile/state-sync` and `/api/mobile/board-sync` delegate to the existing
state/board sources, then return protocol 1 envelopes:

- `reset`: complete authorized state and opaque cursor.
- `unchanged`: cursor only; no caller-cache rewrite.
- `delta`: changed/new orders, deleted IDs, authoritative order sequence, replaced
  non-order fields and removed fields. The client commits the merge atomically.

Baselines are keyed by session, source URL/tenant/store and store header. They are
in-memory, expire after two minutes, and share an 8 MiB serialized-text budget per
Worker isolate. Eviction, another isolate, deployment or invalid cursor causes a
safe reset. No database tables, indexes, triggers or production data are changed.
Existing APKs keep their original APIs. A new APK temporarily falls back to the
legacy source if a sync endpoint is unavailable (404/405); authentication errors
never trigger fallback around access controls.

## Resource claims and limits

A normal home/orders poll falls from about three external requests to one after
scope warm-up. Unchanged responses and deltas reduce transferred bytes. Source D1
queries still run through the established route: this is NOT a change-data-capture
feed and does not claim to eliminate order scans. Measure Workers requests and D1
`rows_read` independently before quantifying database savings. Incremental DB reads
would require a reliable revision/change log across all write paths, including
imports, shipping and deletions; that is intentionally not approximated with an
incomplete timestamp or an in-memory invalidation flag.

## Validation

- `node scripts/mobile-state-sync-test.mjs`: auth revocation, tenant/session scope,
  deletions, updates, ordering, empty collections, expiry and memory eviction.
- `gradle -p android test assembleRelease`: Android build and atomic merge tests.
- Production smoke checks reject unauthenticated access to both new sync routes.
- Device acceptance: log in, observe a new/edited/deleted order, switch tabs,
  background/resume, log out and switch accounts. Confirm paused recurring polls
  and preserved caller cache; upgrade must retain the installed app's data.

## 2026-10-30: encrypted cold-start cache (branch-only)

Android now saves the last **successfully authenticated, validated** `/api/state`
snapshot in an AES-GCM-encrypted SQLite record inside private app storage.
The encryption key is held in Android Keystore, not in the database.
The cache is keyed by SHA-256 of the session cookie and the explicitly
selected store; the application deletes the previous key's snapshot after an
account/store switch, and clears snapshots on logout/expired session. The copy
is limited to seven days, never authorizes writes, and never bypasses backend
ACL checks. Android backup is disabled. Cache failure does not fail an
otherwise successful API response.

On a cold start the Compose UI reads the encrypted snapshot on a background
IO dispatcher and can render orders even if the first network attempt fails.
It *always* revalidates online after store discovery. A newer live snapshot
wins over the disk copy. This is **offline display only**: user actions still
require server acknowledgement and are not silently queued or marked complete.

**Important limitation:** the Worker still keeps cursor baselines in a short-lived,
per-isolate memory cache; a server restart or expired cursor may send a full
snapshot. Local persistence avoids an empty first screen but does not yet stop
all full network transfers or deliver guaranteed real-time updates. The
Android `JobScheduler` task is best-effort (period 15 minutes, potentially
deferred by Doze); it is not a push channel.

### Remaining architectural work (not implemented by this branch)

1. Add a transactionally written, tenant/store-scoped order change journal in
   D1 for **every** mutation source: staff state edits, shipping, imports,
   Easy Orders, deletions and external webhooks. Cursor should be a monotonic
   persisted sequence plus access-control revision and use a retention window;
   gaps and permission changes must request a safe full rebase. Audit all write
   paths before any migration.
2. Reconcile optimistic edits with an explicit order revision and
   `If-Match`/version constraint; reject conflicts rather than silently
   overwriting newer data. Use durable idempotency keys for accepted writes.
   Only then consider an offline mutation outbox with retry and conflict UX.
3. Register Android installations for FCM push (requires Firebase project,
   Android app credentials, server-side service account/secret and device
   token lifecycle). Send **store-scoped event IDs, not customer PII** in
   pushes, then fetch authorized delta when the device wakes. Treat push as
   an invalidation hint: Android may be offline, force-stopped, power-limited,
   or have notifications denied. Always reconcile on reopening.
4. Measure D1 reads, p95 freshness latency, missed mutations, background
   delivery, and full-resets before changing the 60-second home polling
   interval. Do not raise costly full-state scan frequency blindly.

### Acceptance checklist for the cold-start branch

- CI: `gradle -p android test assembleDebug` (including
  `MobileSnapshotCacheTest`), no production access.
- Device: login, sync, force-stop, launch offline, see previous orders; reconnect
  and confirm server changes override them; verify local date filter behavior.
- Switch to a second store and another account with no network, confirm previous
  store/account orders are never displayed; logout and confirm cache cleared.
- Revoke user access while the device is online, confirm 401/403 clears cached
  data. Offline cached display is stale and cannot be treated as renewed access.
- Kill the Worker and expire delta cursor in a sandbox, confirm rebase is
  idempotent and has no duplicate orders; test multi-device simultaneous state
  edits and Easy Orders webhook replay with production data isolated.
