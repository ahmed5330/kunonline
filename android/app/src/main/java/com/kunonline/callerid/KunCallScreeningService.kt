package com.kunonline.callerid

import android.telecom.Call
import android.telecom.CallScreeningService
import kotlin.concurrent.thread

class KunCallScreeningService : CallScreeningService() {
    private fun observed(customer: CallerCustomer, number: String, incoming: Boolean) {
        val orderId = customer.orderId
        if (!CallActivityStore.markObserved(this, orderId, number, incoming)) return
        if (!KunApi.hasSession(this)) return
        thread(name = "kun-observed-call-log") {
            val id = orderId ?: return@thread
            runCatching { KunCustomerServiceApi.claimContact(this, id, selectedClientId = customer.clientId) }
            runCatching { KunCustomerServiceApi.logContact(this, id, "phone", "screened",
                if (incoming) "incoming" else "outgoing", selectedClientId = customer.clientId) }
        }
    }

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
            observed(cached, number, incoming)
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
                observed(fresh, number, incoming)
                if (fresh != cached) CallerOverlay.show(this, fresh, incoming)
            }
        }
    }
}
