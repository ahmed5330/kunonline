package com.kunonline.callerid

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object CallerJntEditApi {
    private const val BASE_URL = "https://app.kun-online.com"

    fun save(context: Context, orderId: String, payload: JSONObject): CustomerServiceJsonResult {
        val cookie = KunApi.sessionCookie(context)
            ?: return CustomerServiceJsonResult(false, "سجّل الدخول أولاً")
        val clientId = runCatching { KunApi.resolveScope(cookie).clientId }.getOrDefault("")
        if (clientId.isBlank()) return CustomerServiceJsonResult(false, "تعذر تحديد حساب المتجر")

        return runCatching {
            payload.put("clientId", clientId)
            val encodedOrderId = URLEncoder.encode(orderId, Charsets.UTF_8.name()).replace("+", "%20")
            val connection = (URL("$BASE_URL/api/caller-jnt/orders/$encodedOrderId").openConnection() as HttpURLConnection).apply {
                requestMethod = "PATCH"
                connectTimeout = 10_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("X-Kun-Mobile", "native-android/caller-jnt")
                setRequestProperty("Cookie", cookie)
            }
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            connection.disconnect()
            val root = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (code in 200..299 && root.optBoolean("ok", true)) {
                CustomerServiceJsonResult(true, "تم حفظ بيانات العميل وعنوان J&T", root)
            } else {
                val message = root.optString("error").ifBlank { root.optString("message") }.ifBlank {
                    if (code == 401) "انتهت الجلسة — سجّل الدخول مرة أخرى" else "تعذر حفظ التعديلات"
                }
                CustomerServiceJsonResult(false, message, root)
            }
        }.getOrElse {
            CustomerServiceJsonResult(false, "تعذر الاتصال بكن أونلاين")
        }
    }
}
