package com.kunonline.callerid

import android.telecom.Call
import android.telecom.CallScreeningService

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val number = callDetails.handle?.schemeSpecificPart.orEmpty()
        CustomerCache.lookup(this, PhoneNormalizer.normalize(number))
        respondToCall(callDetails, CallResponse.Builder().build())
    }
}
