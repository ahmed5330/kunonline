package com.kunonline.callerid

import android.telecom.Call
import android.telecom.CallScreeningService
import kotlin.concurrent.thread

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val incoming = callDetails.callDirection == Call.Details.DIRECTION_INCOMING
        val number = PhoneNormalizer.normalize(callDetails.handle?.schemeSpecificPart)

        // Android requires a fast screening response. Never wait for network here.
        if (incoming) {
            respondToCall(callDetails, CallResponse.Builder().build())
        }

        if (number.isBlank()) return
        val cached = CustomerCache.lookup(this, number)
        if (cached != null) {
            CallActivityStore.mark(this, cached.orderId, number, incoming)
            CallerOverlay.show(this, cached, incoming)
        }

        // A live lookup restores details when newer APKs have an empty/stale
        // order-list cache. Network calls never block Android's screening response.
        if (!KunApi.hasSession(this)) return
        thread(name = "kun-call-live-lookup") {
            val live = KunApi.lookupCallerLive(this, number)
            val fresh = live ?: run {
                runCatching { KunApi.syncWithStoredSession(this) }
                CustomerCache.lookup(this, number)
            }
            if (fresh != null) {
                CallActivityStore.mark(this, fresh.orderId, number, incoming)
                if (fresh != cached) CallerOverlay.show(this, fresh, incoming)
                // Claim is idempotent; it moves the order into "جاري الاتصال".
                // Never auto-release on focus, call end, or timer.
                fresh.orderId?.takeIf { it.isNotBlank() }?.let {
                    runCatching { KunCustomerServiceApi.claimContact(this, it) }
                }
            }
        }
    }
}
