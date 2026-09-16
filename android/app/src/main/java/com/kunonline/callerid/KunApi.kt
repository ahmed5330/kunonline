package com.kunonline.callerid

import android.content.Context
import org.json.JSONArray
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

    private fun apiError(response: HttpResult, fallback: String): String =
        runCatching { JSONObject(response.body).optString("error") }.getOrNull().orEmpty().ifBlank { fallback }

    fun loginAndSync(context: Context, email: String, password: String): SyncResult {
        return runCatching {
            val payload = JSONObject().put("email", email.trim()).put("password", password).toString()
            val login = request("POST", "/api/login", payload)
            if (login.code !in 200..299) return SyncResult(false, apiError(login, "تعذر تسجيل الدخول"))
            val cookie = login.setCookie
            if (cookie.isNullOrBlank()) return SyncResult(false, "تم الدخول لكن لم تصل جلسة صالحة")
            SecureStore.put(context, AUTH_PREFS, SESSION_KEY, cookie)
            syncWithCookie(context, cookie)
        }.getOrElse { SyncResult(false, "تعذر الاتصال بكن أونلاين") }
    }

    fun repairPasswordWithStoredAdminSession(context: Context, email: String, newPassword: String): SyncResult {
        if (email.isBlank()) return SyncResult(false, "اكتب إيميل الحساب")
        if (newPassword.length < 8) return SyncResult(false, "كلمة المرور الجديدة لازم تكون 8 حروف على الأقل")
        val cookie = SecureStore.get(context, AUTH_PREFS, SESSION_KEY)
            ?: return SyncResult(false, "لا توجد جلسة حالية صالحة للإصلاح")
        return runCatching {
            val usersResponse = request("GET", "/api/users", cookie = cookie)
            if (usersResponse.code == 401) return SyncResult(false, "الجلسة الحالية انتهت — لا تسجل خروج قبل إعادة الدخول من الإدارة")
            if (usersResponse.code == 403) return SyncResult(false, "الجلسة الحالية ليست بصلاحية مدير، لذلك لا يمكن إصلاح الباسورد منها")
            if (usersResponse.code !in 200..299) return SyncResult(false, apiError(usersResponse, "تعذر قراءة حسابات النظام"))

            val users = JSONArray(usersResponse.body)
            val wanted = email.trim().lowercase()
            var target: JSONObject? = null
            for (i in 0 until users.length()) {
                val item = users.optJSONObject(i) ?: continue
                if (item.optString("email").trim().lowercase() == wanted) {
                    target = item
                    break
                }
            }
            val user = target ?: return SyncResult(false, "الحساب غير موجود ضمن حسابات الإدارة الحالية")
            val payload = JSONObject()
                .put("id", user.optString("id"))
                .put("email", user.optString("email"))
                .put("name", user.optString("name"))
                .put("role", user.optString("role"))
                .put("status", user.optString("status").ifBlank { "active" })
                .put("password", newPassword)
            val clientId = user.optString("clientId")
            if (clientId.isNotBlank()) payload.put("clientId", clientId)

            val reset = request("POST", "/api/users", payload.toString(), cookie)
            if (reset.code !in 200..299) return SyncResult(false, apiError(reset, "تعذر إعادة تعيين كلمة المرور"))

            val verified = loginAndSync(context, email, newPassword)
            if (!verified.ok) return SyncResult(false, "تم تغيير كلمة المرور لكن تعذر تأكيد تسجيل الدخول: ${verified.message}")
            SyncResult(true, "تم إصلاح كلمة المرور وتأكيد تسجيل الدخول", verified.customerCount)
        }.getOrElse { SyncResult(false, "تعذر إصلاح كلمة المرور من الجلسة الحالية") }
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
            val orders = root.optJSONArray("orders") ?: JSONArray()
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
