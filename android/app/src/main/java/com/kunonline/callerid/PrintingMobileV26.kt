package com.kunonline.callerid

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditLocationAlt
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.NumberFormat
import java.util.Locale

data class PrintingOrderUi(
    val id: String,
    val clientId: String,
    val storeId: String,
    val ref: String,
    val name: String,
    val phone: String,
    val product: String,
    val qty: Int,
    val total: Double,
    val state: String,
    val awb: String,
    val province: String,
    val city: String,
    val area: String,
    val street: String,
    val queuedForPrint: Boolean,
    val printed: Boolean,
    val sortingCode: String
)

data class PrintingBoardResult(
    val ok: Boolean,
    val message: String,
    val clientId: String = "",
    val orders: List<PrintingOrderUi> = emptyList()
)

data class PrintingActionResult(
    val ok: Boolean,
    val message: String,
    val code: String = "",
    val awb: String = "",
    val url: String = ""
)

object KunPrintingApi {
    private const val BASE_URL = "https://app.kun-online.com"
    private data class HttpResult(val code: Int, val body: String)

    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun request(context: Context, method: String, path: String, body: JSONObject? = null): HttpResult {
        val cookie = KunApi.sessionCookie(context) ?: return HttpResult(401, "{\"error\":\"سجّل الدخول أولاً\"}")
        val connection = (URL(BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-Kun-Mobile", "native-android/2.6.6")
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

    private fun json(result: HttpResult): JSONObject = runCatching { JSONObject(result.body) }.getOrDefault(JSONObject())
    private fun clientId(context: Context): String {
        val cookie = KunApi.sessionCookie(context) ?: return ""
        return KunApi.resolveScope(cookie).clientId
    }

    fun fetch(context: Context): PrintingBoardResult = runCatching {
        val cid = clientId(context)
        if (cid.isBlank()) return PrintingBoardResult(false, "تعذر تحديد حساب المتجر")
        val result = request(context, "GET", "/api/printing?clientId=${enc(cid)}")
        val root = json(result)
        if (result.code !in 200..299) return PrintingBoardResult(false, root.optString("error").ifBlank { "تعذر تحميل قسم الطباعة" })
        val rows = root.optJSONArray("orders")
        val orders = buildList {
            if (rows != null) for (i in 0 until rows.length()) {
                val o = rows.optJSONObject(i) ?: continue
                add(
                    PrintingOrderUi(
                        id = o.optString("id"), clientId = o.optString("clientId").ifBlank { cid }, storeId = o.optString("storeId"),
                        ref = o.optString("ref").ifBlank { o.optString("id") }, name = o.optString("name"), phone = o.optString("phone"),
                        product = o.optString("product"), qty = o.optInt("qty", 1).coerceAtLeast(1), total = o.optDouble("total", 0.0),
                        state = o.optString("state"), awb = o.optString("awb"), province = o.optString("province").ifBlank { o.optString("gov") },
                        city = o.optString("city"), area = o.optString("area"), street = o.optString("street").ifBlank { o.optString("address") },
                        queuedForPrint = o.optBoolean("queuedForPrint", false), printed = o.optBoolean("printed", false), sortingCode = o.optString("sortingCode")
                    )
                )
            }
        }
        PrintingBoardResult(true, "تم تحميل قسم الطباعة", cid, orders)
    }.getOrElse { PrintingBoardResult(false, "تعذر الاتصال بقسم الطباعة") }

    fun stage(context: Context, order: PrintingOrderUi): PrintingActionResult {
        val cid = order.clientId.ifBlank { clientId(context) }
        val query = "?clientId=${enc(cid)}" + if (order.storeId.isNotBlank()) "&storeId=${enc(order.storeId)}" else ""
        val payload = JSONObject().put("clientId", cid).apply { if (order.storeId.isNotBlank()) put("storeId", order.storeId) }
        val result = request(context, "POST", "/api/jt/shipments/${enc(order.id)}$query", payload)
        val root = json(result)
        return if (result.code in 200..299) PrintingActionResult(true, root.optString("message").ifBlank { "تم تجهيز بيانات الشحن" }, awb = root.optString("awb"))
        else PrintingActionResult(false, root.optString("error").ifBlank { "تعذر تجهيز بيانات J&T" }, code = root.optString("code"))
    }

    fun sendAndPrint(context: Context, order: PrintingOrderUi): PrintingActionResult {
        val cid = order.clientId.ifBlank { clientId(context) }
        val query = "?clientId=${enc(cid)}" + if (order.storeId.isNotBlank()) "&storeId=${enc(order.storeId)}" else ""
        val payload = JSONObject().put("clientId", cid).apply { if (order.storeId.isNotBlank()) put("storeId", order.storeId) }
        val result = request(context, "POST", "/api/jt/shipments/${enc(order.id)}/print$query", payload)
        val root = json(result)
        return if (result.code in 200..299) PrintingActionResult(true, "تم إرسال الأوردر إلى J&T وتجهيز البوليصة", awb = root.optString("awb"), url = root.optString("url"))
        else PrintingActionResult(false, root.optString("error").ifBlank { "تعذر إرسال الأوردر إلى J&T" }, code = root.optString("code"), awb = root.optString("awb"))
    }
}

@Composable
fun PrintingMobileV26(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var board by remember { mutableStateOf<PrintingBoardResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    var busyId by remember { mutableStateOf("") }
    var printedTab by remember { mutableStateOf(false) }

    fun refresh() {
        if (loading) return
        loading = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { KunPrintingApi.fetch(context) }
            board = result
            loading = false
        }
    }

    LaunchedEffect(Unit) { refresh() }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize()) {
                Surface(tonalElevation = 3.dp) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Print, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text("الطباعة والشحن", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("التأكيد ← الطباعة ← J&T ← جاري الشحن", style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(onClick = { refresh() }, enabled = !loading) { Icon(Icons.Outlined.Refresh, "تحديث") }
                        IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "إغلاق") }
                    }
                }

                val all = board?.orders.orEmpty()
                val waiting = all.filter { !it.printed }
                val printed = all.filter { it.printed }
                Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !printedTab, onClick = { printedTab = false }, label = { Text("في انتظار الإرسال (${waiting.size})") })
                    FilterChip(selected = printedTab, onClick = { printedTab = true }, label = { Text("تم الإرسال (${printed.size})") })
                }

                when {
                    loading && board == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    board?.ok == false -> Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) { Text(board?.message.orEmpty()) }
                    else -> {
                        val visible = if (printedTab) printed else waiting
                        if (visible.isEmpty()) {
                            Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
                                Text(if (printedTab) "لا توجد أوردرات تم إرسالها بعد" else "لا توجد أوردرات مؤكدة في انتظار الطباعة")
                            }
                        } else LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(visible, key = { it.id }) { order ->
                                PrintingOrderCard(
                                    order = order,
                                    busy = busyId == order.id,
                                    onEdit = {
                                        context.startActivity(Intent(context, CallerJntOrderEditActivity::class.java).putExtra(CallerJntOrderEditActivity.EXTRA_ORDER_ID, order.id))
                                    },
                                    onSend = {
                                        if (busyId.isNotBlank()) return@PrintingOrderCard
                                        busyId = order.id
                                        scope.launch {
                                            val stage = if (order.queuedForPrint) PrintingActionResult(true, "جاهز") else withContext(Dispatchers.IO) { KunPrintingApi.stage(context, order) }
                                            if (!stage.ok) {
                                                busyId = ""
                                                if (stage.code in setOf("JT_SHIPMENT_FIELDS_MISSING", "JT_PRINT_QUEUE_DATA_MISSING")) {
                                                    Toast.makeText(context, "راجع بيانات J&T للأوردر أولًا", Toast.LENGTH_LONG).show()
                                                    context.startActivity(Intent(context, CallerJntOrderEditActivity::class.java).putExtra(CallerJntOrderEditActivity.EXTRA_ORDER_ID, order.id))
                                                } else Toast.makeText(context, stage.message, Toast.LENGTH_LONG).show()
                                                refresh()
                                                return@launch
                                            }
                                            val sent = withContext(Dispatchers.IO) { KunPrintingApi.sendAndPrint(context, order.copy(queuedForPrint = true)) }
                                            busyId = ""
                                            Toast.makeText(context, sent.message + if (sent.awb.isNotBlank()) " — AWB ${sent.awb}" else "", Toast.LENGTH_LONG).show()
                                            if (sent.ok && sent.url.isNotBlank()) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(sent.url))) }
                                            refresh()
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PrintingOrderCard(order: PrintingOrderUi, busy: Boolean, onEdit: () -> Unit, onSend: () -> Unit) {
    val money = NumberFormat.getNumberInstance(Locale("ar", "EGYPT")).format(order.total)
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(order.name.ifBlank { "عميل" }, fontWeight = FontWeight.Bold)
                    Text("#${order.ref} • ${order.product.ifBlank { "بدون منتج" }} × ${order.qty}", style = MaterialTheme.typography.bodySmall)
                }
                AssistChip(onClick = {}, enabled = false, label = { Text(if (order.printed) "تم الإرسال" else if (order.queuedForPrint) "جاهز" else "تم التأكيد") })
            }
            Text(listOf(order.province, order.city, order.area, order.street).filter { it.isNotBlank() }.joinToString(" — ").ifBlank { "العنوان يحتاج مراجعة" })
            Row(Modifier.fillMaxWidth()) {
                Text("COD: $money ج.م", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (order.awb.isNotBlank()) Text("AWB: ${order.awb}", fontWeight = FontWeight.SemiBold)
            }
            if (!order.printed) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onEdit, modifier = Modifier.weight(1f), enabled = !busy) {
                        Icon(Icons.Outlined.EditLocationAlt, null); Spacer(Modifier.width(6.dp)); Text("بيانات J&T")
                    }
                    Button(onClick = onSend, modifier = Modifier.weight(1f), enabled = !busy) {
                        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Outlined.LocalShipping, null)
                        Spacer(Modifier.width(6.dp)); Text(if (busy) "جارٍ الإرسال" else "إرسال إلى J&T")
                    }
                }
            }
        }
    }
}
