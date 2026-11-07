# Kun Online — D1 / isolated QA release gate (2026-11-07)

**Status: STATIC SAFETY PREPARATION ONLY. NO SANDBOX PROVISIONED OR VERIFIED IN CLOUDFLARE.**

## Why this gate exists

`wrangler.production.toml` binds **two existing D1 databases**:
- `DB` = `kunonline` (Production)
- `PREVIEW_DB` = `kunonline-preview` (also used by customer-facing Production routes)

It additionally binds `PREVIEW_APP` to `kunonline-preview`. The name "Preview" is **not** proof of customer-data isolation. Neither existing D1 is an acceptable test target. No customer rows, authentication records, balances, orders, carrier shipments, or subscriptions may be written in QA.

The current Preview workflow on `main` refers to `scripts/provision-isolated-preview-qa.mjs`, which is *not present on `main`* at this review; a different draft implementation exists on `develop/ux-system-upgrade`. Do not merge an outdated provisioning script or bypass the pre-release test gates just to deploy. Inspect current GitHub HEAD and relevant workflow at execution time.

## What this PR adds (offline, no Cloudflare access)

- `wrangler.audit-sandbox.example.toml` contains deliberately invalid placeholders. Never use it to deploy.
- `scripts/verify-audit-sandbox-config.mjs` rejects known live Worker/D1 names and UUIDs, unexpected service bindings, zone routes, assets, crons, inline secrets, commerce migrations, and non-audit entrypoints.
- `src/audit-sandbox-probe.js` is read-only and egress-free. It can return health and, with a separately injected sandbox key, query only the name of a synthetic QA marker table. No application imports or external APIs.
- `sandbox/migrations/0001_audit_sandbox_marker.sql` defines one empty test marker table **for a future new sandbox D1 only**.
- `npm run test:audit-sandbox-safety` validates allowed and denied configs and probe auth, and is now a PR validation step. CI does not read or mutate remote D1.
- `.gitignore` excludes instantiated sandbox configs and `.dev.vars.*` files.

## What must be done before calling any Cloudflare sandbox safe

1. Explicit owner/operator authorization to inspect Cloudflare account and Worker/D1 metadata.
2. Independently identify deployed Production and Preview DB bindings, including `PREVIEW_APP`, account ID, version and current environment configuration **without retrieving credential values or customer data**.
3. Provision an entirely **new** D1 and Worker through an operator-controlled release process (not done in this PR); no production zone route, `workers_dev` disabled, no cron, no service bindings, no external provider tokens.
4. Ensure the new D1 UUID and database name are distinct from both live resources. A static UUID difference alone does **not** prove the effective runtime binding is isolated.
5. Review and run `node scripts/verify-audit-sandbox-config.mjs <explicit-sandbox-config>` offline. Any failure must block continuation.
6. Independent human verification of effective deployed bindings and absence of outbound access / live secrets. Inject a new sandbox-only `SANDBOX_QA_SECRET` of at least 32 characters; never reuse Production or Preview keys.
7. **Only after separate explicit migration approval**, apply the one reviewed synthetic-only marker migration to the new D1; do not run bulk migrations against an existing live or Preview database.
8. Perform a read-only `/qa/schema-proof` call with sandbox-only auth; it must find `qa_sandbox_marker` and no customer data. Run negative authorization tests. The response itself does not attest the actual D1 UUID.
9. Make independently recoverable, verified backups of **both** customer-linked D1 resources before any eventual release impacting them. Confirm a restore in a separate non-customer environment; D1 Time Travel metadata is not a replacement for tested backup/restore. Record time and account without logging secrets.
10. Require review of migrations 0099/0100/0101 and authentication routing before enabling any features. Do not reapply `revoked_session_tokens`/old PR #209 migrations by assumption.
11. Later changes require isolated end-to-end checks, documented Worker rollback, CI on exact SHA, explicit deployment approval, real device acceptance, and operator evidence.

## Nonclaims

This PR does **not** create any Cloudflare Worker or D1, read the live schema, execute a backup, restore, migration, production smoke test, or fix the primary admin login. It cannot prove remote binding isolation by reading only repository configuration. It deliberately keeps the actual app/auth rollout blocked until the named prerequisites are met.
