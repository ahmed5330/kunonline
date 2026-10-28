package com.kunonline.callerid

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

internal data class GlobalOrderSearchItem(
    val id: String,
    val ref: String,
    val clientId: String,
    val storeId: String,
    val storeName: String,
    val name: String,
    val phone: String,
    val state: String,
    val total: String,
    val date: String,
    val awb: String,
    val gov: String,
    val product: String
)

// Present business-friendly Arabic states rather than backend values like "pending".
internal fun globalSearchCustomerStatus(state: String): String = when (state.trim().lowercase()) {
    "pending", "new" -> "في انتظار التأكيد"
    "contacting" -> "جاري التواصل"
    "no_answer" -> "العميل لا يرد"
    "confirmed" -> "تم التأكيد"
    "preparing" -> "التجهيز والتغليف"
    "shipping", "in_shipping", "shipped" -> "جاري الشحن"
    "signed" -> "تم التسليم — تحصيل منتظر"
    "collected" -> "تم التحصيل"
    "returned" -> "مرتجع"
    "cancelled", "canceled" -> "ملغي"
    "deferred" -> "مؤجل"
    else -> state.trim().takeIf { it.isNotBlank() } ?: "غير محددة"
}

internal fun globalSearchOrderDate(value: String): String = value.trim()
    .substringBefore('T').substringBefore(' ').takeIf { it.isNotBlank() } ?: "غير مسجل"

// Imported Easy Orders UUIDs stay searchable but no longer dominate the card.
internal fun globalSearchReadableRef(value: String): String = value.trim().takeIf {
    it.isNotBlank() && it.length <= 26 && !it.startsWith("easyorders:", ignoreCase = true)
} ?: ""

private data class GlobalSearchPage(
    val ok: Boolean,
    val items: List<GlobalOrderSearchItem> = emptyList(),
    val hasMore: Boolean = false,
    val nextOffset: Int = 0,
    val error: String = ""
)

