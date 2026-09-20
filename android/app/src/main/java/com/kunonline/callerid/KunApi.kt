package com.kunonline.callerid

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class SyncResult(val ok: Boolean, val message: String, val customerCount: Int = 0)
data class StateResult(val ok: Boolean, val message: String, val snapshot: CommerceSnapshot? = null)
data class ActionResult(val ok: Boolean, val message: String)
data class ScopeInfo(val clientId: String = "", val storeId: String = "")

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
            setRequestProperty("X-Kun-Mobile", "native-android/2.1")
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
                val message = errorMessage(login)
                return SyncResult(false, message.ifBlank { "تعذر تسجيل الدخول" })
            }
            val cookie = login.setCookie
            if (cookie.isNullOrBlank()) return SyncResult(false, "تم الدخول لكن لم تصل جلسة صالحة")
            SecureStore.put(context, AUTH_PREFS, SESSION_KEY, cookie)
            syncWithCookie(context, cookie)
        }.getOrElse { SyncResult(false, "تعذر الاتصال بكن أونلاين") }
    }

    fun repairPasswordWithStoredAdminSession(context: Context, email: String, newPassword: String): SyncResult {
        if (email.isBlank()) return SyncResult(false, "اكتب إيميل الحساب")
        if (newPassword.length < 8) return SyncResult(false, "كلمة المرور الجديدة لازم تكون 8 حروف على الأقل")
        val cookie = session(context)
            ?: return SyncResult(false, "لا توجد جلسة حالية صالحة للإصلاح")
        return runCatching {
            val usersResponse = request("GET", "/api/users", cookie = cookie)
            if (usersResponse.code == 401) return SyncResult(false, "الجلسة الحالية انتهت — لا تسجل خروج قبل إعادة الدخول من الإدارة")
            if (usersResponse.code == 403) return SyncResult(false, "الجلسة الحالية ليست بصلاحية مدير، لذلك لا يمكن إصلاح الباسورد منها")
            if (usersResponse.code !in 200..299) {
                return SyncResult(false, errorMessage(usersResponse).ifBlank { "تعذر قراءة حسابات النظام" })
            }

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
            if (reset.code !in 200..299) {
                return SyncResult(false, errorMessage(reset).ifBlank { "تعذر إعادة تعيين كلمة المرور" })
            }

            val verified = loginAndSync(context, email, newPassword)
            if (!verified.ok) {
                return SyncResult(false, "تم تغيير كلمة المرور لكن تعذر تأكيد تسجيل الدخول: ${verified.message}")
            }
            SyncResult(true, "تم إصلاح كلمة المرور وتأكيد تسجيل الدخول", verified.customerCount)
        }.getOrElse { SyncResult(false, "تعذر إصلاح كلمة المرور من الجلسة الحالية") }
    }

    fun syncWithStoredSession(context: Context): SyncResult {
        val cookie = session(context) ?: return SyncResult(false, "سجّل الدخول أولاً")
        return syncWithCookie(context, cookie)
    }

    fun fetchState(context: Context): StateResult {
        val cookie = session(context) ?: return StateResult(false, "سجّل الدخول أولاً")
        return fetchStateWithCookie(context, cookie)
    }

    fun createOrder(context: Context, values: JSONObject): ActionResult =
        scopedWrite(context, "/api/orders", values, "تم تسجيل الأوردر")

    fun createCustomer(context: Context, values: JSONObject): ActionResult =
        scopedWrite(context, "/api/customers", values, "تمت إضافة العميل")

    fun createProduct(context: Context, values: JSONObject): ActionResult =
        scopedWrite(context, "/api/products", values, "تمت إضافة المنتج")

    fun adjustStock(context: Context, productId: String, delta: Double, note: String): ActionResult {
        val cookie = session(context) ?: return ActionResult(false, "سجّل الدخول أولاً")
        if (productId.isBlank() || delta == 0.0) return ActionResult(false, "اختر المنتج واكتب كمية غير صفرية")
        return runCatching {
            val payload = JSONObject().put("delta", delta).put("note", note).toString()
            val response = request("POST", "/api/products/${enc(productId)}/stock/add", payload, cookie)
            if (response.code == 401) {
                clearSession(context)
                return ActionResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
            }
            if (response.code !in 200..299) {
                return ActionResult(false, errorMessage(response).ifBlank { "تعذر تحديث المخزون" })
            }
            ActionResult(true, "تم تحديث المخزون")
        }.getOrElse { ActionResult(false, "تعذر الاتصال بكن أونلاين") }
    }

    fun hasSession(context: Context): Boolean = session(context) != null

    fun sessionCookie(context: Context): String? = session(context)

    fun logout(context: Context) {
        clearSession(context)
        CustomerCache.clear(context)
    }

    private fun scopedWrite(context: Context, path: String, values: JSONObject, success: String): ActionResult {
        val cookie = session(context) ?: return ActionResult(false, "سجّل الدخول أولاً")
        return runCatching {
            val scope = resolveScope(cookie)
            if (scope.clientId.isNotBlank() && !values.has("clientId")) values.put("clientId", scope.clientId)
            if (scope.storeId.isNotBlank() && !values.has("storeId")) values.put("storeId", scope.storeId)
            val response = request("POST", path, values.toString(), cookie)
            if (response.code == 401) {
                clearSession(context)
                return ActionResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
            }
            if (response.code !in 200..299) {
                return ActionResult(false, errorMessage(response).ifBlank { "تعذر تنفيذ العملية" })
            }
            ActionResult(true, success)
        }.getOrElse { ActionResult(false, "تعذر الاتصال بكن أونلاين") }
    }

    private fun syncWithCookie(context: Context, cookie: String): SyncResult {
        val result = fetchStateWithCookie(context, cookie)
        return if (result.ok) {
            SyncResult(true, "تمت المزامنة", result.snapshot?.customers?.size ?: CustomerCache.count(context))
        } else {
            SyncResult(false, result.message)
        }
    }

    private fun fetchStateWithCookie(context: Context, cookie: String): StateResult {
        return runCatching {
            val scope = resolveScope(cookie)
            val query = buildList {
                if (scope.clientId.isNotBlank()) add("clientId=${enc(scope.clientId)}")
                if (scope.storeId.isNotBlank()) add("storeId=${enc(scope.storeId)}")
            }.joinToString("&")
            val path = if (query.isBlank()) "/api/state" else "/api/state?$query"
            val response = request("GET", path, cookie = cookie)
            if (response.code == 401) {
                clearSession(context)
                return StateResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
            }
            if (response.code !in 200..299) {
                return StateResult(false, errorMessage(response).ifBlank { "تعذر تحميل بيانات النظام" })
            }
            val root = JSONObject(response.body)
            val orders = root.optJSONArray("orders") ?: JSONArray()
            CustomerCache.replaceAll(context, orders)
            StateResult(true, "تم تحديث البيانات", CommerceParser.parse(root))
        }.getOrElse { StateResult(false, "تعذر قراءة بيانات النظام") }
    }

    private fun resolveScope(cookie: String): ScopeInfo {
        var clientId = ""
        var storeId = ""

        val me = request("GET", "/api/me", cookie = cookie)
        if (me.code in 200..299) {
            val data = runCatching { JSONObject(me.body) }.getOrNull()
            clientId = data?.optString("clientId").orEmpty()
                .ifBlank { data?.optString("client_id").orEmpty() }
        }

        if (clientId.isBlank()) {
            val context = request("GET", "/api/my-client-context", cookie = cookie)
            if (context.code in 200..299) {
                val clients = runCatching { JSONObject(context.body).optJSONArray("clients") }.getOrNull()
                clientId = clients?.optJSONObject(0)?.optString("id").orEmpty()
            }
        }

        if (clientId.isBlank()) {
            val state = request("GET", "/api/state", cookie = cookie)
            if (state.code in 200..299) {
                val root = runCatching { JSONObject(state.body) }.getOrNull()
                clientId = root?.optJSONArray("clients")?.optJSONObject(0)?.optString("id").orEmpty()
                    .ifBlank {
                        root?.optJSONArray("businessClients")?.optJSONObject(0)?.optString("id").orEmpty()
                    }
                    .ifBlank {
                        val order = root?.optJSONArray("orders")?.optJSONObject(0)
                        order?.optString("clientId").orEmpty()
                            .ifBlank { order?.optString("client_id").orEmpty() }
                    }
            }
        }

        if (clientId.isNotBlank()) {
            val stores = request("GET", "/api/my-store-context?clientId=${enc(clientId)}", cookie = cookie)
            if (stores.code in 200..299) {
                val root = runCatching { JSONObject(stores.body) }.getOrNull()
                val allStores = root?.optBoolean("allStores", true) ?: true
                if (!allStores) {
                    storeId = root?.optJSONArray("stores")?.optJSONObject(0)?.optString("id").orEmpty()
                }
            }
        }
        return ScopeInfo(clientId, storeId)
    }

    private fun session(context: Context): String? = SecureStore.get(context, AUTH_PREFS, SESSION_KEY)
    private fun clearSession(context: Context) = SecureStore.put(context, AUTH_PREFS, SESSION_KEY, null)
    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun errorMessage(result: HttpResult): String {
        return runCatching {
            val root = JSONObject(result.body)
            root.optString("error").ifBlank { root.optString("message") }
        }.getOrDefault("")
    }
}
