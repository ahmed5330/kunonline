package com.kunonline.callerid

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object CallerJntEditApi {
    private const val BASE_URL = "https://app.kun-online.com"

    fun save(context: Context, orderId: String, payload: JSONObject, selectedClientId: String = ""): CustomerServiceJsonResult {
        val cookie = KunApi.sessionCookie(context)
            ?: return CustomerServiceJsonResult(false, "سجّل الدخول أولاً")
        val clientId = selectedClientId.ifBlank { runCatching { KunApi.resolveScope(cookie, context).clientId }.getOrDefault("") }
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

    /** Shipping-only edit; does not modify products, quantities or customer collection. */
    fun saveShipping(context: Context, orderId: String, storeId: String, payload: JSONObject, selectedClientId: String = ""): CustomerServiceJsonResult {
        val cookie = KunApi.sessionCookie(context) ?: return CustomerServiceJsonResult(false, "سجّل الدخول أولًا")
        val active = KunApi.resolveScope(cookie, context)
        val clientId = selectedClientId.ifBlank { active.clientId }
        if (clientId.isBlank() || storeId.isBlank()) return CustomerServiceJsonResult(false, "حدد متجر الطلب أولًا")
        // Leave permission decisions to the authenticated server. A transient
        // store-options fetch failure must not make the save button appear broken.
        payload.put("clientId", clientId).put("storeId", storeId)
        return runCatching {
            val encoded = URLEncoder.encode(orderId, Charsets.UTF_8.name()).replace("+", "%20")
            val connection = (URL("$BASE_URL/api/orders/$encoded/shipping-jnt").openConnection() as HttpURLConnection).apply {
                requestMethod = "PATCH"
                connectTimeout = 10_000
                readTimeout = 25_000
                doOutput = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("X-Kun-Mobile", "native-android/jnt-shipping")
                setRequestProperty("Cookie", cookie)
            }
            val root: JSONObject
            val code: Int
            try {
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                root = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            } finally { connection.disconnect() }
            if (code in 200..299 && root.optBoolean("ok"))
                CustomerServiceJsonResult(true, root.optString("message").ifBlank { "تم تعديل شحن J&T" }, root)
            else
                CustomerServiceJsonResult(false, root.optString("error").ifBlank {
                    if (code == 401) "انتهت الجلسة" else "تعذر تعديل الشحن"
                }, root)
        }.getOrElse { CustomerServiceJsonResult(false, "تعذر الاتصال بخدمة تعديل شحن J&T") }
    }

}
