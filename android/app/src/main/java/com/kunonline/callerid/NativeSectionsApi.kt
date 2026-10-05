package com.kunonline.callerid

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class NativeSectionResult(
    val ok: Boolean,
    val message: String = "",
    val code: Int = 0,
    val obj: JSONObject? = null,
    val array: JSONArray? = null
)

object NativeSectionsApi {
    private const val BASE_URL = "https://app.kun-online.com"

    fun scope(context: Context): ScopeInfo {
        val cookie = KunApi.sessionCookie(context) ?: return ScopeInfo()
        return runCatching { KunApi.resolveScope(cookie) }.getOrDefault(ScopeInfo())
    }

    fun get(context: Context, path: String, scoped: Boolean = false): NativeSectionResult =
        request(context, "GET", if (scoped) scopedPath(context, path) else path)

    fun post(context: Context, path: String, body: JSONObject = JSONObject(), scoped: Boolean = false): NativeSectionResult =
        request(context, "POST", if (scoped) scopedPath(context, path) else path, body)

    fun delete(context: Context, path: String, body: JSONObject = JSONObject(), scoped: Boolean = false): NativeSectionResult =
        request(context, "DELETE", if (scoped) scopedPath(context, path) else path, body)

    fun put(context: Context, path: String, body: JSONObject = JSONObject()): NativeSectionResult =
        request(context, "PUT", path, body)

    fun printing(context: Context): NativeSectionResult = get(context, "/api/printing", scoped = true)

    fun queueJt(context: Context, orderId: String, storeId: String? = null): NativeSectionResult {
        val scope = scope(context)
        if (scope.clientId.isBlank()) return NativeSectionResult(false, "تعذر تحديد حساب العميل")
        val sid = storeId?.takeIf { it.isNotBlank() } ?: scope.storeId.takeIf { it.isNotBlank() }
        val query = buildString {
            append("?clientId=").append(enc(scope.clientId))
            if (!sid.isNullOrBlank()) append("&storeId=").append(enc(sid))
        }
        val body = JSONObject().put("clientId", scope.clientId)
        if (!sid.isNullOrBlank()) body.put("storeId", sid)
        return post(context, "/api/jt/shipments/${enc(orderId)}$query", body)
    }

    fun printJt(context: Context, orderId: String, storeId: String? = null): NativeSectionResult {
        val scope = scope(context)
        if (scope.clientId.isBlank()) return NativeSectionResult(false, "تعذر تحديد حساب العميل")
        val sid = storeId?.takeIf { it.isNotBlank() } ?: scope.storeId.takeIf { it.isNotBlank() }
        val query = buildString {
            append("?clientId=").append(enc(scope.clientId))
            if (!sid.isNullOrBlank()) append("&storeId=").append(enc(sid))
        }
        val body = JSONObject().put("clientId", scope.clientId)
        if (!sid.isNullOrBlank()) body.put("storeId", sid)
        return post(context, "/api/jt/shipments/${enc(orderId)}/print$query", body)
    }

    fun finance(context: Context): Map<String, NativeSectionResult> = linkedMapOf(
        "dashboard" to get(context, "/api/dashboard", scoped = true),
        "overview" to get(context, "/api/accounting/overview", scoped = true),
        "entries" to get(context, "/api/accounting/entries?limit=60", scoped = true),
        "collected" to get(context, "/api/accounting/collected-profit", scoped = true)
    )

    fun accounting(context: Context): Map<String, NativeSectionResult> = linkedMapOf(
        "overview" to get(context, "/api/accounting/overview", scoped = true),
        "entries" to get(context, "/api/accounting/entries?limit=150", scoped = true),
        "catalog" to get(context, "/api/accounting/catalog", scoped = true)
    )

    fun addAccountingEntry(context: Context, payload: JSONObject): NativeSectionResult =
        post(context, "/api/accounting/entries", payload)

    fun deleteAccountingEntry(context: Context, id: String, storeId: String): NativeSectionResult =
        delete(context, "/api/accounting/entries/${enc(id)}", JSONObject().put("storeId", storeId))

    fun inventory(context: Context): Map<String, NativeSectionResult> = linkedMapOf(
        "state" to get(context, "/api/state", scoped = true),
        "log" to get(context, "/api/inventory/stock-log?limit=200", scoped = true),
        "suppliers" to get(context, "/api/suppliers", scoped = true)
    )

