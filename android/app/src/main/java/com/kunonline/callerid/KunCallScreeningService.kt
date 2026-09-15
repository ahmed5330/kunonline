package com.kunonline.callerid

import android.telecom.Call
import android.telecom.CallScreeningService

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val number = PhoneNormalizer.normalize(callDetails.handle?.schemeSpecificPart)
        val customer = CustomerCache.lookup(this, number)

        // Never delay call handling for UI or network work.
        respondToCall(callDetails, CallResponse.Builder().build())

        if (customer != null) CallerOverlay.show(this, customer)
    }
}
