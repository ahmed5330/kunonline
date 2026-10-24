# Kun Online — session revocation D1 read-only inventory (2026-10-24)

**RELEASE BLOCKED.** This describes a manually run, metadata-only diagnostic; no live Cloudflare audit has been performed by this change. PR #209 remains Draft and conflicts with `main` until the actual deployed auth schema and ledger are verified.

## Why this gate exists

- `main` uses `revoked_sessions(token_hash, expires_at)` and contains migration `0099_revoked_sessions.sql`.
- Audit branch #209 currently uses `revoked_session_tokens(token_hash, expires_at, revoked_at)` and `2026-10-23-session-revocation.sql`.
- The Production Worker routes account sign-in/out to `PREVIEW_APP`, backed by the separately configured Preview D1; Preview is therefore *not a sandbox*.
- Old revoked session hashes must not be orphaned when selecting the new implementation. The actual remote D1 migration ledger, effective Worker version and binding must be confirmed before choosing the table.

## Approved metadata-only check

Run from a **reviewed checkout**, with a scoped Cloudflare token authorized to query D1, through a trusted operator terminal; do not paste credentials into chat or PR logs.

```bash
export CLOUDFLARE_ACCOUNT_ID='<ACCOUNT ID>'
export CLOUDFLARE_API_TOKEN='<AUTHORISED D1 TOKEN>'
npm run audit:session-schema:read-only
```

The command requires the exact `--read-only` switch internally. It reads the Worker/D1 target IDs only from `wrangler.production.toml` and `wrangler.preview.toml`, verifies both distinct database IDs, queries **only** `sqlite_master`, `pragma_table_info`, aggregate counts by revocation table, and *filenames* of relevant entries in a detected migration ledger. It never reads `token_hash` values or account/customer rows, issues only allowlisted `SELECT` SQL to the D1 query API, and never deploys or writes to databases. The POST HTTP method is Cloudflare's D1 *read query transport*, not a SQL mutation.

The returned JSON is purposely conservative: the report always includes `releaseAuthorized: false` and `remoteWorkerBindingsVerified: false`. A Cloudflare API credential with database query rights can theoretically issue writes outside this tested script; restrict permissions and follow organizational policy.

## Decision branches

| Actual D1 finding | Required next step |
| --- | --- |
| Only `revoked_sessions` exists | Compare applied `0099` ledger, verify the active auth Worker and adapt release to preserve existing old-table hashes |
| Only `revoked_session_tokens` exists | Compare PR migration ledger and active auth Worker; make no switch until confirmed |
| Both exist | **Block.** Reconcile active hashes from both tables, including expiry and idempotency, with a separately reviewed, transactional, additive migration |
| Neither exists | **Block.** Explicitly approve and apply a single migration to the effective auth D1 before code deployment |
| Any query fails or remote schema is inconsistent | **Block.** No bypass, no fallback that silently ignores one table |

Do **not** delete or rename a table as an expedient fix. Check the schema for matching `token_hash` and `expires_at` columns and correct expiry units, and compare migration filenames. A remote table being present does not prove its Worker reads it, and a successful `SELECT` does not prove any handler was deployed.

## Verification and deployment plan

1. Run the metadata-only inventory on both configured D1s and verify effective current Preview/Production Worker versions and D1/service bindings through separate read-only Cloudflare controls.
2. Review all unapplied migrations and establish a single canonical table, migration numbering, and an additive copy strategy if both tables contain unexpired hashes. Never overwrite, reset, or discard active hashes.
3. Test in a *new* isolated Cloudflare Worker and D1 with no Production/Preview Worker service bindings, provider secrets, Cron, carrier/payment/WhatsApp/advertising connections or real customer data. The example config is deliberately non-deployable before a distinct Worker/D1 is provisioned and runtime egress verified.
4. Re-run all Linux/Windows/Android CI and fake-user two-device login/logout/replay, read/write outage, duplicate cookie, legacy no-jti and UI retry tests.
5. Back up and verify restore, schedule an approved maintenance window, independently authorize the migration and release, then verify real deployed versions and synthetic post-deploy outcomes.

To test **without any Cloudflare access**:

```bash
node scripts/session-revocation-live-schema-inventory-test.mjs
npm test
```

The fake test asserts only allowlisted metadata/aggregate SELECTs, no hash/credential reads, dual-table release stop and sanitized error handling. A green fake test is not a remote D1 inspection or a Production release authorization.
