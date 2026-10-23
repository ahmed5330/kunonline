# Kun Online — SEC-02 logout rollout and schema reconciliation

**Status: RELEASE BLOCKED.** This is a repository-only audit note. No live D1
migration, Cloudflare Worker deploy, customer account mutation or secret access
was authorized or performed by this review.

## Two different implementations — choose one

| Property | Draft PR #209 | User's separately prepared local patch |
| --- | --- | --- |
| Revocation table | revoked_session_tokens | revoked_sessions |
| Migration | 2026-10-23-session-revocation.sql | 0098 (exact SQL unavailable in checked GitHub) |
| Key | token_hash, SHA-256 of canonical complete cookie | SHA-256 fingerprint; exact schema unverified |
| Expiry | expires_at, INTEGER Unix seconds | mentioned, type/units not independently verified |
| Unique login jti | present | reported present |
| Auth and UI tests | synthetic auth tests and Chrome browser fixture | 247 tests, direct SQLite and callback tests claimed in report; files not available in reviewed refs |

Never apply 0098 to create only revoked_sessions while a Worker queries
revoked_session_tokens, or vice versa. A missing table can fail authentication
requests with a D1 error. Dual independent revocation registries are not
interchangeable. A green test for one version does not validate the other.

## What authenticates a Production browser

- Production Worker: src/index-production-mobile-update.js
- /api/login, /api/me and /api/logout delegate to PREVIEW_APP if available.
- The fallback executes the application with PREVIEW_DB.
- Preview Worker: kunonline-preview; entrypoint src/index-commerce-v38.js.
- The Production config binds PREVIEW_APP and PREVIEW_DB, both pointing to
  existing Preview resources. Preview is NOT a writable isolated test sandbox.

A Production-only deploy cannot fix an old Preview signer/verifier. Update the
actual auth Worker and verify the deployed version before releasing the new UI.

## Mandatory ordered release checklist (requires separate approval)

1. Obtain the actual local 0098 SQL, signer/verifier, logout handler, UI callback
   and two new test scripts. Compare against PR #209 and select ONE coherent
   schema + implementation. Review SHA-256 input, column names, expiry units,
   legacy no-jti tokens and simultaneous sessions. Do not merge both blindly.
2. Inspect migration state on all effective authentication D1 bindings using
   authorized Cloudflare read-only migration-list operations and inspect
   table names/schema only. Do not select or log session fingerprints/cookies.
3. Review all pending migrations. Existing .github/workflows/preview.yml
   automatically invokes npm run db:migrate:preview; that can apply more than
   one pending migration. An approved specific-migration procedure must replace
   blanket application for this release; pause conflicting automation first.
4. Provision a NEW Worker and D1 containing synthetic data, with no carrier,
   payment, advertising, WhatsApp, push or live account credentials, Cron
   triggers or service bindings. Test the exact selected migration there.
5. Test two QA sessions A/B: logout A, reject A on replay while B stays valid;
   allow a fresh C login, repeated logout, legacy no-jti sessions, malformed
   token, DB missing-table, DB read/write outage, and UI failure/retry. Keep
   signed tokens only in ephemeral test memory and never in logs or screenshots.
6. In a separately authorized deployment window, back up both affected
   live D1 resources and prepare a verified restore/rollback plan. Apply the
   selected migration to the actual auth DB(s) BEFORE upgrading code. Inspect
   schema and migration tracker after application, not just CLI exit status.
7. Update the real Preview authentication Worker first, then verify its
   deployed signer/verifier and effective Production service binding. Deploy
   the compatible Production Worker only after those checks; update the UI
   last. Production-only publication is insufficient.
8. After release, run two-session QA on a synthetic account as in step 5.
   Schedule bounded deletion of expired revocation hashes separately and
   only with approved expiry-unit-aware maintenance. Retention of expired
   hashes does not re-authorize sessions.

## Automated source guard vs live release gate

- node scripts/session-revocation-schema-contract.mjs
- node scripts/session-revocation-schema-contract-test.mjs

These new checks detect mismatched revocation tables, an unexpected second
migration, Preview auth routing changes or a Production read-only preflight
that checks a different schema. They are OFFLINE ONLY: successful checks do
not prove a migration was run, a Worker deployed, or real logout replay fixed.

Keep PR #209 Draft until the missing local patch, actual remote migration
state, Preview deployment, and authorized live QA are verified.
