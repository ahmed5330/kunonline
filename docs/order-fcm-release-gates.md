# Kun Online — FCM order invalidation: draft release gates

## Implementation scope (PR stacked on PR #351)
- Optional Android Firebase Messaging SDK. No `google-services.json` in source; debug/release CI compiles without it. No Firebase registration when it is absent.
- Authenticated `POST /api/mobile/push-devices` registers the current installation for **server-derived** active store assignments (maximum five existing installations per user; additional attempts return HTTP 429). `DELETE` revokes the current user's registration on logout. Registration does not accept client/store IDs as access grants.
- `migrations/0101_mobile_push_device_registry.sql`: encrypted FCM token per tenant/store/user/installation; requires un-applied `0100_order_change_journal.sql`. Tokens are AES-GCM encrypted with `PUSH_TOKEN_ENC_KEY`; identifiers are HMAC digests.
- Scheduled FCM sender reads `order_change_log`, independently checks that user and store grants still exist, and sends **data-only** `kind/clientId/storeId/seq` payloads with no customer/order details.
- Fast-path is also requested after successful API/Webhook order mutations through `ctx.waitUntil`; the journal remains authoritative. Cron retries and coalesces missed hints. This covers explicit order routes but cannot guarantee every write pathway is immediately observed.
- Android FirebaseMessagingService validates the hint, checks a local session and schedules a network-constrained existing authenticated sync job. The server re-authorizes all data fetches.
- Invalid device registrations are revoked on explicit logout / inactive user / removed store grant / FCM `UNREGISTERED`; old callbacks or missing credentials fail closed.
- `ORDER_FCM_ENABLED` and `ORDER_CHANGE_FEED_ENABLED` are both required to enable the API and scheduled dispatcher.

## What this DOES NOT guarantee
Successful order-mutation HTTP routes can request a best-effort fast-path push, while the existing `*/5 * * * *` scheduler provides **five-minute retry/fallback cadence**. Neither is an exactly-once or instant-delivery guarantee. FCM/Android can further delay messages in Doze, restricted background, connectivity outages or after force-stop. An actual near-instant pipeline would require publishing an outbox event / Queue message from every canonical order write and triggering a push worker without cron wait, plus measured p95 time on two real devices.
No FCM project, service account or `google-services.json` has been configured here, no real device token registered, and no live push was sent.

## Required OWNER-supplied configuration — do not commit secrets
1. Create a Firebase project and register Android application **`com.kunonline.callerid.stable`**.
2. Privately supply `android/app/google-services.json` **only to an approved build environment**. It is ignored by Git. The Google Services plugin runs conditionally when this file is present.
3. Provision a least-privilege Firebase service account with permission to send Firebase Cloud Messaging API v1 messages. Store the entire JSON **only** in Cloudflare secret `FIREBASE_SERVICE_ACCOUNT_JSON` for the reviewed Worker. Never paste it into a chat, commit, CI log or code.
4. Generate an independent high-entropy `PUSH_TOKEN_ENC_KEY` and store it as a Worker secret; protect and plan rotation/re-encryption. Tokens are encrypted at rest.
5. After reviewing canonical D1 binding and testing backups/rollback on isolated sandbox, apply **0100 and then 0101** only following explicit approval. Never run migrations by opening the PR.
6. Enable `ORDER_CHANGE_FEED_ENABLED=1` and `ORDER_FCM_ENABLED=1` **only after** schema, ACL, service account and Android signed build have been verified in a segregated test environment.
7. Verify post-login POST registration, cross-tenant grants, store revocation, logout DELETE, token refresh, offline store changes, duplicate webhook events, FCM unregistered, forced 401/403, no PII, alarms under Doze/force-stop and side-by-side web + two Android devices.
8. Measure push dispatch p50/p95, Android sync p95, D1 reads, registration errors, revoked-token rate, counts of missed order events. Keep automatic foreground polling and JobScheduler fallback.

## Safety & delivery sequencing
- PR #351 remains Draft: change log migration 0100 and HMAC cursors not deployed.
- This PR is stacked on #351, with migration 0101. Neither PR authorizes a Production/Preview change.
- Feature remains OFF by default and returns 404 for registration without both flags.
- Do not merge/publish or make any live database write until explicit owner approval and sandbox acceptance.
- A successful CI build alone does not confirm mobile push delivery or the service account configuration.
