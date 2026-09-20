package com.kunonline.mobile

import android.content.Intent
import android.telecom.Call
import android.telecom.CallScreeningService

class KunCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        // Caller ID only: never delay or block the customer's call.
        if (callDetails.callDirection == Call.Details.DIRECTION_INCOMING) {
            respondToCall(callDetails, CallResponse.Builder().build())
        }

        val phone = callDetails.handle?.schemeSpecificPart.orEmpty()
        if (phone.isBlank()) return

        val intent = Intent(this, CallerIdActivity::class.java).apply {
            putExtra(CallerIdActivity.EXTRA_PHONE, phone)
            putExtra(CallerIdActivity.EXTRA_DIRECTION, callDetails.callDirection)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NO_HISTORY)
        }
        runCatching { startActivity(intent) }
    }
}
