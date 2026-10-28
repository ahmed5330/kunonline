package com.kunonline.callerid

import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class SyncResult(val ok: Boolean, val message: String, val customerCount: Int = 0)
data class StateResult(val ok: Boolean, val message: String, val snapshot: CommerceSnapshot? = null, val changed: Boolean = true)
data class ActionResult(val ok: Boolean, val message: String)
data class ScopeInfo(val clientId: String = "", val storeId: String = "")
data class MobileStoreOption(
    val clientId: String,
    val clientName: String,
    val storeId: String,
    val storeName: String,
    val role: String
)
data class StoreOptionsResult(
    val ok: Boolean,
    val message: String,
    val stores: List<MobileStoreOption> = emptyList(),
    val current: ScopeInfo = ScopeInfo()
)

object KunApi {
    private const val BASE_URL = "https://app.kun-online.com"
    private const val AUTH_PREFS = "kun_auth"
    private const val SESSION_KEY = "session_cookie"
    private const val SELECTED_STORE_KEY = "selected_store"

    // Platform staff accounts legitimately have clientId=null in /api/me.
    // Android org.json optString can stringify JSONObject.NULL as "null",
    // which used to filter out every authorized multi-tenant store.
    internal fun clientIdFromIdentity(identity: JSONObject): String {
        for (key in arrayOf("clientId", "client_id", "id")) {
            if (identity.isNull(key)) continue
            val id = identity.optString(key, "").trim()
            if (id.isNotBlank() && !id.equals("null", ignoreCase = true)) return id
        }
        return ""
    }
    private var scopeCookie = ""
    private var cachedScope: ScopeInfo? = null
    private var scopeExpiresAt = 0L
    // Reuse the parsed Compose snapshot when the authenticated delta is unchanged.
    // Keys include the signed-in session, store scope and UI date-filter revision.
    private var parsedKey = ""
    private var parsedRevision = -1
    private var parsedSnapshot: CommerceSnapshot? = null
    // In-memory store assignment verification. The backend still authorizes
    // every data read, so cached options never confer access on their own.
    private var verifiedOptionsCookie = ""
    private var verifiedOptionsUntil = 0L
    private var verifiedOptions: List<MobileStoreOption> = emptyList()
    private var verifiedOptionsCurrent = ScopeInfo()

    @Synchronized private fun clearScope() {
        parsedKey = ""
        parsedRevision = -1
        parsedSnapshot = null
        scopeCookie = ""
        cachedScope = null
        scopeExpiresAt = 0L
    }


    private data class HttpResult(val code: Int, val body: String, val setCookie: String?)

