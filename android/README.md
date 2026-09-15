# Kun Online Android Caller ID

Native Android companion app for Kun Online customer-service teams.

## What it does
When an incoming or outgoing phone number matches a customer/order already synced from Kun Online, the app shows a customer card immediately from local storage. No network request is made in the call-screening critical path.

## Caller card
The card can show:
- Customer name and normalized phone.
- Latest order id/ref and status.
- Product and total.
- Governorate and address.
- Latest order note.
- Previous-order count.
- Button to open Kun Online.

## Sync
- Login uses the existing Kun Online `/api/login` endpoint.
- Customer/order data is read from the authenticated `/api/state` response.
- A manual sync is available in the app.
- A low-frequency JobScheduler sync runs about once per hour after login.
- The schedule is restored after device reboot and cancelled on logout.
- The call itself always uses local data only.

## Local security
- The session cookie is encrypted with an AES-GCM key stored in Android Keystore.
- Customer payloads are encrypted before being written to private SharedPreferences.
- Phone numbers are SHA-256 hashed before being used as local cache keys.
- Passwords are never stored.
- Android backup is disabled for the app.
- Logout clears the local customer cache and session.
- Customer PII is not written to application logs.

## Android setup
The user must grant the Android call-screening role and the special "display over other apps" permission. `READ_CONTACTS` is optional but recommended: Android only sends calls for saved contacts to a CallScreeningService when this permission is granted.

## Build
GitHub Actions runs unit tests and `assembleDebug`, then publishes the installable debug APK as the `kun-online-caller-id-debug-apk` artifact.
