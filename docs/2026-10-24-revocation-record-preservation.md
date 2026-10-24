# Kun Online — revocation record preservation, synthetic proof and release block

**Status: Offline-only planning. Production, Preview and their D1 databases were not queried or modified.**

## Known competing migrations

`main@45414bb` defines `migrations/0099_revoked_sessions.sql` with `revoked_sessions(token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`. Draft PR #209 defines `migrations/2026-10-23-session-revocation.sql` with `revoked_session_tokens(token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, revoked_at TEXT NOT NULL)`. Both are SHA-256 fingerprint stores but are **not automatically interchangeable**.

The companion offline test `scripts/session-revocation-preservation-sqlite-test.mjs` creates both exact synthetic schemas in SQLite and validates the **unapplied** proposed copy expression in `scripts/session-revocation-preservation-plan.mjs`. The algorithm inserts old-table fingerprints into the new table and, when a fingerprint already exists in both, retains the **maximum expiration timestamp**. It does not drop either table, discard canonical-only tokens, or modify the original timestamp for existing canonical rows. The sentinel `1970-01-01T00:00:00.000Z` is expressly an *unknown original revocation time*, not a real event timestamp.

## Race that prevents a blind migration

The test demonstrates a real correctness hazard: after the initial copy, an existing Worker can append a newly logged-out fingerprint to `revoked_sessions`. Until another copy occurs, the PR Worker that only reads `revoked_session_tokens` would incorrectly accept that still-unexpired session. **One offline migration copy is NOT sufficient to guarantee safety during a mixed-version cutover.** A safe live plan must prove exclusive or quiesced authentication traffic during final synchronization, or separately design and verify a compatible two-way bridging protocol with appropriate concurrency safeguards. No such traffic freeze or bridge is assumed or authorized in this PR.

Likewise the new Worker could issue canonical-only logouts that an old Worker using the legacy table would not recognize; the rollout must avoid overlapping inconsistent auth routes. Both old and new Worker versions must be inventoried before any state-changing action.

## Release gates (none waived by these tests)

1. Inspect actual remote D1 table metadata, counts and migration ledger using `npm run audit:session-schema:read-only` with authorized credentials, separately inspect effective Production `PREVIEW_APP` and `PREVIEW_DB` bindings and currently deployed Preview authentication Worker version. The repository config alone does not establish deployed state.
2. Choose **one canonical schema**, verify expiry types and SHA-256 input parity, and prepare an explicit migration **per affected database**. No drop/rename/copy on a live D1 before backup, bounded transaction plan, rollback test and independent approval.
3. Provision entirely new sandbox Worker+D1 with unique resource IDs and **no** real integrations or secrets. Run the synthetic two-device logout/replay test against the actual sandbox runtime, and measure what happens under simulated concurrent writes and failures.
4. Develop a documented traffic-quiescence or verified safe bridge plan. Reconcile active records *after* old writers stop and *before* new readers accept sessions; verify aggregate `missing_or_shortened` equals zero. A read-only aggregate alone does not prove no concurrent writes.
5. Back up data, prove restore, require an approved deployment window, deploy real auth Worker in correct order, then run synthetic account sign-in/logout/replay and check the effective bindings. Restore the known working version if verification fails.

## Offline checks

```bash
node scripts/session-revocation-preservation-sqlite-test.mjs
npm test
```

The proposed `INSERT ... SELECT ... ON CONFLICT` SQL is **reference material**, intentionally stored outside `migrations/`; nothing invokes it against Cloudflare. Its test verifies preservation, idempotency, rollback, incomplete cutover replication and missing-table failure. A green test means these synthetic properties hold, **not** that live D1 is reconciled, Production is safe to deploy, or a real migration ran.
