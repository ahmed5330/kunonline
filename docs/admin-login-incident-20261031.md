# Kun Online — Primary administrator login incident (2026-10-31)

## Confirmed from the repository
- Production entrypoint is `src/index-production-mobile-update.js`.
- For `/api/login`, `/api/me`, and `/api/logout`, it prefers `PREVIEW_APP` and otherwise runs the local Worker with `PREVIEW_DB` substituted for `DB`.
- `wrangler.production.toml` binds distinct databases: `DB=kunonline` and `PREVIEW_DB=kunonline-preview`. The latter is a live canonical identity source, **not disposable test data**.
- `src/index.js` looks up lowercased email in `users`, checks PBKDF2-SHA256 stored password, status and `login_attempts` lockouts. Five unsuccessful attempts may lock an account for 15 minutes.
- The password-reset UI for client owners is NOT equivalent to a reset facility for the Kun platform Super Admin.

## Actions implemented
- Branch-only read-only D1 admin account health script: `scripts/admin-login-d1-readonly-audit.mjs`.
- Branch-only GitHub Actions workflow: `.github/workflows/admin-login-d1-readonly-20261031.yml`.
- PR for review: https://github.com/ahmed5330/kunonline/pull/350
- No account created, password replaced, live database touched, migration performed, or Worker deployed.

## What the audit can distinguish
- Whether an active primary `admin`-role account exists in canonical Preview.
- Whether its stored hash format is compatible with current login verifier.
- Whether the primary admin is temporarily locked.
- Whether admin identifiers exist only in Production, only in Preview, or in both with different stored hashes.
- Whether casing/whitespace and duplicate emails may interfere.

The audit cannot tell whether the owner's *current plaintext password* is correct, cannot prove the currently deployed Worker equals repository `main`, and cannot claim login restored.

## Recovery decision gate (operator review required)
1. Obtain the actual audit run output from GitHub Actions, and inspect Production and Preview Worker service/D1 bindings in Cloudflare (read-only). If the workflow cannot access Cloudflare, do not infer empty data from that failure.
2. If the canonical admin exists, is active, is not locked, and hash format is valid, verify the **account email** and whether the owner has a valid existing session; do not trigger repeated speculative logins.
3. If the account is temporarily locked, let the lock expire, stop repeated automated attempts, and inspect why attempts failed.
4. If the canonical admin is absent, malformed, disabled, or differs from Production, establish the authoritative owner identity and the historical change before ANY fix. Do not overwrite Preview from Production blindly, create an emergency permanent admin, or bypass auth.
5. For true password recovery, verify ownership out-of-band, take backup/restore evidence, use a reviewed least-privilege one-time recovery transaction on the canonical D1 to replace **only** the matched super-admin password hash and clear only that account's relevant lock record. This requires explicit human execution in Cloudflare or another authorized secure environment; no new password is collected in GitHub workflow inputs or logs.
6. With the owner's chosen private password, verify a fresh `POST /api/login` returns a secure `ko_session` and `GET /api/me` with that cookie returns role `admin`. Verify a wrong password is rejected and no other account is changed. Do not paste real credentials into logs or chat.
7. Only then mark this incident restored. Do not deploy this audit PR as a fix.

**Status:** Code-level investigation prepared. Live D1 audit output and owner login success not yet verified.