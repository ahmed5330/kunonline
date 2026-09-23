package com.kunonline.callerid

import android.content.Context

data class ActiveCallActivity(
    val orderId: String,
    val phone: String,
    val incoming: Boolean,
    val startedAt: Long
)

object CallActivityStore {
    private const val PREFS = "kun_active_calls_v25"
    private const val TTL_MS = 5L * 60L * 1000L

    fun mark(context: Context, orderId: String?, phone: String, incoming: Boolean, now: Long = System.currentTimeMillis()) {
        val id = orderId.orEmpty().trim()
        if (id.isBlank()) return
        val cleanPhone = PhoneNormalizer.normalize(phone)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(id, "$now|${if (incoming) 1 else 0}|$cleanPhone")
            .apply()
    }

    fun active(context: Context, now: Long = System.currentTimeMillis()): List<ActiveCallActivity> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val expired = mutableListOf<String>()
        val result = prefs.all.mapNotNull { (orderId, rawValue) ->
            val raw = rawValue as? String ?: return@mapNotNull null
            val parts = raw.split('|', limit = 3)
            val startedAt = parts.getOrNull(0)?.toLongOrNull() ?: return@mapNotNull null
            if (now - startedAt !in 0..TTL_MS) {
                expired += orderId
                return@mapNotNull null
            }
            ActiveCallActivity(
                orderId = orderId,
                incoming = parts.getOrNull(1) == "1",
                phone = parts.getOrNull(2).orEmpty(),
                startedAt = startedAt
            )
        }.sortedByDescending { it.startedAt }
        if (expired.isNotEmpty()) {
            prefs.edit().also { editor -> expired.forEach(editor::remove) }.apply()
        }
        return result
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
