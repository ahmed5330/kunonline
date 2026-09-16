package com.kunonline.callerid

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class CsStoreUi(
    val id: String,
    val name: String,
    val code: String,
    val role: String
)

data class CsOrderUi(
    val id: String,
    val clientId: String,
    val storeId: String,
    val storeName: String,
    val ref: String,
    val date: String,
    val createdAt: String,
    val name: String,
    val phone: String,
    val gov: String,
    val address: String,
    val product: String,
    val productId: String,
    val variantId: String,
    val productNote: String,
    val qty: Int,
    val unitPrice: Double,
    val total: Double,
    val source: String,
    val customerNote: String,
    val awb: String,
    val state: String,
    val checkpoint: String,
    val deferUntil: String,
    val stockBatchId: String,
    val stockBatchName: String,
    val stockAllocationStatus: String,
    val contactCount: Int,
    val latestInternalNote: String,
    val returnedFromDeferredToday: Boolean,
    val history: JSONArray,
    val contactLog: JSONArray,
    val raw: JSONObject
)

data class CustomerServiceBoardResult(
    val ok: Boolean,
    val message: String,
    val clientId: String = "",
    val role: String = "",
    val stores: List<CsStoreUi> = emptyList(),
    val selectedStoreId: String = "",
    val orders: List<CsOrderUi> = emptyList(),
    val stateLabels: Map<String, String> = emptyMap()
)

data class CustomerServiceJsonResult(
    val ok: Boolean,
    val message: String,
    val data: JSONObject = JSONObject()
)

data class CustomerServiceEditorData(
    val ok: Boolean,
    val message: String,
    val clientId: String = "",
    val details: JSONObject = JSONObject(),
    val catalog: JSONArray = JSONArray(),
    val historyOrder: JSONObject = JSONObject()
)

object KunCustomerServiceApi {
    private const val BASE_URL = "https://app.kun-online.com"

    private data class HttpResult(val code: Int, val body: String)

    private fun request(method: String, path: String, cookie: String, body: JSONObject? = null): HttpResult {
        val connection = (URL(BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10000
            readTimeout = 20000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-Kun-Mobile", "native-android/2.3")
            setRequestProperty("Cookie", cookie)
            if (body != null) doOutput = true
        }
        if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        return HttpResult(code, text)
    }

    private fun cookie(context: Context): String? = KunApi.sessionCookie(context)

    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun json(result: HttpResult): JSONObject = runCatching { JSONObject(result.body) }.getOrDefault(JSONObject())

    private fun errorMessage(result: HttpResult, fallback: String): String {
        val root = json(result)
        return root.optString("error").ifBlank { root.optString("message") }.ifBlank { fallback }
    }

    private fun authFailure(context: Context, result: HttpResult, fallback: String): CustomerServiceJsonResult {
        if (result.code == 401) return CustomerServiceJsonResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
        return CustomerServiceJsonResult(false, errorMessage(result, fallback))
    }

    private fun resolveClientId(cookie: String): String {
        val me = request("GET", "/api/me", cookie)
        if (me.code in 200..299) {
            val root = json(me)
            val value = root.optString("clientId").ifBlank { root.optString("client_id") }
            if (value.isNotBlank()) return value
        }
        val context = request("GET", "/api/my-client-context", cookie)
        if (context.code in 200..299) {
            val value = json(context).optJSONArray("clients")?.optJSONObject(0)?.optString("id").orEmpty()
            if (value.isNotBlank()) return value
        }
        val state = request("GET", "/api/state", cookie)
        if (state.code in 200..299) {
            val root = json(state)
            val client = root.optJSONArray("clients")?.optJSONObject(0)?.optString("id").orEmpty()
                .ifBlank { root.optJSONArray("businessClients")?.optJSONObject(0)?.optString("id").orEmpty() }
                .ifBlank {
                    val order = root.optJSONArray("orders")?.optJSONObject(0)
                    order?.optString("clientId").orEmpty().ifBlank { order?.optString("client_id").orEmpty() }
                }
            if (client.isNotBlank()) return client
        }
        return ""
    }

    fun fetchBoard(context: Context, storeId: String = ""): CustomerServiceBoardResult {
        val cookie = cookie(context) ?: return CustomerServiceBoardResult(false, "سجّل الدخول أولاً")
        return runCatching {
            val clientId = resolveClientId(cookie)
            if (clientId.isBlank()) return CustomerServiceBoardResult(false, "تعذر تحديد حساب المتجر")
            val path = buildString {
                append("/api/customer-service?clientId=${enc(clientId)}")
                if (storeId.isNotBlank()) append("&storeId=${enc(storeId)}")
            }
            val response = request("GET", path, cookie)
            if (response.code == 401) return CustomerServiceBoardResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
            if (response.code !in 200..299) return CustomerServiceBoardResult(false, errorMessage(response, "تعذر تحميل خدمة العملاء"))
            val root = json(response)
            val stores = buildList {
                val array = root.optJSONArray("stores") ?: JSONArray()
                for (i in 0 until array.length()) {
                    val item = array.optJSONObject(i) ?: continue
                    add(CsStoreUi(item.optString("id"), item.optString("name"), item.optString("code"), item.optString("role")))
                }
            }
            val labels = buildMap {
                val obj = root.optJSONObject("stateLabels") ?: JSONObject()
                val keys = obj.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    put(key, obj.optString(key))
                }
            }
            val orders = buildList {
                val array = root.optJSONArray("orders") ?: JSONArray()
                for (i in 0 until array.length()) array.optJSONObject(i)?.let { add(parseOrder(it)) }
            }
            CustomerServiceBoardResult(
                ok = true,
                message = "تم تحميل خدمة العملاء",
                clientId = root.optString("clientId").ifBlank { clientId },
                role = root.optString("role"),
                stores = stores,
                selectedStoreId = root.optString("selectedStoreId"),
                orders = orders,
                stateLabels = labels
            )
        }.getOrElse { CustomerServiceBoardResult(false, "تعذر الاتصال بخدمة العملاء") }
    }

