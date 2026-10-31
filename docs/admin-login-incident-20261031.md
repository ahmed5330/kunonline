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

## Secure operator procedure (never GitHub Actions)

This repository deliberately does not run Cloudflare admin-account diagnostics or password resets inside PR CI. Both tools are intended for a verified Cloudflare account owner at a **trusted local terminal**, with read-only or minimum required D1 API privileges. Do not paste tokens or passwords into chats, GitHub Issues, PR bodies, workflow dispatch fields or logs.

1. Verify you control the Cloudflare account and confirm the live `kunonline-preview` database is still the canonical auth source in currently deployed Workers, not merely in source control.
2. Create and verify a restorable Cloudflare D1 backup of the **canonical Preview DB** before any write.
3. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as local shell environment variables. Ensure the token is scoped appropriately; avoid cloud logs.
4. Run `node scripts/admin-login-d1-readonly-audit.mjs --read-only` to compare the two database identities. This logs **aggregate counts only**, not emails or hashes.
5. Run `node scripts/admin-login-recovery.mjs --dry-run`. It prompts locally for the exact administrator login email, checks that exactly one active and normalized admin matches and no other account has the same login email, verifies stored hash structure and checks temporary lock; it never attempts login or changes data.
6. If the cause is ONLY a temporary lock: wait 15 minutes (without further attempts). Do not reset the password.
7. If a proper password recovery is genuinely required, the authorized account owner can run `node scripts/admin-login-recovery.mjs --apply --backup-confirmed --owner-verified`. It requires interactive typed confirmation and the new password twice with hidden input; changes only the canonical admin's password hash using a conditional comparison against the old hash, verifies the update and clears the matching lock row. This is a **live D1 write**, never run without explicit authorization, owner verification, and backup.
8. The owner must sign in privately at `https://app.kun-online.com/v2/` and check that `/api/me` returns the intended `admin` role. Never put a real password or session cookie into test logs.
9. If the account is missing, is disabled, has invalid hash or email casing, duplicates another account, or identities differ across databases, **STOP** and investigate before any recovery. The recovery script intentionally refuses these scenarios.

CI proof that the offline script passes does not prove that Cloudflare credentials, backups, production Worker bindings, or the real account are healthy. Do not merge this PR as if the login were repaired.
