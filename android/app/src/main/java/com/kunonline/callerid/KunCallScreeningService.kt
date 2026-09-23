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

        // Every screened call is also a synchronization trigger. The cached overlay is immediate,
        // then a freshly-arrived order can replace it as soon as the network refresh completes.
        if (!KunApi.hasSession(this)) return
        thread(name = "kun-call-live-sync") {
            val result = runCatching { KunApi.syncWithStoredSession(this) }.getOrNull()
            if (result?.ok != true) return@thread
            val fresh = CustomerCache.lookup(this, number) ?: return@thread
            CallActivityStore.mark(this, fresh.orderId, number, incoming)
            if (fresh != cached) {
                CallerOverlay.show(this, fresh, incoming)
            }
        }
    }
}
