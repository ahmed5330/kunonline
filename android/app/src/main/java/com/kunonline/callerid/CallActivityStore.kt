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

    /**
     * Only a call actually seen by Android's screening service is counted.
     * Cached and live caller lookups may report the same event twice.
     */
    @Synchronized fun markObserved(context: Context, orderId: String?, phone: String, incoming: Boolean,
                                    now: Long = System.currentTimeMillis()): Boolean {
        val id = orderId.orEmpty().trim()
        if (id.isBlank()) return false
        val normalized = PhoneNormalizer.normalize(phone)
        val duplicate = active(context, now).any {
            it.orderId == id && it.phone == normalized && it.incoming == incoming &&
                now - it.startedAt in 0..15_000L
        }
        if (!duplicate) mark(context, id, normalized, incoming, now)
        return !duplicate
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
