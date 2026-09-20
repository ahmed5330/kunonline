package com.kunonline.mobile

import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

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
            ?: return CallerInfo(found = false, phone = phone)

        // New optimized lookup. It understands the logged-in employee's assigned stores.
        val optimizedPath = "/api/mobile/caller-lookup?clientId=${enc(clientId)}&phone=${enc(phone)}"
        val optimized = getJson(optimizedPath)
        if (optimized?.code == 401) return CallerInfo(found = false, needsLogin = true, phone = phone)
        if (optimized != null && optimized.code in 200..299) {
            val payload = runCatching { JSONObject(optimized.body) }.getOrNull()
            if (payload != null) return parseCallerObject(payload, phone)
        }

        // Production-compatible fallback: discover every store this employee can access,
        // then query Customer 360 store-by-store instead of silently failing when a
        // multi-store user has no active store in the native caller process.
        return lookupAcrossAccessibleStores(clientId, phone)
    }

    private fun lookupAcrossAccessibleStores(clientId: String, phone: String): CallerInfo {
        val contextPath = "/api/my-store-context?clientId=${enc(clientId)}"
        val contextResponse = getJson(contextPath)
        if (contextResponse?.code == 401) return CallerInfo(found = false, needsLogin = true, phone = phone)

        val context = contextResponse?.takeIf { it.code in 200..299 }
            ?.let { runCatching { JSONObject(it.body) }.getOrNull() }
        val stores = context?.optJSONArray("stores") ?: JSONArray()
        val matches = mutableListOf<JSONObject>()

        if (stores.length() > 0) {
            for (i in 0 until stores.length()) {
                val store = stores.optJSONObject(i) ?: continue
                val storeId = store.optString("id").takeIf { it.isNotBlank() } ?: continue
                val response = getJson("/api/customers?clientId=${enc(clientId)}&storeId=${enc(storeId)}") ?: continue
                if (response.code == 401) return CallerInfo(found = false, needsLogin = true, phone = phone)
                if (response.code !in 200..299) continue
                collectMatches(parseArray(response.body), phone, matches)
            }
        } else {
            // Old/single-store servers may not expose my-store-context yet.
            val response = getJson("/api/customers?clientId=${enc(clientId)}")
                ?: return CallerInfo(found = false, phone = phone)
            if (response.code == 401) return CallerInfo(found = false, needsLogin = true, phone = phone)
            if (response.code !in 200..299) return CallerInfo(found = false, phone = phone)
            collectMatches(parseArray(response.body), phone, matches)
        }

        if (matches.isEmpty()) return CallerInfo(found = false, phone = phone)
        val newest = matches.maxWithOrNull(
            compareBy<JSONObject> { it.optString("lastOrderDate") }
                .thenBy { it.optInt("totalOrders", 0) }
        ) ?: matches.first()
        val totalOrders = matches.sumOf { it.optInt("totalOrders", 0) }
        val totalSpent = matches.sumOf { it.optDouble("totalSpent", 0.0) }
        val lastOrderDate = matches.map { it.optString("lastOrderDate") }.filter { it.isNotBlank() }.maxOrNull().orEmpty()

        return CallerInfo(
            found = true,
            name = newest.optString("name"),
            phone = newest.optString("phone", phone),
            gov = newest.optString("gov"),
            address = newest.optString("address"),
            totalOrders = totalOrders,
            totalSpent = totalSpent,
            lastOrderDate = lastOrderDate,
            customerId = newest.optString("id")
        )
    }

    private fun collectMatches(array: JSONArray, phone: String, out: MutableList<JSONObject>) {
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            if (normalizePhone(item.optString("phone")) == phone) out.add(item)
        }
    }

    private fun parseCallerObject(obj: JSONObject, fallbackPhone: String): CallerInfo {
        if (!obj.optBoolean("found", false)) return CallerInfo(found = false, phone = fallbackPhone)
        return CallerInfo(
            found = true,
            name = obj.optString("name"),
            phone = obj.optString("phone", fallbackPhone),
            gov = obj.optString("gov"),
            address = obj.optString("address"),
            totalOrders = obj.optInt("totalOrders", 0),
            totalSpent = obj.optDouble("totalSpent", 0.0),
            lastOrderDate = obj.optString("lastOrderDate"),
            customerId = obj.optString("customerId")
        )
    }

    private data class HttpResult(val code: Int, val body: String)

    private fun getJson(path: String): HttpResult? = runCatching {
        val base = BuildConfig.KUN_BASE_URL.trimEnd('/')
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 6000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-cache")
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

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

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
