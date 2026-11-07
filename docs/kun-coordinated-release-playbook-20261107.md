# Kun Online — coordinated, evidence-based release playbook (7 Nov 2026)

> STATUS: **NOT DEPLOYED. NO CUSTOMER DATABASE CHANGED.** PR #359 is a draft candidate.
> This document is a procedure, NOT proof that Cloudflare resources, exports,
> backups, live users, a phone or an actual J&T order have been verified.

## Current release identity

Candidate: `release/kun-safe-integration-20261107` / [PR #359](https://github.com/ahmed5330/kunonline/pull/359).
The release contains the scoped browser/Android order edits, role-correct auth,
durable Easy Orders pending short-ID reconciliation and an offline sandbox guard.
It does **not** deploy Firebase feature flags, D1 migrations 0100/0101, or the
older #209 session migration. Keep those as separate releases.

The static repo configuration says:

| Worker | Binding | Database / destination |
|---|---|---|
| `kunonline` (production) | `DB` | `kunonline` (c426601d-182f-486e-a5c1-bb1bca0ecb0b) |
| `kunonline` (production) | `PREVIEW_DB` | `kunonline-preview` (31cd5cdf-fc01-42d7-ba1e-571f3dd58495) |
| `kunonline` (production) | `PREVIEW_APP` | Worker `kunonline-preview` |
| `kunonline-preview` | `DB` | `kunonline-preview` (31cd5cdf-fc01-42d7-ba1e-571f3dd58495) |

**The Preview DB is already customer-linked. It is NOT a disposable QA sandbox.**
In `src/index-production-mobile-update.js`, Production handles authenticated
API routes with a Preview Worker service delegate, or a PREVIEW_DB fallback.
A merge to main deploys Production automatically via
`.github/workflows/production.yml`, while Preview deploys from the
`develop/ux-system-upgrade` branch. These are separate release paths.
The login fix in `src/index.js` needs verification in its effective Preview
handler, not a Production-worker-only release.

## Gate A — independently verify effective Cloudflare settings (read-only)

Run only with operator-authorized, scoped Cloudflare credentials **outside chat**
and do not paste or log token values. Use the exact PR commit SHA throughout.

```bash
node scripts/cloudflare-effective-bindings-readonly.mjs
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the operator's
secure environment. The script only makes GET requests for Production and
Preview Worker settings, verifies DB IDs and `PREVIEW_APP`, and emits only
boolean/safe deployment metadata. An HTTP error or missing binding is
**FAIL**. A PASS is **not** a backup attestation or release approval.

Also capture (without secrets or customer rows) the currently deployed
**full-traffic** Worker version on BOTH workers before changes:

```bash
npx wrangler deployments status --config wrangler.production.toml --json
npx wrangler deployments status --config wrangler.preview.toml --json
```

The published rollout versions must be verified again AFTER deployment;
repository config alone cannot prove which Worker version serves traffic.

## Gate B — two distinct full customer-data exports and offline restore proof

Only after Gate A, export **both** customer-linked D1 databases separately,
to encrypted, access-controlled, temporary storage. The exports contain
personal information, payment and commerce data; never upload exports to
public artifacts, GitHub issues, chat, CI logs or an unencrypted drive.

```bash
npx wrangler d1 export kunonline --remote --config wrangler.production.toml --output=/secure/kunonline-production-before.sql
npx wrangler d1 export kunonline-preview --remote --config wrangler.preview.toml --output=/secure/kunonline-preview-before.sql
```

Rebuild each export into a **separate local temporary SQLite file**, not any
Cloudflare D1, then run `PRAGMA integrity_check`, compare source/restored
schema and safe aggregate table counts, and securely record a timestamp,
SHA-256 digest, isolated restore attestation and known-good Worker version.
A Time Travel bookmark is useful additional protection, **not** a replacement
for checking the export and restore. NEVER run `d1 time-travel restore` on
the customer-linked databases as a test.

**No verified exports, restore results or bookmarks were available in the
current conversation or connected GitHub evidence. Gate B is OPEN.**

## Gate C — actual isolated integration QA (separate NEW Worker + NEW D1)

Do **not** execute QA writes against `kunonline`, `kunonline-preview`,
the production URL or their service-binding endpoints.
The audited sandbox contract in PR #359 requires:
- unique Cloudflare Worker name and entirely new D1 UUID;
- no production zone route, crons, service binding, real provider tokens,
  payment/shipping effects or customer data;
- synthetic-only fixtures and a negative test for incorrect bindings;
- explicit verification of deployed runtime binding, not merely a TOML string;
- authentication, role+tenant, J&T, delayed 400/404 order recovery,
  idempotency and Android integration exercises;
- passing QA evidence for the exact candidate SHA.

**Blocker:** `.github/workflows/preview.yml` calls
`scripts/provision-isolated-preview-qa.mjs`, currently ABSENT on `main`
(and on PR #359). A related version on
`develop/ux-system-upgrade` performs Cloudflare database/Worker creation
and imports a remote schema. It **must not be blindly copied, merged or run**
as if this were already an isolated sandbox. Reconcile code, permissions,
source IDs and exact release SHA before attempting provisioning.

## Gate D — coordinated deployment and smoke

Prerequisites: every gate above, independent backups, isolated QA, verified
review of PR #359, explicit production release authorization and staffed
rollback. In order:

1. Freeze reviewed SHA and halt conflicting Preview/Production release jobs.
2. Verify canonical Preview backend compatibility and its effective auth,
   J&T and Easy Orders routing. Deploy the reviewed compatible Preview
   backend ONLY through an approved workflow, not by editing live D1.
3. Verify read-only Preview smoke and every customer-linked tenant/store
   authorization contract. Investigate any live staff audit failure.
4. Deploy Production Worker-only (NO D1 migrations) through approved release
   workflow after capturing prior full-traffic Worker version.
5. Verify new full-traffic Worker version plus Web V2, Android API, health,
   store switching, editing permissions, payment badges, caller notes,
   Easy Orders missing-ID queue and J&T labels with non-destructive checks.
6. Release signed Android binary separately only after real-device acceptance;
   a passing Gradle build is NOT proof of device behavior.
7. If any required check fails, roll back the owned Worker version and
   revalidate both service routes. Treat D1 rollback as a distinct,
   operator-reviewed recovery operation, NEVER an automatic migration undo.

## Hard-stop conditions

- Remote D1 binding or Worker service differs from reviewed configuration.
- Any live data export or isolated restoration missing or unverifiable.
- New QA Worker binding points to either of the two customer-linked D1 IDs.
- Existing Preview-branch release path missing its isolated provisioning code.
- Authentication or staff store grants are not verified on the live authority.
- Upstream Easy Orders HTTP 400 without same-store positive control, 429 or 5xx.
- Unreviewed SQL migration, Firebase secrets, J&T live operation or Android
  distribution included in a Worker-only release.
- Missing rollback version, test evidence or deployed full-traffic version.

## Evidence to attach to PR #359 before leaving Draft

Record the exact commit, two read-only Cloudflare settings audit outcomes,
the two source export digests and independent local restore reports,
QA Worker+D1 IDs (masked), data isolation proof, non-PII QA logs,
Preview/backend rollout version, Production rollback version,
post-deploy smokes, actual device sign-off, and GitHub Actions URLs.
Never attach credential values or actual customer records.

The PR may have all its synthetic GitHub CI checks green while these
external, customer-safety gates remain **NOT VERIFIED**. That must prevent
any claim of a successful live release.
