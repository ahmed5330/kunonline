package com.kunonline.callerid

import android.telecom.Call
import android.telecom.CallScreeningService

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val number = PhoneNormalizer.normalize(callDetails.handle?.schemeSpecificPart)
        val customer = CustomerCache.lookup(this, number)

        // Android requires a screening response for incoming calls only.
        if (callDetails.callDirection == Call.Details.DIRECTION_INCOMING) {
            respondToCall(callDetails, CallResponse.Builder().build())
        }

        // Caller-ID display is useful for both incoming and outgoing calls.
        if (customer != null) CallerOverlay.show(this, customer)
    }
}