    fun adjustInventory(
        context: Context,
        productId: String,
        delta: Double,
        stockDate: String,
        supplierId: String?,
        note: String
    ): NativeSectionResult {
        val scope = scope(context)
        val body = JSONObject()
            .put("clientId", scope.clientId)
            .put("productId", productId)
            .put("delta", delta)
            .put("stockDate", stockDate)
            .put("note", note)
        if (scope.storeId.isNotBlank()) body.put("storeId", scope.storeId)
        if (!supplierId.isNullOrBlank()) body.put("supplierId", supplierId)
        return post(context, "/api/inventory/stock-adjust", body)
    }

    fun campaigns(context: Context): NativeSectionResult =
        get(context, "/api/integrations/meta-ads/campaign-hub", scoped = true)

    fun syncCampaigns(context: Context, days: Int = 30): NativeSectionResult {
        val body = JSONObject().put("days", days.coerceIn(7, 90))
        return post(context, "/api/integrations/meta-ads/expert-sync", body, scoped = true)
    }

    fun wallet(context: Context): Map<String, NativeSectionResult> = linkedMapOf(
        "wallet" to get(context, "/api/wallet"),
        "log" to get(context, "/api/wallet/log?limit=150"),
        "access" to get(context, "/api/subscription/access")
    )

    fun integrations(context: Context): NativeSectionResult =
        get(context, "/api/integrations/readiness", scoped = true)

    fun createIntegration(context: Context, provider: String, storeName: String): NativeSectionResult =
        post(context, "/api/integrations/connections", JSONObject().put("provider", provider).put("storeName", storeName))

    fun saveIntegrationSecret(context: Context, connectionId: String, secret: String, value: String): NativeSectionResult =
        put(context, "/api/integration-secrets/${enc(connectionId)}/${enc(secret)}", JSONObject().put("value", value))

    fun validateIntegration(context: Context, connectionId: String, payload: JSONObject = JSONObject()): NativeSectionResult =
        post(context, "/api/integrations/connections/${enc(connectionId)}/validate", payload)

    fun removeIntegration(context: Context, connectionId: String): NativeSectionResult =
        delete(context, "/api/integrations/connections/${enc(connectionId)}")

    fun stores(context: Context): NativeSectionResult {
        val scope = scope(context)
        if (scope.clientId.isBlank()) return NativeSectionResult(false, "تعذر تحديد حساب العميل")
        return get(context, "/api/my-store-context?clientId=${enc(scope.clientId)}")
    }

    private fun scopedPath(context: Context, path: String): String {
        val scope = scope(context)
        if (scope.clientId.isBlank()) return path
        val separator = if (path.contains("?")) "&" else "?"
        return buildString {
            append(path)
            append(separator).append("clientId=").append(enc(scope.clientId))
            if (scope.storeId.isNotBlank()) append("&storeId=").append(enc(scope.storeId))
        }
    }

    private fun request(
        context: Context,
        method: String,
        path: String,
        body: JSONObject? = null
    ): NativeSectionResult {
        val cookie = KunApi.sessionCookie(context)
            ?: return NativeSectionResult(false, "سجّل الدخول أولاً", 401)
        return runCatching {
            val connection = (URL(BASE_URL + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 12_000
                readTimeout = 30_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Cookie", cookie)
                setRequestProperty("X-Kun-Mobile", "native-android/2.8.0")
                if (body != null) doOutput = true
            }
            if (body != null) {
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            connection.disconnect()

            val obj = runCatching { JSONObject(text) }.getOrNull()
            val array = if (obj == null) runCatching { JSONArray(text) }.getOrNull() else null
            val message = obj?.optString("error").orEmpty()
                .ifBlank { obj?.optString("message").orEmpty() }
                .ifBlank {
                    if (code in 200..299) "" else "تعذر تنفيذ الطلب (HTTP $code)"
                }
            NativeSectionResult(code in 200..299, message, code, obj, array)
        }.getOrElse {
            NativeSectionResult(false, "تعذر الاتصال بكن أونلاين")
        }
    }

    private fun enc(value: String): String =
        URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}
