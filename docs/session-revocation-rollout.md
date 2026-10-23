# Session revocation rollout

This change requires migrations/0099_revoked_sessions.sql BEFORE deploying the session reader. It is additive: a table of SHA-256 token fingerprints and expiry values, plus an expiry index. No raw tokens, user, ledger, order, or inventory rows are changed.

The Production auth gateway delegates /api/login, /api/me, and /api/logout to PREVIEW_APP. Deploying Production alone will not update that identity service. Preview is shared production-backed data, not a disposable test database.

Do not merge/deploy until the canonical database identity, existing migration state, independent recovery point/restore procedure, and additive migration rehearsal have been verified for the exact release SHA. Do not run the existing all-pending-migrations Preview pipeline merely to apply 0099. Apply only the reviewed schema addition through the approved release procedure, verify its table/index, deploy the canonical auth worker from the approved source, then release the matching frontend assets. Missing revocation storage fails authenticated requests closed with 500.

After release, verify with the owned QA tenant: two independent sessions, logout one, reject replay of that token, preserve the other session, and permit fresh login. Never print or export session tokens. Schedule deletion of expired revocation fingerprints after expires_at; retaining them cannot authorize a session. A rollback to the old identity worker removes revocation enforcement, so prefer a forward fix.

Local validation:
- node --experimental-loader ./scripts/session-test-cloudflare-loader.mjs scripts/session-revocation-test.mjs
- node scripts/session-logout-ui-test.mjs
- node tests.mjs
- node scripts/auth-status-test.mjs
- node scripts/access-control-test.mjs

The dedicated contract workflow uses only synthetic SQLite data and has no deployment credentials or database mutation steps.

Candidate is based on the verified deployed Preview source, preserving its financial ledger migration and accounting modules. Do not replace it with main during release. Existing all-pending migration/deploy workflows are not part of this change.
