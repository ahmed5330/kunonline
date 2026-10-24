# SEC-02 — dedicated, isolated auth-only sandbox (not deployed)

**Current status:** repository implementation and synthetic Node/SQLite test ONLY. No new Cloudflare Worker or D1 resource exists by virtue of these files. No D1 migration or customer data writes have been performed.

## Fixed an important isolation weakness

The previous `wrangler.audit-sandbox.example.toml` was pointing at the **full commerce Worker** `src/index-commerce-v38.js`, which imports provider integrations, order endpoints and other production-like features. Even a newly provisioned database could have exposed live-provider egress or side effects under an accidentally copied secret.

The new template points **only** to `src/audit-sandbox-auth-worker.js`: one imported function pair from the offline revocation bridge, one dedicated D1 binding and no commerce assets. Its only routes are `GET /healthz` (basic status, no secrets) and `POST /qa/revocation-selftest`, which checks `APP_ENV=audit_sandbox`, `AUDIT_EGRESS_OFFLINE=true` and an independently provisioned `AUDIT_QA_KEY` at least 32 characters long. The latter self-test generates its **own synthetic random token**, confirms it was never revoked, atomically writes **SHA-256 hashes only** to both tables, then verifies that the synthetic token is blocked on replay. No real login, account or order routes are provided; no outbound requests or carrier/ads/payments/WhatsApp integrations exist.

The example Wrangler config is intentionally **not deployable**: placeholders for a new Worker name, new D1 name and new D1 UUID; `workers_dev=false`, no custom routes, Cron disabled, no service/AI/R2/KV bindings and no public assets. `migrations_dir=sandbox/migrations` is a dedicated folder containing **only** the two additive revocation schemas; it must never use the repository's full commerce migrations.

## Mandatory controls before a Cloudflare remote test

1. Independent permission to provision a brand-new Cloudflare Worker and new D1 database, **separate from `kunonline` and `kunonline-preview`**, plus an approval for a safe test endpoint if needed. The default `workers_dev=false` prohibits a public address. Do not remove this control without a separate restricted-route review.
2. Compare the **actual remote** D1 database ID and effective Worker bindings with both live IDs. The static verifier checks only names/IDs present in repository config; it cannot prove remote configuration or secrets.
3. Provision a **new** `AUDIT_QA_KEY` only in the test Worker secret store, NEVER `SESSION_SECRET`, `CLOUDFLARE_API_TOKEN` or real provider secrets. Keep the credential out of logs, URLs and PR descriptions. Do not use live customers, orders, COD or providers.
4. Before deployment, use `node scripts/verify-audit-sandbox-config.mjs <reviewed-custom-config.toml>` and verify its `runtimeIsolationVerified:false` result is honestly still unconfirmed. The preflight must refuse placeholders and unsafe resources; do not override it to force deployment.
5. Apply `sandbox/migrations/0001_synthetic_revocation_only.sql` **to that new standalone D1 only**, after reviewing its ID and confirming no customer data exists.
6. Test the real Worker runtime through an authorized, restricted channel. After test, verify no outbound provider traffic and no shared service/secret bindings. The static absence of an external `fetch()` call is useful but not a runtime network firewall or a substitute for reviewing deployed resources.

## Offline evidence

```bash
node scripts/audit-sandbox-config-test.mjs
node scripts/audit-sandbox-auth-worker-test.mjs
npm test
```

The **separate local-workerd** test `npm run test:audit-sandbox:wrangler-local` uses the actual Wrangler-installed runtime to apply only `sandbox/migrations` to a **fresh local D1**, starts the minimal Worker on localhost with synthetic QA key, exercises the authenticated self-test twice and checks both local table counts. Every D1 CLI operation explicitly carries `--local`; all Cloudflare account tokens are blanked for the spawned commands, and no deployed Worker exists. This is stronger runtime evidence than a pure Node adapter, but remains **local**, not a real Cloudflare-account sandbox. Official documentation: https://developers.cloudflare.com/workers/local-development/local-data/ and https://developers.cloudflare.com/d1/wrangler-commands/.

The tests exercise the actual `fetch` handler using a fake `Request` and a synthetic SQLite adapter, including auth-key rejection, blocked commerce routes, no cookie-setting, SHA-only storage, paired batch writes, automatic transaction rollback on second failure, fail-closed missing table and no external provider calls.

**These tests are NOT a real Cloudflare D1/Worker end-to-end and are not evidence that Cloudflare environment permission was granted.** The one-time Production-environment metadata-only workflow in Draft PR #220 remains blocked before any steps executed; it is separate from this Sandbox. Draft PR #209 may not be promoted to main or Production without real D1 version/binding inventory, record-preserving schema transition approval, migration/rollback plan, safe sandbox QA and a verified release window.
