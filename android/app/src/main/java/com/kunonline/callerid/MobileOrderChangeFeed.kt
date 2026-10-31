package com.kunonline.callerid

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

/** Cheap server-authorized order invalidation hints; never customer data. */
data class OrderChangeDecision(
    val refresh: Boolean,
    val cursor: String,
    val hasMore: Boolean = false
)

object OrderChangeEnvelope {
    fun parse(value: JSONObject): OrderChangeDecision {
        require(value.optBoolean("ok", false))
        require(value.getInt("protocol") == 1)
        val cursor = value.getString("cursor")
        require(cursor.matches(Regex("v1\\.[0-9]+\\.[a-f0-9]{64}")))
        return when (value.getString("mode")) {
            "reset" -> {
                require(value.optBoolean("resetRequired"))
                OrderChangeDecision(true, cursor)
            }
            "changes" -> {
                require((value.optJSONArray("changes")?.length() ?: 0) > 0)
                OrderChangeDecision(true, cursor, value.optBoolean("hasMore"))
            }
            "unchanged" -> {
                require((value.optJSONArray("changes")?.length() ?: 0) == 0)
                OrderChangeDecision(false, cursor)
            }
            else -> error("Unknown order change mode")
        }
    }
}

data class OrderChangeHint(
    val refresh: Boolean = false,
    val cursor: String = "",
    val scopeKey: String = "",
    val available: Boolean = false
)

/**
 * 15s foreground hints with 60s full-state fallback; scoped, encrypted
 * cursor persistence and fail-open-to-authoritative-refresh on errors.
 *
 * 404/503 means schema/feature absent: do NOT acknowledge a cursor and
 * continue the existing /api/state flow. A hint can only be acknowledged
 * after the app successfully fetches an authoritative snapshot.
 */
object MobileOrderChangeFeed {
    private const val BASE = "https://app.kun-online.com"
    private const val PREFS = "kun_order_change_cursor_v1"
    private const val DISABLED_MS = 300_000L
    private var activeScope = ""
    private var inactiveUntil = 0L

    private fun hash(input: String): String =
        MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
            .joinToString("") { "%02x".format(it) }

    @Synchronized fun clear(context: Context) {
        activeScope = ""
        inactiveUntil = 0L
        SecureStore.put(context, PREFS, "scope", null)
        SecureStore.put(context, PREFS, "cursor", null)
    }

    fun peek(context: Context, scope: ScopeInfo): OrderChangeHint {
        val cookie = KunApi.sessionCookie(context) ?: return OrderChangeHint()
        val key = hash(cookie + "\u0000" + scope.clientId + "\u0000" + scope.storeId)
        val cursor = synchronized(this) {
            if (activeScope != key) {
                activeScope = key
                inactiveUntil = 0L
            }
            if (SystemClock.elapsedRealtime() < inactiveUntil) return OrderChangeHint()
            val storedKey = SecureStore.get(context, PREFS, "scope")
            if (storedKey == key) SecureStore.get(context, PREFS, "cursor").orEmpty() else ""
        }
        // Network access must not hold this monitor: logout and store-change
        // revocation must remain immediate even during a 12s HTTP timeout.
        val query = buildList {
            if (scope.clientId.isNotBlank()) add("clientId=" + enc(scope.clientId))
            if (scope.storeId.isNotBlank()) add("storeId=" + enc(scope.storeId))
            if (cursor.isNotBlank()) add("cursor=" + enc(cursor))
        }.joinToString("&")
        val connection = runCatching {
            (URL(BASE + "/api/mobile/order-changes?" + query).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8_000
                readTimeout = 12_000
                setRequestProperty("Cookie", cookie)
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-Kun-Mobile", "native-android/" + BuildConfig.VERSION_NAME)
            }
        }.getOrNull() ?: return OrderChangeHint()
        try {
            val code = connection.responseCode
            if (code == 404 || code == 405 || code == 503) {
                synchronized(this) {
                    if (activeScope == key) inactiveUntil = SystemClock.elapsedRealtime() + DISABLED_MS
                }
                return OrderChangeHint()
            }
            if (code == 401 || code == 403) return OrderChangeHint(refresh = true)
            if (code != 200) return OrderChangeHint()
            val body = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val decision = OrderChangeEnvelope.parse(body)
            if (KunApi.sessionCookie(context) != cookie) return OrderChangeHint()
            return synchronized(this) {
                if (activeScope != key) OrderChangeHint()
                else OrderChangeHint(decision.refresh, decision.cursor, key, available = true)
            }
        } catch (_: Exception) {
            // Corrupt/partial response never advances the cursor or claims success.
            return OrderChangeHint(refresh = true)
        } finally {
            connection.disconnect()
        }
    }

    @Synchronized fun acknowledge(context: Context, hint: OrderChangeHint, scope: ScopeInfo) {
        if (!hint.available || hint.cursor.isBlank() || activeScope != hint.scopeKey) return
        val cookie = KunApi.sessionCookie(context) ?: return
        if (hint.scopeKey != hash(cookie + "\u0000" + scope.clientId + "\u0000" + scope.storeId)) return
        SecureStore.put(context, PREFS, "scope", hint.scopeKey)
        SecureStore.put(context, PREFS, "cursor", hint.cursor)
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
