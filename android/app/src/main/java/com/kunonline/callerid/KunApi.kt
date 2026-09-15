package com.kunonline.callerid

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class SyncResult(val ok: Boolean, val message: String, val customerCount: Int = 0)

object KunApi {
    private const val BASE_URL = "https://app.kun-online.com"
    private const val AUTH_PREFS = "kun_auth"
    private const val SESSION_KEY = "session_cookie"

    private data class HttpResult(val code: Int, val body: String, val setCookie: String?)

    private fun request(method: String, path: String, body: String? = null, cookie: String? = null): HttpResult {
        val connection = (URL(BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10000
            readTimeout = 15000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
            if (body != null) doOutput = true
        }
        if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val setCookie = connection.getHeaderField("Set-Cookie")?.substringBefore(';')
        connection.disconnect()
        return HttpResult(code, text, setCookie)
    }

    fun loginAndSync(context: Context, email: String, password: String): SyncResult {
        return runCatching {
            val payload = JSONObject().put("email", email.trim()).put("password", password).toString()
            val login = request("POST", "/api/login", payload)
            if (login.code !in 200..299) {
                val message = runCatching { JSONObject(login.body).optString("error") }.getOrNull().orEmpty()
                return SyncResult(false, message.ifBlank { "تعذر تسجيل الدخول" })
            }
            val cookie = login.setCookie
            if (cookie.isNullOrBlank()) return SyncResult(false, "تم الدخول لكن لم تصل جلسة صالحة")
            SecureStore.put(context, AUTH_PREFS, SESSION_KEY, cookie)
            syncWithCookie(context, cookie)
        }.getOrElse { SyncResult(false, "تعذر الاتصال بكن أونلاين") }
    }

    fun syncWithStoredSession(context: Context): SyncResult {
        val cookie = SecureStore.get(context, AUTH_PREFS, SESSION_KEY)
            ?: return SyncResult(false, "سجّل الدخول أولاً")
        return syncWithCookie(context, cookie)
    }

    private fun syncWithCookie(context: Context, cookie: String): SyncResult {
        return runCatching {
            val response = request("GET", "/api/state", cookie = cookie)
            if (response.code == 401) {
                SecureStore.put(context, AUTH_PREFS, SESSION_KEY, null)
                return SyncResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
            }
            if (response.code !in 200..299) return SyncResult(false, "تعذر مزامنة بيانات العملاء")
            val root = JSONObject(response.body)
            val orders = root.optJSONArray("orders") ?: org.json.JSONArray()
            val count = CustomerCache.replaceAll(context, orders)
            SyncResult(true, "تمت المزامنة", count)
        }.getOrElse { SyncResult(false, "تعذر قراءة بيانات العملاء") }
    }

    fun hasSession(context: Context): Boolean = SecureStore.get(context, AUTH_PREFS, SESSION_KEY) != null

    fun logout(context: Context) {
        SecureStore.put(context, AUTH_PREFS, SESSION_KEY, null)
        CustomerCache.clear(context)
    }
}
