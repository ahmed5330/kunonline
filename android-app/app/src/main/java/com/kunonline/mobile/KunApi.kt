package com.kunonline.mobile

import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object KunApi {
    data class CallerInfo(
        val found: Boolean,
        val needsLogin: Boolean = false,
        val name: String = "",
        val phone: String = "",
        val gov: String = "",
        val address: String = "",
        val totalOrders: Int = 0,
        val totalSpent: Double = 0.0,
        val lastOrderDate: String = "",
        val customerId: String = ""
    )

    fun lookupCaller(rawPhone: String): CallerInfo {
        val phone = normalizePhone(rawPhone)
        if (phone.isBlank()) return CallerInfo(found = false, phone = rawPhone)

        val meResponse = getJson("/api/me") ?: return CallerInfo(found = false, needsLogin = true, phone = phone)
        val me = runCatching { JSONObject(meResponse.body) }.getOrNull()
            ?: return CallerInfo(found = false, needsLogin = true, phone = phone)
        if (meResponse.code !in 200..299 || me.optString("role").isBlank()) {
            return CallerInfo(found = false, needsLogin = true, phone = phone)
        }

        val clientId = me.optString("clientId").takeIf { it.isNotBlank() && it != "null" }
        val path = buildString {
            append("/api/customers")
            if (clientId != null) append("?clientId=").append(java.net.URLEncoder.encode(clientId, "UTF-8"))
        }
        val customersResponse = getJson(path) ?: return CallerInfo(found = false, phone = phone)
        if (customersResponse.code == 401) return CallerInfo(found = false, needsLogin = true, phone = phone)
        if (customersResponse.code !in 200..299) return CallerInfo(found = false, phone = phone)

        val array = parseArray(customersResponse.body)
        var match: JSONObject? = null
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            if (normalizePhone(item.optString("phone")) == phone) {
                match = item
                break
            }
        }
        val c = match ?: return CallerInfo(found = false, phone = phone)
        return CallerInfo(
            found = true,
            name = c.optString("name"),
            phone = c.optString("phone", phone),
            gov = c.optString("gov"),
            address = c.optString("address"),
            totalOrders = c.optInt("totalOrders", 0),
            totalSpent = c.optDouble("totalSpent", 0.0),
            lastOrderDate = c.optString("lastOrderDate"),
            customerId = c.optString("id")
        )
    }

    private data class HttpResult(val code: Int, val body: String)

    private fun getJson(path: String): HttpResult? = runCatching {
        val base = BuildConfig.KUN_BASE_URL.trimEnd('/')
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 2500
            readTimeout = 2500
            setRequestProperty("Accept", "application/json")
            CookieManager.getInstance().getCookie(base)?.let { setRequestProperty("Cookie", it) }
        }
        val code = connection.responseCode
        val stream = if (code in 200..399) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        HttpResult(code, body)
    }.getOrNull()

    private fun parseArray(body: String): JSONArray {
        val trimmed = body.trim()
        if (trimmed.startsWith("[")) return runCatching { JSONArray(trimmed) }.getOrDefault(JSONArray())
        val obj = runCatching { JSONObject(trimmed) }.getOrNull() ?: return JSONArray()
        return obj.optJSONArray("customers") ?: obj.optJSONArray("results") ?: obj.optJSONArray("items") ?: JSONArray()
    }

    fun normalizePhone(raw: String): String {
        var d = raw.filter { it.isDigit() }
        d = when {
            d.startsWith("0020") -> "0" + d.drop(4)
            d.startsWith("20") && d.length == 12 -> "0" + d.drop(2)
            d.startsWith("00966") -> "0" + d.drop(5)
            d.startsWith("966") && d.length == 12 -> "0" + d.drop(3)
            else -> d
        }
        return d
    }
}