    fun fetchHistory(context: Context, orderId: String): CustomerServiceJsonResult = withClient(context) { cookie, clientId ->
        val response = request("GET", "/api/customer-service/orders/${enc(orderId)}/history?clientId=${enc(clientId)}", cookie)
        if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر تحميل سجل الأوردر")
        CustomerServiceJsonResult(true, "تم تحميل السجل", json(response))
    }

    fun updateState(context: Context, orderId: String, state: String, deferUntil: String = "", stockBatchId: String = ""): CustomerServiceJsonResult =
        withClient(context) { cookie, clientId ->
            val payload = JSONObject().put("clientId", clientId).put("state", state)
            if (deferUntil.isNotBlank()) payload.put("deferUntil", deferUntil)
            if (stockBatchId.isNotBlank()) payload.put("stockBatchId", stockBatchId)
            val response = request("PATCH", "/api/customer-service/orders/${enc(orderId)}/state?clientId=${enc(clientId)}", cookie, payload)
            if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر تغيير حالة الأوردر")
            CustomerServiceJsonResult(true, "تم تحديث حالة الأوردر", json(response))
        }

    fun addNote(context: Context, orderId: String, note: String): CustomerServiceJsonResult = withClient(context) { cookie, clientId ->
        val payload = JSONObject().put("clientId", clientId).put("note", note)
        val response = request("POST", "/api/customer-service/orders/${enc(orderId)}/notes?clientId=${enc(clientId)}", cookie, payload)
        if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر إضافة الملاحظة")
        CustomerServiceJsonResult(true, "تمت إضافة الملاحظة", json(response))
    }

    fun logContact(context: Context, orderId: String, channel: String = "phone", intent: String = "contact"): CustomerServiceJsonResult =
        withClient(context) { cookie, clientId ->
            val payload = JSONObject().put("clientId", clientId).put("channel", channel).put("intent", intent)
            val response = request("POST", "/api/customer-service/orders/${enc(orderId)}/contact?clientId=${enc(clientId)}", cookie, payload)
            if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر تسجيل التواصل")
            CustomerServiceJsonResult(true, "تم تسجيل التواصل", json(response))
        }

    fun saveAwb(context: Context, orderId: String, awb: String): CustomerServiceJsonResult = withClient(context) { cookie, clientId ->
        val payload = JSONObject().put("clientId", clientId).put("awb", awb)
        val response = request("PATCH", "/api/customer-service/orders/${enc(orderId)}/awb?clientId=${enc(clientId)}", cookie, payload)
        if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر حفظ رقم البوليصة")
        CustomerServiceJsonResult(true, "تم حفظ رقم البوليصة", json(response))
    }

    fun logWhatsapp(context: Context, orderId: String, template: String = "other"): CustomerServiceJsonResult = withClient(context) { cookie, clientId ->
        val payload = JSONObject().put("clientId", clientId).put("template", template)
        val response = request("POST", "/api/customer-service/orders/${enc(orderId)}/whatsapp-log?clientId=${enc(clientId)}", cookie, payload)
        if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر تسجيل واتساب")
        CustomerServiceJsonResult(true, "تم تسجيل واتساب", json(response))
    }

    fun deleteOrder(context: Context, orderId: String): CustomerServiceJsonResult = withClient(context) { cookie, clientId ->
        val response = request("DELETE", "/api/customer-service/orders/${enc(orderId)}/delete?clientId=${enc(clientId)}", cookie)
        if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر حذف الأوردر")
        CustomerServiceJsonResult(true, "تم حذف الأوردر", json(response))
    }

