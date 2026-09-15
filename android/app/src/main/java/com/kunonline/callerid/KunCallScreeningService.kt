package com.kunonline.callerid

import android.content.Intent
import android.telecom.Call
import android.telecom.CallScreeningService

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val phone = PhoneNormalizer.normalize(callDetails.handle?.schemeSpecificPart.orEmpty())
        val customer = CustomerCache.lookup(this, phone)

        if (callDetails.callDirection == Call.Details.DIRECTION_INCOMING) {
            respondToCall(callDetails, CallResponse.Builder().build())
        }

        if (customer != null) {
            startActivity(Intent(this, CallerCardActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY)
                putExtra("phone", phone)
            })
        }
    }
}
