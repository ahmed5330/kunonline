# SEC-02 — Dual-table compatibility bridge (not activated)

**This is a tested, UNWIRED implementation candidate**, not a production fix or an authorization to update Production/Preview. The current PR #209 active Worker still reads/writes `revoked_session_tokens` only. `src/session-revocation-compatibility-bridge.js` is intentionally not imported into `src/index.js` or any Worker entrypoint. The bridge is proposed to avoid the legacy/new Worker logout race demonstrated by `session-revocation-preservation-sqlite-test.mjs`.

## Bridge invariants

- **Read:** SHA-256 of the exact session cookie; query *both* `revoked_sessions` (main 0099) and `revoked_session_tokens` (PR schema). A hash found in either denies the bearer. If either table/query is missing or fails, reject authentication; never silently fall back to the available registry.
- **Write:** Record the same SHA-256 digest in both tables via one `D1Database.batch()` operation (Cloudflare's supported all-or-nothing batch contract); enforce `success: true` for both results. No fallback to independent writes. Do not shorten expiry on repeated logouts, never copy raw token/cookie.
- **Mixed-Worker overlap:** old Worker may write only the legacy table while a new Worker reads both; new Worker writes both, so old and new readers reject newly logged-out sessions. The mechanism is contingent on **all old and new Worker paths using the same actual D1 instance and hash encoding**. Verify real Production `PREVIEW_APP` / `PREVIEW_DB` bindings before activation.
- **Missing table:** both auth and logout must fail closed. A release with only one schema is a rollout stop. Missing `batch()` is a release stop. A correctly signed *new* token must not silently bypass either table.
- **No auto-enable:** no configuration has been changed to activate the bridge, and no migration was added or executed. Synthetic test does not prove actual Cloudflare read-replica consistency or runtime binding topology.

Official D1 batch semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch. The adapter in the synthetic Node SQLite test mimics the documented atomic transaction and proves rollback on second-statement failure; it does **not** substitute for a new isolated Cloudflare Worker+D1 runtime test.

## Exact staged rollout prerequisites

1. Read-only inventory of *both* actual databases and currently deployed Production and Preview Worker versions/bindings. Do not assume an old Git commit matches a deployed Worker. See `docs/2026-10-24-auth-d1-readonly-audit.md`.
2. Verify legacy and new table schema/ledger in **the effective auth D1** and determine whether migration `0099` or `2026-10-23-session-revocation.sql` is applied. A table of the correct name but malformed columns is a stop.
3. New **independent** Worker+D1: create both tables, use synthetic accounts and no real provider secrets, verify both simultaneously running worker versions; exercise A/B logout, legacy/new concurrent writes, second SQL failure, cookie and UI retries, token signature/hash parity, rollback.
4. Copy existing active hashes using a separately reviewed, additive and idempotent D1 migration transaction (reference only: `scripts/session-revocation-preservation-plan.mjs`). Do not delete either table; ensure all active revocations are mirrored before any legacy-only reader could be reintroduced.
5. Restrict the release to version/binding-verified Worker and explicit migration approval. Keep bridge active until old Worker traffic is drained **and rollback can no longer reintroduce a legacy-only reader**. Only then choose a single schema and cleanup plan in a separate reviewed release.
6. Re-run exact-SHA CI and real synthetic-account post-deploy tests. A failed read/write/binding check blocks a successful logout and blocks promotion. No live deployment is performed in this PR.

## Local test

```bash
node scripts/session-revocation-dual-bridge-sqlite-test.mjs
npm test
```
