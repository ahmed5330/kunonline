# Kun Online — Audit #209 safe-release checklist (2026-10-23)

## Purpose and status
This checklist is for the audit changes in PR #209 (SEC-01/02, ORD-01, FIN-01/02, SYNC-01, ANA-01, UX-01/02, WAL-01, TST-01). CI checks are necessary but not sufficient for a Production rollout. **Do not promote or deploy this draft solely because GitHub tests pass.** No real customer payment, order, courier or wallet update is authorized by this checklist.

## Data-isolation blocker
In the current repository configuration, the Production Worker binds both `DB` (kunonline D1) and `PREVIEW_DB` (kunonline-preview D1), and delegates many requests through `PREVIEW_APP` (kunonline-preview service). The Preview Worker itself has the same Preview D1 binding. **The word "preview" does not establish data isolation.** A test order or payment against that instance can affect real customer data. Treat both as live until separately verified otherwise.

## Isolated sandbox — required before stateful testing
1. Provision a *new* Cloudflare Worker, a *new* D1 database with its own immutable database ID, and a unique hostname. The new D1 database must not match either `wrangler.production.toml` or `wrangler.preview.toml` database IDs. Never point a test Worker at an existing production or preview service binding.
2. Explicitly disable cron/scheduled synchronization, J&T shipping, Easy Orders webhooks/import, payment automation, messaging/WhatsApp, push notifications, and external ad-account sync. Use inert/mocked endpoints and synthetic API credentials only.
3. Apply migrations, including `migrations/2026-10-23-session-revocation.sql`, to **this new D1 only**; seed three fake tenants (owner A, staff read-only A, owner B), two stores per tenant, sample orders with unique fictitious phone numbers, and synthetic COD batches. Do not clone personal or financial data from live customers.
4. Confirm environment variables, Worker routes, service bindings, D1 database names **and IDs**, and upstream URLs **from the deployed sandbox runtime** (not just repository files) before any write-capable test. Stop on any reference to a live resource.
5. Enforce deny-by-default network and service configuration for carrier/payment/ads integrations; require an independent reviewer to sign off on the test environment boundary.

## Sandbox acceptance matrix
- **SEC-01:** Anonymous caller => denied without a database read; logged-in store user => 403; platform admin => permitted metadata read; error response never prints SQL/credentials. Check session revocation and forged headers.
- **SEC-02:** Log out a synthetic account on one device and verify that replaying the same signed cookie no longer returns identity; a separate active session must still work. Simulate D1 write failures and ensure logout does not report success; missing revocation table must fail closed. Never copy or log a live token.
- **SYNC-01:** Easy Orders health displayed on the dashboard must be scoped to the authenticated tenant; test 2 tenants/2 stores, invalid store IDs and no-provider states. The global health endpoint is for platform monitoring only.
- **ORD-01:** All New Order buttons and quick-create flow open the same J&T address form. Missing required province/city/area/street are rejected. Synthetic orders persist with address codes, tenant ID, store ID and an audit trail. No real carrier API requests are sent.
- **FIN-01:** COD GET responses for each synthetic tenant respect store scope and roles. Preview 401/403/500 and ordinary 404 pass through unchanged; only explicit unknown-route 404 permits local fallback. No financial writes are retried. A settled synthetic COD order must not be double counted as unpaid.
- **FIN-02:** Supplier invoices/payments start empty; reject missing reference and zero/negative/non-finite amounts. No unapproved duplicate payment.
- **WAL-01:** A synthetic paused wallet can show balance, topup form/status and recent topups; operations and financial-write endpoints remain blocked. Check navigation on web and Android viewport; resume restores only previously authorized menu routes.
- **ANA-01, UX-01/02:** Empty Meta Ads does not claim healthy performance; procurement labels match functions; team counts explicitly exclude owner.
- **TST-01:** Run relevant Node tests on Linux and Windows; validate sidebar browser fixture and full `npm test`.

## Release protocol (separate explicit approval required)
1. Verify CI on the **exact commit SHA** proposed for release. Attach the sandbox test results, environment isolation evidence and review decision to PR #209.
2. Obtain explicit Production change approval. Merge only after completing all checks and reviewing the exact diff (especially Cloudflare routing and billing/security code).
3. Capture and verify a rollback target (previous healthy Worker version), database backup/restore plan and change window. **This PR now includes a session revocation D1 migration**. The current Worker code must NOT be deployed until the `revoked_session_tokens` table exists on the effective API backend D1 (including whichever D1 powers the upstream Preview service). Validate it on isolated staging first and explicitly schedule any live schema rollout before application activation. The migration is additive; do not silently disable checks or make reads succeed if the table is absent. D1 restore/rollback coordination is mandatory.
4. Before rollout, independently verify `SELECT name FROM sqlite_master WHERE type='table' AND name='revoked_session_tokens'` succeeds on the **actual target backend**. Run migrations only after explicit Production approval. Then roll out as a controlled release using existing approved deployment workflows; run read-only login, navigation, data-scoping and diagnostics smoke checks first. Abort on authorization errors, COD discrepancies or customer reports.
5. Monitor error rate, login failures, order creation, COD summary consistency and wallet access. Record actual deployed Worker version IDs and whether Production/Preview traffic is isolated.

## Stop conditions
Do **not** attempt any stateful test, merge or Production deployment if: the new revocation table is missing on the target database; the test Worker is linked to current Preview/Production D1; integration credentials are real; auth/scoping tests fail; unresolved financial discrepancies exist; or rollback is not ready. The PR remains Draft until these conditions are satisfied and approval is recorded.
