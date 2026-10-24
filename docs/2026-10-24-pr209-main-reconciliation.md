# Kun Online — Main / Draft PR #209 reconciliation gate (2026-10-24)

**Branch:** `fix/pr209-main-reconciliation-20261024` (branched from PR #209 at `1543a41276b097431b4ff4f4ec0424f419540768`).

**Status:** PARTIAL CODE RECONCILIATION / RELEASE BLOCKED. Do not merge this branch, PR #209, or deploy Workers until the live migration ledgers and effective auth services are reviewed. No Production/Preview D1, orders, wallets, carrier APIs or real customer credentials were touched in this branch.

## Verified divergence (GitHub, Oct 24)

| Issue | main at `45414bb892869f1c231aa22255a0507b2f38912b` | PR #209 at `1543a41276b097431b4ff4f4ec0424f419540768` | Decision |
| --- | --- | --- | --- |
| Revocation table | `revoked_sessions` | `revoked_session_tokens` | **BLOCKED** — reconcile effective D1 schema + migration ledger before choosing a canonical schema |
| Migration | `migrations/0099_revoked_sessions.sql` | `migrations/2026-10-23-session-revocation.sql` | Do not apply both automatically; two tables are not interchangeable |
| SQL columns | `token_hash, expires_at` | `token_hash, expires_at, revoked_at` | Re-run SQLite/Worker tests on selected schema only |
| Logout | Direct legacy handler; server source does not enforce POST at `/api/logout` | POST-only, 405 for GET, 503 with retry cookie on D1 outage | Keep PR security hardening and verify gateway behavior |
| UI owner password reset | Main has deduplicated client drawer, masked input and concurrency guard | PR had older owner UI | **PORTED** main UI and its original regression test into this isolated branch |
| Secret persistence | main has an older `TOKEN_ENC_KEY` fallback | PR blocks plaintext and preserves encrypted data on decrypt failure | Retain PR hardening |
| Preview CI | main workflow still invokes `npm run db:migrate:preview` on `develop/ux-system-upgrade` | PR changes migration step to read-only schema verification | **BLOCKED** until guarded workflow is approved/active on deploy-triggering branch |

`main` has three additional commits since their merge base. Do not overwrite the PR with whole files from main: that would remove security improvements.

## Changes applied to isolated branch

1. `public/v2/modules-v23-admin.js`: copied main's latest owner-password reset and single-card drawer implementation; retains original main UI semantics.
2. `scripts/admin-client-password-reset-ui-test.mjs`: copied main's regression for three repeated opens, concurrent clicks, stale response, error handling, and success receipt.
3. `package.json`: wire admin password UI test into `test:admin-client-command` and merge safety guard into `test:session-revocation-schema`.
4. `public/v2/index.html`: update ONLY admin module asset revision from `v23.4` to `v23.6`; keep PR #209 assets for logout and business fixes.
5. `scripts/pr209-main-reconciliation-guard.mjs`: fail CI when competing migration appears, incompatible SQL is reintroduced or main password reset protections are lost.

**These modifications are repository code on an isolated branch only; they do not establish successful CI or runtime deployment.**

## Remaining main-only deltas to reconcile before merge

Review all main-only changes in `.github/workflows/session-revocation-contract.yml`, `migrations/0099_revoked_sessions.sql`, `scripts/session-revocation-test.mjs`, `scripts/session-logout-ui-test.mjs`, `scripts/session-test-cloudflare-loader.mjs`, `src/index.js`, `package.json`, `public/v2/index.html`, `public/v2/modules-v26-auth.js`, `scripts/admin-client-command-center-test.mjs`, `scripts/onboarding-buttons-test.mjs`, and `scripts/store-sql-integration-test.mjs`. Do not simply import tests that depend on GET logout or a different table without adapting expectations.

## Gate A — read-only external facts needed before schema choice

- Identify **actual deployed** Preview auth Worker and Production API gateway, binding names, immutable D1 IDs, deployed source/version hashes (never infer from a Git commit).
- Read **schema metadata only**, not session rows or tokens: table names, `PRAGMA table_info`, D1 migrations ledger for every effective auth D1; use an authorized read-only account.
- Decide whether neither table, only one, or both exist in each environment; independently check code currently serving sessions. Document the action for each case and rollback.
- Select ONE coherent schema+handler+UI protocol only after verifying real state; update both migrations/contract tests, and deliberately retire or supersede the other migration without automatic bulk application.
- Verify `SESSION_SECRET` and `TOKEN_ENC_KEY` are configured on *both* actual backends by approved preflight without printing values.
- Ensure all active branch workflows block opportunistic Preview migration and Production deployment before release.

## Gate B — isolated Sandbox Worker + D1 (not configured or provisioned yet)

- Create unique Cloudflare Worker and D1 IDs distinct from `kunonline` and `kunonline-preview`; use `wrangler.audit-sandbox.example.toml` as a **non-deployable template**, never substitute the existing Preview config.
- Do not bind `PREVIEW_APP`, `PREVIEW_DB`, production service names, real integration credentials, payment or J&T accounts; no Cron, background sync, notifications, webhooks, or external service egress. Config alone does not block outbound fetch: verify mock-only adapters and an explicit deny-by-default egress policy.
- Seed only synthetic tenants, employees, stores, orders, COD, and ledger rows. Validate bind IDs/routes from actual deployed sandbox runtime before even a synthetic write.
- Run offline source/SQLite regression first, then staged Worker session replay, DB outage and frontend retry, then order/COD/J&T/accounting E2E against mock provider and sandbox D1.
- Never equate an order state marked 'collected' with verified cash settlement; ensure debit/credit balanced and unique financial effect per idempotency key.
- Maintain a written rollback/restore drill and migration selection; live release is a separate, explicit authorization gate.

## Tests to run on exact reconciliation SHA

```sh
node scripts/session-revocation-schema-contract.mjs
node scripts/session-revocation-schema-contract-test.mjs
node scripts/pr209-main-reconciliation-guard.mjs
node scripts/admin-client-password-reset-ui-test.mjs
node scripts/session-revocation-sqlite-integration-test.mjs
node scripts/session-revocation-20261023-test.mjs
node scripts/legacy-secret-encryption-20261023-test.mjs
node scripts/preview-migration-release-guard-test.mjs
npm test
```

**Warning:** inspect any changed npm scripts for live/remote side effects before execution. These are intended offline/fixtures on the audited source version; do not run unknown new scripts indiscriminately.

## Proof/status vocabulary

- `IN REPO`: exact branch + Commit.
- `PASS`: actual test name + run SHA + output evidence.
- `IN SANDBOX`: immutable Worker/D1 IDs, completely isolated data, E2E record.
- `LIVE`: separately approved Cloudflare version/Android signed release + post-release QA.

Do not mark any of the last three as achieved by this file alone.