    private fun request(method: String, path: String, body: String? = null, cookie: String? = null): HttpResult {
        val connection = (URL(BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10000
            readTimeout = 15000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-Kun-Mobile", "native-android/${BuildConfig.VERSION_NAME}")
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
            if (cookie.isNullOrBlank() || !cookie.startsWith("ko_session=")) {
                return SyncResult(false, "تم قبول بيانات الحساب لكن لم تصل جلسة دخول صالحة")
            }
            // A successful login response alone is not proof of a usable session.
            // The same endpoint and cookie must work for /api/me before we persist it.
            val identity = request("GET", "/api/me", cookie = cookie)
            val role = runCatching { JSONObject(identity.body).optString("role") }.getOrDefault("")
            if (identity.code !in 200..299 || role.isBlank() || role == "null") {
                return SyncResult(false, errorMessage(identity).ifBlank { "تعذر تأكيد جلسة الدخول" })
            }
            // Never reuse the previous account's order/caller-ID cache when an
            // authenticated account switches and initial sync cannot complete.
            clearScope()
            MobileSyncClient.clear()
            CustomerCache.clear(context)
            SecureStore.put(context, AUTH_PREFS, SELECTED_STORE_KEY, null)
            SecureStore.put(context, AUTH_PREFS, SESSION_KEY, cookie)
            val sync = syncWithCookie(context, cookie)
            // A new or empty store may not be ready for its initial data sync.
            // Keep a verified session instead of misreporting valid credentials as bad.
            when {
                sync.ok -> sync
                session(context) != cookie -> SyncResult(false, sync.message)
                else -> SyncResult(
                    true,
                    "تم تسجيل الدخول بنجاح، لكن تعذر تحديث البيانات مؤقتًا. جرّب زر التحديث بعد الدخول.",
                    CustomerCache.count(context)
                )
            }
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

    /**
     * Prefer a small authenticated live caller lookup during the screening callback.
     * The normal order-list cache can be empty or limited to a selected store.
     * Only server-authorized stores are searchable.
     */
    fun lookupCallerLive(context: Context, number: String): CallerCustomer? {
        val cookie = session(context) ?: return null
        val normalized = PhoneNormalizer.normalize(number)
        if (normalized.isBlank()) return null
        return runCatching {
            val scope = resolveScope(cookie, context)
            if (scope.clientId.isNotBlank()) {
                // Fast tenant lookup first, including customer notes and full address.
                val path = "/api/mobile/caller-lookup?clientId=${enc(scope.clientId)}&phone=${enc(normalized)}"
                val res = runCatching { request("GET", path, cookie = cookie) }.getOrNull()
                if (res != null && res.code in 200..299) {
                    val data = JSONObject(res.body)
                    if (data.optBoolean("found", false) && session(context) == cookie) {
                        val storeId = data.optString("storeId").ifBlank { scope.storeId }
                        return CallerCustomer(
                            name = data.optString("name"),
                            phone = PhoneNormalizer.normalize(data.optString("phone").ifBlank { normalized }),
                            orderId = data.optString("orderId").takeIf { it.isNotBlank() },
                            orderRef = data.optString("orderRef").takeIf { it.isNotBlank() },
                            status = data.optString("status").takeIf { it.isNotBlank() },
                            product = data.optString("product").takeIf { it.isNotBlank() },
                            total = data.optDouble("orderTotal", 0.0).takeIf { it > 0 },
                            gov = data.optString("gov").takeIf { it.isNotBlank() },
                            address = data.optString("address").takeIf { it.isNotBlank() },
                            note = data.optString("note").takeIf { it.isNotBlank() },
                            previousOrders = (data.optInt("totalOrders", 0) - 1).coerceAtLeast(0),
                            clientId = scope.clientId,
                            storeId = storeId,
                            storeName = cachedStoreOptions(context)?.stores?.firstOrNull {
                                it.clientId == scope.clientId && it.storeId == storeId
                            }?.storeName.orEmpty()
                        )
                    }
                }
            }
            // A colleague may serve several authorized stores in different tenants.
            // The global search endpoint enforces per-user store access on the server.
            // Never use a substring-only phone match to identify a caller.
            val result = request("GET", "/api/mobile/orders/search?q=${enc(normalized)}&limit=25", cookie = cookie)
            if (result.code !in 200..299 || session(context) != cookie) return null
            val rows = JSONObject(result.body).optJSONArray("orders") ?: return null
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                if (PhoneNormalizer.normalize(row.optString("phone")) != normalized) continue
                val clientId = row.optString("clientId")
                val storeId = row.optString("storeId")
                val orderId = row.optString("id")
                if (clientId.isBlank() || storeId.isBlank() || orderId.isBlank()) continue
                return CallerCustomer(
                    name = row.optString("name"), phone = normalized,
                    orderId = orderId,
                    orderRef = row.optString("ref").ifBlank { orderId },
                    status = row.optString("state"),
                    product = row.optString("product"),
                    total = row.optDouble("total", 0.0).takeIf { it > 0 },
                    gov = row.optString("gov"), address = null, note = null, previousOrders = 0,
                    clientId = clientId, storeId = storeId, storeName = row.optString("storeName")
                )
            }
            null
        }.getOrNull()
    }

    fun syncWithStoredSession(context: Context): SyncResult {
        val cookie = session(context) ?: return SyncResult(false, "سجّل الدخول أولاً")
        return syncWithCookie(context, cookie)
    }

    /** Last successfully parsed state for instant home re-entry; session and date scoped. */
    fun cachedSnapshot(context: Context): CommerceSnapshot? {
        val cookie = session(context) ?: return null
        return if (parsedKey.startsWith(cookie + "|") && parsedRevision == MobileDateFilterState.revision)
            parsedSnapshot else null
    }

    fun fetchState(context: Context, forceFull: Boolean = false): StateResult {
        val cookie = session(context) ?: return StateResult(false, "سجّل الدخول أولاً")
        return fetchStateWithCookie(context, cookie, forceFull)
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

    /** Returns a verified two-minute assignment without any network calls. */
    fun cachedStoreOptions(context: Context): StoreOptionsResult? {
        val cookie = session(context) ?: return null
        if (verifiedOptionsCookie != cookie || SystemClock.elapsedRealtime() >= verifiedOptionsUntil) return null
        val selected = SecureStore.get(context, AUTH_PREFS, SELECTED_STORE_KEY)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
        val saved = verifiedOptions.firstOrNull {
            it.clientId == selected?.optString("clientId") && it.storeId == selected?.optString("storeId")
        }
        val current = saved?.let { ScopeInfo(it.clientId, it.storeId) } ?: verifiedOptionsCurrent
        return StoreOptionsResult(true, "", verifiedOptions, current)
    }

    /** One fast authenticated API read instead of one HTTP roundtrip per client. */
    fun loadStoreOptions(context: Context, forceRefresh: Boolean = false): StoreOptionsResult {
        val cookie = session(context) ?: return StoreOptionsResult(false, "سجّل الدخول أولاً")
        if (!forceRefresh) cachedStoreOptions(context)?.let { return it }
        val fast = runCatching { request("GET", "/api/mobile/store-options", cookie = cookie) }.getOrNull()
            ?: return StoreOptionsResult(false, "تعذر الاتصال بالمتاجر — اعرض البيانات السابقة وحاول التحديث")
        if (fast.code == 404 || fast.code == 405) return loadStoreOptionsLegacy(context)
        if (fast.code !in 200..299) {
            if (fast.code == 401 && session(context) == cookie) clearSession(context)
            return StoreOptionsResult(false, errorMessage(fast).ifBlank { "تعذر تحميل المتاجر المسموح بها" })
        }
        return runCatching {
            val root = JSONObject(fast.body)
            val arr = root.optJSONArray("stores") ?: JSONArray()
            val stores = buildList {
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val client = item.optString("clientId").trim()
                    val store = item.optString("storeId").trim()
                    if (client.isEmpty() || store.isEmpty()) continue
                    add(MobileStoreOption(client, item.optString("clientName").ifBlank { client }, store,
                        item.optString("storeName").ifBlank { "متجر بدون اسم" }, item.optString("role").ifBlank { "member" }))
                }
            }.distinctBy { it.clientId + ":" + it.storeId }
            if (session(context) != cookie) return StoreOptionsResult(false, "تغيّرت جلسة الحساب")
            val selected = SecureStore.get(context, AUTH_PREFS, SELECTED_STORE_KEY)
                ?.let { runCatching { JSONObject(it) }.getOrNull() }
            val selectedStore = stores.firstOrNull {
                it.clientId == selected?.optString("clientId") && it.storeId == selected?.optString("storeId")
            }
            val owner = root.optString("role") in setOf("admin", "client")
            val active = when {
                selectedStore != null -> ScopeInfo(selectedStore.clientId, selectedStore.storeId)
                owner -> ScopeInfo(root.optString("defaultClientId"), "")
                else -> stores.firstOrNull()?.let { ScopeInfo(it.clientId, it.storeId) } ?: ScopeInfo()
            }
            // The store picker and /api/state must use the same verified scope.
            // Previously the home screen could display a selected store while the
            // first successful state request still belonged to another client/store.
            if (selectedStore == null && (active.storeId.isNotBlank() || selected != null)) {
                if (active.clientId.isNotBlank() && active.storeId.isNotBlank()) {
                    SecureStore.put(context, AUTH_PREFS, SELECTED_STORE_KEY,
                        JSONObject().put("clientId", active.clientId).put("storeId", active.storeId).toString())
                } else if (selected != null) {
                    SecureStore.put(context, AUTH_PREFS, SELECTED_STORE_KEY, null)
                }
                clearScope()
                MobileSyncClient.clear()
                CustomerCache.clear(context)
            }
            verifiedOptionsCookie = cookie
            verifiedOptions = stores
            verifiedOptionsUntil = SystemClock.elapsedRealtime() + 120_000L
            verifiedOptionsCurrent = active
            StoreOptionsResult(true, if (stores.isEmpty()) "لا توجد متاجر نشطة مخصصة لهذا الحساب" else "", stores, active)
        }.getOrElse { StoreOptionsResult(false, "تعذر قراءة قائمة المتاجر") }
    }
    /** Backwards-compatible discovery for older servers only. */
    private fun loadStoreOptionsLegacy(context: Context): StoreOptionsResult {
        val cookie = session(context) ?: return StoreOptionsResult(false, "سجّل الدخول أولاً")
        return runCatching {
            val me = request("GET", "/api/me", cookie = cookie)
            if (me.code !in 200..299) return StoreOptionsResult(false, errorMessage(me).ifBlank { "تعذر التحقق من الجلسة" })
            val identity = JSONObject(me.body)
            val userClientId = identity.optString("clientId").takeUnless { it.equals("null", true) }.orEmpty()
            val accessible = request("GET", "/api/my-client-context", cookie = cookie)
            if (accessible.code !in 200..299) {
                return StoreOptionsResult(false, errorMessage(accessible).ifBlank { "تعذر تحميل المتاجر المسموح بها" })
            }
            val clients = JSONObject(accessible.body).optJSONArray("clients") ?: JSONArray()
            val options = mutableListOf<MobileStoreOption>()
            for (index in 0 until clients.length()) {
                val client = clients.optJSONObject(index) ?: continue
                val clientId = clientIdFromIdentity(client)
                if (clientId.isBlank() || (identity.optString("role") in setOf("admin", "client") && userClientId.isNotBlank() && clientId != userClientId)) continue
                val clientName = client.optString("name").ifBlank { clientId }
                val result = request("GET", "/api/my-store-context?clientId=${enc(clientId)}", cookie = cookie)
                if (result.code !in 200..299) continue
                val stores = runCatching { JSONObject(result.body).optJSONArray("stores") }.getOrNull() ?: continue
                for (i in 0 until stores.length()) {
                    val store = stores.optJSONObject(i) ?: continue
                    val storeId = store.optString("id").trim()
                    if (storeId.isBlank()) continue
                    options.add(
                        MobileStoreOption(
                            clientId = clientId,
                            clientName = clientName,
                            storeId = storeId,
                            storeName = store.optString("name").ifBlank { "متجر بدون اسم" },
                            role = store.optString("role").ifBlank { "member" }
                        )
                    )
                }
            }
            if (session(context) != cookie) return StoreOptionsResult(false, "تغيّرت جلسة الحساب")
            val current = resolveScope(cookie, context)
            val authorized = options.distinctBy { "${it.clientId}:${it.storeId}" }
            verifiedOptionsCookie = cookie
            verifiedOptions = authorized
            verifiedOptionsUntil = SystemClock.elapsedRealtime() + 120_000L
            verifiedOptionsCurrent = current
            StoreOptionsResult(
                ok = true,
                message = if (authorized.isEmpty()) "لا توجد متاجر نشطة مخصصة لهذا الحساب" else "",
                stores = authorized,
                current = current
            )
        }.getOrElse { StoreOptionsResult(false, "تعذر تحميل قائمة المتاجر — تأكد من الاتصال") }
    }

    /** Reuse a recent server-verified assignment for quick switches; requests
     *  are independently authorized against live server access rules. */
    @Synchronized fun selectStore(context: Context, choice: MobileStoreOption): ActionResult {
        val cookie = session(context) ?: return ActionResult(false, "انتهت الجلسة")
        val fresh = verifiedOptionsCookie == cookie &&
            SystemClock.elapsedRealtime() < verifiedOptionsUntil
        val serverOptions = if (fresh) verifiedOptions else {
            val verified = loadStoreOptions(context)
            if (!verified.ok) return ActionResult(false, verified.message)
            verified.stores
        }
        val option = serverOptions.find { it.clientId == choice.clientId && it.storeId == choice.storeId }
            ?: return ActionResult(false, "ليس لديك صلاحية الوصول لهذا المتجر")
        val current = resolveScope(cookie, context)
        if (current.clientId == option.clientId && current.storeId == option.storeId) {
            return ActionResult(true, "المتجر محدد بالفعل")
        }
        val value = JSONObject().put("clientId", option.clientId).put("storeId", option.storeId).toString()
        SecureStore.put(context, AUTH_PREFS, SELECTED_STORE_KEY, value)
        verifiedOptionsCurrent = ScopeInfo(option.clientId, option.storeId)
        clearScope()
        MobileSyncClient.clear()
        CustomerCache.clear(context)
        CallActivityStore.clear(context)
        return ActionResult(true, "تم اختيار ${option.storeName}")
    }

    fun hasSession(context: Context): Boolean = session(context) != null

    fun userDisplayName(context: Context): String {
        return runCatching {
            val response = request("GET", "/api/me", cookie = session(context))
            if (response.code !in 200..299) return@runCatching ""
            val identity = JSONObject(response.body)
            identity.optString("name", "").trim().takeUnless { it == "null" }.orEmpty()
        }.getOrDefault("")
    }

    fun sessionCookie(context: Context): String? = session(context)

    fun logout(context: Context) {
        OrderNotifications.clearForLogout(context)
        SyncJobService.cancel(context)
        clearSession(context)
        CustomerCache.clear(context)
    }

    private fun scopedWrite(context: Context, path: String, values: JSONObject, success: String): ActionResult {
        val cookie = session(context) ?: return ActionResult(false, "سجّل الدخول أولاً")
        return runCatching {
            val scope = resolveScope(cookie, context)
            // The active store is authoritative; stale form defaults must not
            // silently send newly-created records to another selected store.
            if (scope.clientId.isNotBlank()) values.put("clientId", scope.clientId)
            if (scope.storeId.isNotBlank()) values.put("storeId", scope.storeId)
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

    @Synchronized private fun fetchStateWithCookie(context: Context, cookie: String, forceFull: Boolean = false): StateResult {
        return runCatching {
            if (forceFull) clearScope()
            val scope = resolveScope(cookie, context)
            val query = buildList {
                if (scope.clientId.isNotBlank()) add("clientId=${enc(scope.clientId)}")
                if (scope.storeId.isNotBlank()) add("storeId=${enc(scope.storeId)}")
            }.joinToString("&")
            val path = if (query.isBlank()) "/api/state" else "/api/state?$query"
            val response = MobileSyncClient.fetch(cookie, path, forceFull)
            if (response.code == 401) {
                if (session(context) == cookie) clearSession(context)
                return StateResult(false, "انتهت الجلسة — سجّل الدخول مرة أخرى")
            }
            if (response.code == 403 || response.code == 400) clearScope()
            if (response.code == 403 && session(context) == cookie) CustomerCache.clear(context)
            if (response.code !in 200..299) {
                return StateResult(false, response.body.optString("error").ifBlank { "تعذر تحميل بيانات النظام" })
            }
            if (session(context) != cookie) return StateResult(false, "تغيّرت جلسة الحساب")
            val revision = MobileDateFilterState.revision
            val cacheKey = cookie + "|" + path
            if (!response.changed && parsedKey == cacheKey && parsedRevision == revision && parsedSnapshot != null) {
                return StateResult(true, "البيانات محدثة", parsedSnapshot, changed = false)
            }
            val root = response.body
            if (root.optJSONArray("orders") == null) {
                return StateResult(false, "رد المزامنة لا يحتوي قائمة الطلبات — احتفظنا بالبيانات السابقة، وأعد المحاولة")
            }
            val orders = root.optJSONArray("orders") ?: JSONArray()
            if (response.changed) CustomerCache.replaceAll(context, orders)
            val parsed = CommerceParser.parse(root)
            parsedSnapshot = parsed
            parsedKey = cacheKey
            parsedRevision = revision
            StateResult(true, "تم تحديث البيانات", parsed)
        }.getOrElse { StateResult(false, "تعذر قراءة بيانات النظام") }
    }

    /** A short-lived, server-verified store picker result avoids repeating /api/me,
     * /api/my-client-context and /api/my-store-context before each initial state read.
     * Every subsequent API request still enforces current server-side tenant/store ACL. */
    internal fun reusableVerifiedScope(
        cookie: String, verifiedCookie: String, now: Long, expiresAt: Long, candidate: ScopeInfo?
    ): ScopeInfo? =
        candidate?.takeIf { cookie == verifiedCookie && now < expiresAt && it.clientId.isNotBlank() && !it.clientId.equals("null", ignoreCase = true) }

    @Synchronized internal fun resolveScope(cookie: String, context: Context? = null): ScopeInfo {
        val cached = cachedScope
        val now = SystemClock.elapsedRealtime()
        if (scopeCookie == cookie && cached != null && now < scopeExpiresAt) return cached
        // Only reuse a valid server-verified assignment for the same session.
        // Store switches clear scope and update the verified selection.
        val verified = context?.let { cachedStoreOptions(it) }
        val fastScope = reusableVerifiedScope(
            cookie, verifiedOptionsCookie, now, verifiedOptionsUntil,
            verified?.takeIf { it.ok }?.current
        )
        if (fastScope != null) {
            scopeCookie = cookie
            cachedScope = fastScope
            scopeExpiresAt = verifiedOptionsUntil
            return fastScope
        }
        var clientId = ""
        var storeId = ""
        val saved = context?.let {
            SecureStore.get(it, AUTH_PREFS, SELECTED_STORE_KEY)
                ?.let { raw -> runCatching { JSONObject(raw) }.getOrNull() }
        }
        val preferredClient = saved?.optString("clientId").orEmpty()
        val preferredStore = saved?.optString("storeId").orEmpty()

        val me = request("GET", "/api/me", cookie = cookie)
        if (me.code in 200..299) {
            val data = runCatching { JSONObject(me.body) }.getOrNull()
            // /api/me.id is a USER id, never a client id for platform staff.
            clientId = data?.optString("clientId").orEmpty().takeUnless { it.equals("null", true) }.orEmpty()
                .ifBlank { data?.optString("client_id").orEmpty().takeUnless { it.equals("null", true) }.orEmpty() }
        }

        if (clientId.isBlank()) {
            val access = request("GET", "/api/my-client-context", cookie = cookie)
            if (access.code in 200..299) {
                val clients = runCatching { JSONObject(access.body).optJSONArray("clients") }.getOrNull()
                val ids = buildList {
                    if (clients != null) for (i in 0 until clients.length()) {
                        clients.optJSONObject(i)?.let(::clientIdFromIdentity)?.takeIf { it.isNotBlank() }?.let { add(it) }
                    }
                }
                clientId = if (preferredClient in ids) preferredClient else ids.firstOrNull().orEmpty()
            }
        }

        if (clientId.isBlank()) {
            val state = request("GET", "/api/state", cookie = cookie)
            if (state.code in 200..299) {
                val root = runCatching { JSONObject(state.body) }.getOrNull()
                clientId = root?.optJSONArray("clients")?.optJSONObject(0)?.let(::clientIdFromIdentity).orEmpty()
                    .ifBlank {
                        root?.optJSONArray("businessClients")?.optJSONObject(0)?.let(::clientIdFromIdentity).orEmpty()
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
                val choices = root?.optJSONArray("stores")
                val allowed = buildList {
                    if (choices != null) for (index in 0 until choices.length()) {
                        choices.optJSONObject(index)?.optString("id")?.takeIf { it.isNotBlank() }?.let { add(it) }
                    }
                }
                storeId = when {
                    preferredClient == clientId && preferredStore in allowed -> preferredStore
                    !allStores -> allowed.firstOrNull().orEmpty()
                    else -> ""
                }
            }
        }
        val scope = ScopeInfo(clientId, storeId)
        if (clientId.isNotBlank()) {
            scopeCookie = cookie
            cachedScope = scope
            scopeExpiresAt = SystemClock.elapsedRealtime() + 300_000L
        }
        return scope
    }

    private fun session(context: Context): String? = SecureStore.get(context, AUTH_PREFS, SESSION_KEY)
    private fun clearSession(context: Context) {
        // Derived caller data must not remain after session authentication ends.
        CustomerCache.clear(context)
        clearScope()
        verifiedOptionsCookie = ""
        verifiedOptionsUntil = 0L
        verifiedOptions = emptyList()
        verifiedOptionsCurrent = ScopeInfo()
        MobileSyncClient.clear()
        SecureStore.put(context, AUTH_PREFS, SELECTED_STORE_KEY, null)
        SecureStore.put(context, AUTH_PREFS, SESSION_KEY, null)
    }
    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun errorMessage(result: HttpResult): String {
        return runCatching {
            val root = JSONObject(result.body)
            root.optString("error").ifBlank { root.optString("message") }
        }.getOrDefault("")
    }
}
