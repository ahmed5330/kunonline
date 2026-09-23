# Android v2.6.3 mobile sync

The visible home/orders screen polls every 15 seconds. Customer service has its own
15-second poll, and the global poll pauses while customer service or settings is
selected. `repeatOnLifecycle(RESUMED)` stops recurring work when the activity pauses
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
