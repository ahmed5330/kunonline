package com.kunonline.callerid

import android.telecom.Call
import android.telecom.CallScreeningService

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val incoming = callDetails.callDirection == Call.Details.DIRECTION_INCOMING
        val number = PhoneNormalizer.normalize(callDetails.handle?.schemeSpecificPart)
        val customer = CustomerCache.lookup(this, number)

        // Launch caller information immediately from the local cache for both directions.
        if (customer != null) {
            CallerOverlay.show(this, customer, incoming)
        }

        // Android requires an explicit screening response for incoming calls only.
        if (incoming) {
            respondToCall(callDetails, CallResponse.Builder().build())
        }
    }
}