private object GlobalOrderSearchApi {
    fun search(context: Context, query: String, offset: Int = 0): GlobalSearchPage {
        val cookie = KunApi.sessionCookie(context)
            ?: return GlobalSearchPage(false, error = "انتهت الجلسة — سجّل الدخول مرة أخرى")
        return runCatching {
            val path = "/api/mobile/orders/search?q=" +
                URLEncoder.encode(query, "UTF-8") + "&limit=25&offset=$offset"
            val conn = (URL("https://app.kun-online.com" + path).openConnection() as HttpURLConnection)
            try {
                conn.requestMethod = "GET"
                conn.connectTimeout = 7_000
                conn.readTimeout = 12_000
                conn.setRequestProperty("Accept", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.setRequestProperty("X-Kun-Mobile", "native-android/${BuildConfig.VERSION_NAME}")
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val data = JSONObject(stream?.bufferedReader()?.use { it.readText() }.orEmpty())
                if (KunApi.sessionCookie(context) != cookie)
                    return GlobalSearchPage(false, error = "تغيّرت جلسة الحساب")
                if (code !in 200..299)
                    return GlobalSearchPage(false, error = data.optString("error").ifBlank { "تعذر البحث عن الطلبات" })
                val rows = data.optJSONArray("orders") ?: JSONArray()
                val items = buildList {
                    for (index in 0 until rows.length()) {
                        val row = rows.optJSONObject(index) ?: continue
                        add(GlobalOrderSearchItem(
                            id = row.optString("id"),
                            ref = row.optString("ref").ifBlank { row.optString("id") },
                            clientId = row.optString("clientId"),
                            storeId = row.optString("storeId"),
                            storeName = row.optString("storeName").ifBlank { "المتجر" },
                            name = row.optString("name"),
                            phone = row.optString("phone"),
                            state = row.optString("state"),
                            total = row.optString("total"),
                            date = row.optString("date").ifBlank { row.optString("createdAt") },
                            awb = row.optString("awb"),
                            gov = row.optString("gov"),
                            product = row.optString("product")
                        ))
                    }
                }
                GlobalSearchPage(true, items, data.optBoolean("hasMore", false),
                    data.optInt("nextOffset", offset + items.size))
            } finally {
                conn.disconnect()
            }
        }.getOrElse { GlobalSearchPage(false, error = "تعذر الاتصال بالبحث، جرّب مرة أخرى") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalOrderSearchDialog(
    onDismiss: () -> Unit,
    onHome: () -> Unit,
    initialQuery: String = "",
    initialOrderId: String = "",
    initialClientId: String = "",
    initialStoreId: String = ""
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember(initialQuery) { mutableStateOf(initialQuery) }
    var items by remember { mutableStateOf<List<GlobalOrderSearchItem>>(emptyList()) }
    var busy by remember { mutableStateOf(initialOrderId.isNotBlank()) }
    var loadingMore by remember { mutableStateOf(false) }
    var hasMore by remember { mutableStateOf(false) }
    var offset by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<GlobalOrderSearchItem?>(null) }

    LaunchedEffect(query) {
        val q = query.trim()
        items = emptyList()
        hasMore = false
        offset = 0
        error = ""
        if (q.length < 2) { busy = false; return@LaunchedEffect }
        busy = true
        delay(350)
        val page = withContext(Dispatchers.IO) { GlobalOrderSearchApi.search(context, q) }
        busy = false
        if (page.ok) {
            items = page.items
            hasMore = page.hasMore
            offset = page.nextOffset
            if (initialOrderId.isNotBlank() && q == initialQuery.trim()) {
                selected = page.items.firstOrNull {
                    it.id == initialOrderId &&
                        it.clientId == initialClientId && it.storeId == initialStoreId
                }
            }
        } else error = page.error
    }

    if (initialOrderId.isBlank()) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize(), color = KunColors.Ground) {
            Column {
                TopAppBar(
                    title = { Column {
                        Text("البحث الشامل", fontWeight = FontWeight.ExtraBold)
                        Text("كل المتاجر والتواريخ", style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = .8f))
                    } },
                    navigationIcon = {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Outlined.Close, contentDescription = "إغلاق البحث")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = KunV3.Navy,
                        titleContentColor = Color.White,
                        navigationIconContentColor = Color.White
                    )
                )
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    placeholder = { Text("رقم الطلب، العميل، الهاتف أو البوليصة") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    singleLine = true,
                    shape = KunRadius
                )
                Text(
                    "كل المتاجر المسموح بها • كل التواريخ • البحث لا يتأثر بفلاتر الأقسام",
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = KunColors.Ink2
                )
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    when {
                        busy -> KunAsyncPanel("جاري البحث في كل الطلبات…", Modifier.align(Alignment.Center))
                        query.trim().length < 2 -> Text(
                            "اكتب حرفين على الأقل للبحث في تاريخ الطلبات بالكامل",
                            modifier = Modifier.align(Alignment.Center).padding(20.dp)
                        )
                        error.isNotBlank() -> Column(
                            modifier = Modifier.align(Alignment.Center).padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(error, color = MaterialTheme.colorScheme.error)
                            TextButton(onClick = { query = query.trim() + " " }) { Text("إعادة المحاولة") }
                        }
                        items.isEmpty() -> Text(
                            "لا توجد طلبات مطابقة للبحث",
                            modifier = Modifier.align(Alignment.Center)
                        )
                        else -> LazyColumn(
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(items, key = { "${it.clientId}:${it.storeId}:${it.id}" }) { order ->
                                OutlinedCard(
                                    onClick = { selected = order },
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(17.dp)
                                ) {
                                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                        Text(order.name.ifBlank { "عميل بدون اسم" }, fontWeight = FontWeight.Bold)
                                        Text("المتجر: ${order.storeName}",
                                            style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2,
                                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        val readableRef = globalSearchReadableRef(order.ref)
                                        if (readableRef.isNotBlank()) Text("رقم الطلب: $readableRef",
                                            style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                                        if (order.phone.isNotBlank()) Text("الهاتف: ${order.phone}",
                                            style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                                        Text("تاريخ الطلب: ${globalSearchOrderDate(order.date)}",
                                            style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                                        Text("المنتج: ${order.product.ifBlank { "غير مسجل" }}",
                                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        Text("حالة العميل: ${globalSearchCustomerStatus(order.state)}",
                                            fontWeight = FontWeight.SemiBold, color = KunColors.Chrome)
                                    }
                                }
                            }
                            if (hasMore) {
                                item {
                                    Button(
                                        enabled = !loadingMore,
                                        onClick = {
                                            if (!loadingMore) {
                                                loadingMore = true
                                                val requestedQuery = query.trim()
                                                val requestedOffset = offset
                                                scope.launch {
                                                    val page = withContext(Dispatchers.IO) {
                                                        GlobalOrderSearchApi.search(context, requestedQuery, requestedOffset)
                                                    }
                                                    if (requestedQuery == query.trim()) {
                                                        if (page.ok) {
                                                            items = (items + page.items).distinctBy { "${it.clientId}:${it.id}" }
                                                            hasMore = page.hasMore
                                                            offset = page.nextOffset
                                                        } else error = page.error
                                                    }
                                                    loadingMore = false
                                                }
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth()
                                    ) { Text(if (loadingMore) "جاري تحميل المزيد…" else "تحميل المزيد من النتائج") }
                                }
                            }
                        }
                    }
                }
                HorizontalDivider()
                FilledTonalButton(
                    onClick = onHome,
                    modifier = Modifier.align(Alignment.CenterHorizontally).padding(8.dp)
                ) {
                    KunRaisedHomeIcon(active = true)
                    Spacer(Modifier.width(7.dp))
                    Text("الرئيسية")
                }
            }
        }
    }

    } else if (selected == null) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("مراجعة الطلب") },
            text = {
                Text(
                    when {
                        busy -> "جاري تحميل تفاصيل الطلب…"
                        error.isNotBlank() -> error
                        else -> "لا يمكن عرض الطلب. تأكد من صلاحيتك على المتجر ثم حاول مجددًا."
                    }
                )
            },
            confirmButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } }
        )
    }

    selected?.let { order ->
        AlertDialog(
            onDismissRequest = { if (initialOrderId.isNotBlank()) onDismiss() else selected = null },
            title = { Text(order.name.ifBlank { "مراجعة الطلب" }) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (initialOrderId.isBlank()) {
                        val readableRef = globalSearchReadableRef(order.ref)
                        if (readableRef.isNotBlank()) Text("الطلب: $readableRef")
                    }
                    Text("المتجر: ${order.storeName}")
                    Text("حالة العميل: ${globalSearchCustomerStatus(order.state)}")
                    Text("تاريخ الطلب: ${globalSearchOrderDate(order.date)}")
                    Text("الهاتف: ${order.phone}")
                    Text("المنتج: ${order.product.ifBlank { "غير مسجل" }}")
                    if (order.total.isNotBlank()) Text("الإجمالي: ${order.total} ج.م")
                    if (order.gov.isNotBlank()) Text("المحافظة: ${order.gov}")
                    if (order.awb.isNotBlank()) Text("البوليصة: ${order.awb}")
                    if (order.state !in setOf("pending", "no_answer", "confirmed", "preparing", "deferred")) {
                        Text("هذا الطلب خرج من مرحلة التعديل العادي؛ استخدم إجراء الشحن أو المرتجعات المخصص.", color = KunColors.Ink2)
                    }
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (order.state in setOf("pending", "no_answer", "confirmed", "preparing", "deferred")) {
                        Button(onClick = {
                            context.startActivity(Intent(context, CallerOrderEditActivity::class.java).apply {
                                putExtra(CallerOrderEditActivity.EXTRA_ORDER_ID, order.id)
                                putExtra(CallerOrderEditActivity.EXTRA_CLIENT_ID, order.clientId)
                                putExtra(CallerOrderEditActivity.EXTRA_STORE_ID, order.storeId)
                            })
                            onDismiss()
                        }) { Text("تعديل الطلب") }
                    }
                    TextButton(
                        enabled = order.phone.isNotBlank(),
                        onClick = {
                            context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(order.phone)}")))
                        }
                    ) { Text("اتصال") }
                }
            },
            dismissButton = {
                TextButton(onClick = { if (initialOrderId.isNotBlank()) onDismiss() else selected = null }) {
                    Text("إغلاق")
                }
            }
        )
    }
}
