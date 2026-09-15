package com.kunonline.callerid

import android.content.Context

data class CallerCustomer(val name: String, val phone: String, val orderRef: String?, val status: String?)

object CustomerCache {
    fun lookup(context: Context, phone: String): CallerCustomer? {
        if (phone.isBlank()) return null
        val prefs = context.getSharedPreferences("caller_cache", Context.MODE_PRIVATE)
        val value = prefs.getString(phone, null) ?: return null
        val parts = value.split("|", limit = 4)
        return CallerCustomer(parts.getOrElse(0) { "" }, phone, parts.getOrNull(1), parts.getOrNull(2))
    }
}
