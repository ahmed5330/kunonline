package com.kunonline.callerid

import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class MobileSyncResponse(val code: Int, val body: JSONObject, val changed: Boolean = true)

/** Session-scoped baselines shared by UI, background sync and caller ID. */
object MobileSyncClient {
    private var activeCookie = ""
    private val states = linkedMapOf<String, MobileSyncAccumulator>()
    private var legacyUntil = 0L

    @Synchronized fun clear() {
        activeCookie = ""
        states.clear()
        legacyUntil = 0L
    }

    @Synchronized fun fetch(cookie: String, source: String, forceFull: Boolean = false): MobileSyncResponse {
        if (cookie != activeCookie) {
            clear()
            activeCookie = cookie
        }
        if (forceFull) states.remove(source)
        if (states.size >= 8 && !states.containsKey(source)) states.remove(states.keys.first())
        val accumulator = states.getOrPut(source) { MobileSyncAccumulator() }
        val endpoint = if (source.substringBefore('?') == "/api/state") "/api/mobile/state-sync" else "/api/mobile/board-sync"
        val query = source.substringAfter('?', "")
        val syncPath = endpoint + "?" + query + if (accumulator.cursor.isBlank()) "" else "&cursor=" + URLEncoder.encode(accumulator.cursor, "UTF-8")
        val response = if (SystemClock.elapsedRealtime() < legacyUntil) get(cookie, source) else get(cookie, syncPath)
        if (response.code == 401 || response.code == 403) {
            clear()
            return response
        }
        if (response.code == 404 || response.code == 405) {
            legacyUntil = SystemClock.elapsedRealtime() + 300_000L
            states.remove(source)
            return get(cookie, source)
        }
        if (response.code !in 200..299) return response
        if (SystemClock.elapsedRealtime() < legacyUntil) return response
        val changed = try {
            accumulator.accept(response.body)
        } catch (_: Exception) {
            // Never merge a partial/corrupt delta. Rebase once from the server.
            states.remove(source)
            val reset = get(cookie, endpoint + "?" + query)
            if (reset.code !in 200..299) return reset
            val fresh = MobileSyncAccumulator()
            fresh.accept(reset.body)
            states[source] = fresh
            return MobileSyncResponse(200, JSONObject(requireNotNull(fresh.state).toString()))
        }
        return MobileSyncResponse(200, JSONObject(requireNotNull(accumulator.state).toString()), changed)
    }

    private fun get(cookie: String, path: String): MobileSyncResponse {
        val connection = (URL("https://app.kun-online.com" + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 20_000
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-Kun-Mobile", "native-android/2.6.7")
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val body = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            return MobileSyncResponse(code, body)
        } finally {
            connection.disconnect()
        }
    }
}