    fun fetchEditorData(context: Context, orderId: String): CustomerServiceEditorData {
        val cookie = cookie(context) ?: return CustomerServiceEditorData(false, "سجّل الدخول أولاً")
        return runCatching {
            val clientId = resolveClientId(cookie)
            if (clientId.isBlank()) return CustomerServiceEditorData(false, "تعذر تحديد حساب المتجر")
            val detailsResponse = request("GET", "/api/orders/${enc(orderId)}/details?clientId=${enc(clientId)}", cookie)
            if (detailsResponse.code !in 200..299) return CustomerServiceEditorData(false, errorMessage(detailsResponse, "تعذر تحميل تفاصيل الأوردر"))
            val historyResponse = request("GET", "/api/customer-service/orders/${enc(orderId)}/history?clientId=${enc(clientId)}", cookie)
            val historyOrder = if (historyResponse.code in 200..299) json(historyResponse).optJSONObject("order") ?: JSONObject() else JSONObject()
            val details = json(detailsResponse)
            val storeId = details.optJSONObject("order")?.optString("storeId").orEmpty()
            val catalogPath = buildString {
                append("/api/catalog/products?clientId=${enc(clientId)}")
                if (storeId.isNotBlank()) append("&storeId=${enc(storeId)}")
            }
            val catalogResponse = request("GET", catalogPath, cookie)
            val catalog = if (catalogResponse.code in 200..299) json(catalogResponse).optJSONArray("products") ?: JSONArray() else JSONArray()
            CustomerServiceEditorData(true, "تم تحميل بيانات التعديل", clientId, details, catalog, historyOrder)
        }.getOrElse { CustomerServiceEditorData(false, "تعذر تحميل بيانات التعديل") }
    }

    fun editOrder(context: Context, orderId: String, payload: JSONObject): CustomerServiceJsonResult = withClient(context) { cookie, clientId ->
        payload.put("clientId", clientId)
        val response = request("PATCH", "/api/customer-service/orders/${enc(orderId)}/edit?clientId=${enc(clientId)}", cookie, payload)
        if (response.code !in 200..299) return@withClient authFailure(context, response, "تعذر حفظ تعديلات الأوردر")
        CustomerServiceJsonResult(true, "تم تعديل الأوردر", json(response))
    }

    private inline fun withClient(context: Context, block: (String, String) -> CustomerServiceJsonResult): CustomerServiceJsonResult {
        val cookie = cookie(context) ?: return CustomerServiceJsonResult(false, "سجّل الدخول أولاً")
        return runCatching {
            val clientId = resolveClientId(cookie)
            if (clientId.isBlank()) return CustomerServiceJsonResult(false, "تعذر تحديد حساب المتجر")
            block(cookie, clientId)
        }.getOrElse { CustomerServiceJsonResult(false, "تعذر الاتصال بكن أونلاين") }
    }

    private fun parseOrder(o: JSONObject): CsOrderUi = CsOrderUi(
        id = o.optString("id"),
        clientId = o.optString("clientId"),
        storeId = o.optString("storeId"),
        storeName = o.optString("storeName"),
        ref = o.optString("ref").ifBlank { o.optString("id") },
        date = o.optString("date"),
        createdAt = o.optString("createdAt"),
        name = o.optString("name"),
        phone = o.optString("phone"),
        gov = o.optString("gov"),
        address = o.optString("address"),
        product = o.optString("product"),
        productId = o.optString("productId"),
        variantId = o.optString("variantId"),
        productNote = o.optString("productNote"),
        qty = o.optInt("qty", 1).coerceAtLeast(1),
        unitPrice = o.optDouble("unitPrice", 0.0),
        total = o.optDouble("total", 0.0),
        source = o.optString("source"),
        customerNote = o.optString("customerNote"),
        awb = o.optString("awb"),
        state = o.optString("state").ifBlank { "pending" },
        checkpoint = o.optString("checkpoint"),
        deferUntil = o.optString("deferUntil"),
        stockBatchId = o.optString("stockBatchId"),
        stockBatchName = o.optString("stockBatchName"),
        stockAllocationStatus = o.optString("stockAllocationStatus"),
        contactCount = o.optInt("contactCount", o.optJSONArray("contactLog")?.length() ?: 0),
        latestInternalNote = o.optString("latestInternalNote"),
        returnedFromDeferredToday = o.optBoolean("returnedFromDeferredToday", false),
        history = o.optJSONArray("history") ?: JSONArray(),
        contactLog = o.optJSONArray("contactLog") ?: JSONArray(),
        raw = o
    )
}
