package com.kunonline.callerid

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

data class CallerCustomer(
    val name: String,
    val phone: String,
    val orderRef: String?,
    val status: String?,
    val product: String?,
    val total: Double?,
    val gov: String?,
    val address: String?,
    val note: String?,
    val previousOrders: Int
)

object CustomerCache {
    private const val PREFS = "caller_cache_v2"
    private const val META_COUNT = "_count"
    private const val META_SYNCED = "_synced"

    private fun keyFor(phone: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(phone.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun replaceAll(context: Context, orders: JSONArray): Int {
        val grouped = linkedMapOf<String, MutableList<JSONObject>>()
        for (i in 0 until orders.length()) {
            val order = orders.optJSONObject(i) ?: continue
            val phone = PhoneNormalizer.normalize(order.optString("phone"))
            if (phone.isBlank()) continue
            grouped.getOrPut(phone) { mutableListOf() }.add(order)
        }

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit().clear()
        grouped.forEach { (phone, list) ->
            val latest = list.first()
            val payload = JSONObject()
                .put("name", latest.optString("name"))
                .put("phone", phone)
                .put("orderRef", latest.optString("id").ifBlank { latest.optString("ref") })
                .put("status", latest.optString("state"))
                .put("product", latest.optString("product"))
                .put("total", latest.optDouble("total", 0.0))
                .put("gov", latest.optString("gov"))
                .put("address", latest.optString("address"))
                .put("note", latest.optString("note"))
                .put("previousOrders", (list.size - 1).coerceAtLeast(0))
            editor.putString(keyFor(phone), SecureStore.encrypt(payload.toString()))
        }
        editor.putInt(META_COUNT, grouped.size)
        editor.putLong(META_SYNCED, System.currentTimeMillis())
        editor.apply()
        return grouped.size
    }

    fun lookup(context: Context, phone: String): CallerCustomer? {
        val normalized = PhoneNormalizer.normalize(phone)
        if (normalized.isBlank()) return null
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val cacheKey = keyFor(normalized)
        val raw = runCatching { prefs.getString(cacheKey, null) }.getOrElse {
            prefs.edit().remove(cacheKey).apply()
            null
        }
        val json = SecureStore.decrypt(raw)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        return CallerCustomer(
            name = json.optString("name"),
            phone = normalized,
            orderRef = json.optString("orderRef").takeIf { it.isNotBlank() },
            status = json.optString("status").takeIf { it.isNotBlank() },
            product = json.optString("product").takeIf { it.isNotBlank() },
            total = json.optDouble("total", 0.0).takeIf { it > 0 },
            gov = json.optString("gov").takeIf { it.isNotBlank() },
            address = json.optString("address").takeIf { it.isNotBlank() },
            note = json.optString("note").takeIf { it.isNotBlank() },
            previousOrders = json.optInt("previousOrders", 0)
        )
    }

    fun count(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return runCatching { prefs.getInt(META_COUNT, 0) }.getOrElse {
            prefs.edit().remove(META_COUNT).apply()
            0
        }
    }

    fun lastSyncedAt(context: Context): Long {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return runCatching { prefs.getLong(META_SYNCED, 0L) }.getOrElse {
            prefs.edit().remove(META_SYNCED).apply()
            0L
        }
    }

    fun clear(context: Context) = runCatching {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }.getOrNull()
}
