# Kun Online Android Caller ID

Native Android companion app for Kun Online customer-service teams.

## Goal
When an incoming or outgoing phone number matches a Kun Online customer/order, show the locally cached customer context immediately without waiting for a network request during the call.

## Architecture
- Kotlin Android app.
- Android `CallScreeningService` for call-screening integration where supported.
- Room/local cache keyed by normalized phone number.
- Background incremental sync with the Kun Online Worker API.
- Deep link to the relevant Kun Online order/customer screen.
- No customer PII is written to application logs.

## Caller card
The card model supports customer name, normalized phone, latest order id/ref/state, products summary, total, governorate/address, latest note/contact, and previous-order count.

## Safety and privacy
- Unknown numbers are ignored.
- Logout clears the local customer cache.
- Lock-screen presentation should be minimal by default.
- Network sync is outside the call-screening critical path.
