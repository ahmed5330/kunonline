package com.kunonline.callerid

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

enum class DashboardRange(val label: String) {
    TODAY("اليوم"),
    YESTERDAY("أمس"),
    CURRENT_WEEK("الأسبوع الحالي"),
    PREVIOUS_WEEK("الأسبوع الماضي"),
    CURRENT_MONTH("الشهر الحالي"),
    PREVIOUS_MONTH("الشهر الماضي")
}

internal fun v23RangeBounds(
    range: DashboardRange,
    today: LocalDate = LocalDate.now(ZoneId.of("Africa/Cairo"))
): Pair<LocalDate, LocalDate> = when (range) {
    DashboardRange.TODAY -> today to today
    DashboardRange.YESTERDAY -> today.minusDays(1) to today.minusDays(1)
    DashboardRange.CURRENT_WEEK -> {
        val start = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        start to today
    }
    DashboardRange.PREVIOUS_WEEK -> {
        val currentStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        currentStart.minusWeeks(1) to currentStart.minusDays(1)
    }
    DashboardRange.CURRENT_MONTH -> today.withDayOfMonth(1) to today
    DashboardRange.PREVIOUS_MONTH -> {
        val previous = today.minusMonths(1)
        previous.withDayOfMonth(1) to previous.withDayOfMonth(previous.lengthOfMonth())
    }
}

internal fun v23ParseOrderDate(value: String): LocalDate? {
    val raw = value.trim()
    if (raw.isBlank()) return null
    return runCatching { LocalDate.parse(raw.take(10), DateTimeFormatter.ISO_LOCAL_DATE) }.getOrNull()
        ?: runCatching { Instant.parse(raw).atZone(ZoneId.of("Africa/Cairo")).toLocalDate() }.getOrNull()
}

internal fun v23FilterOrders(
    orders: List<OrderUi>,
    range: DashboardRange,
    today: LocalDate = LocalDate.now(ZoneId.of("Africa/Cairo"))
): List<OrderUi> {
    val (start, end) = v23RangeBounds(range, today)
    return orders.filter { order ->
        val date = v23ParseOrderDate(order.date) ?: return@filter false
        !date.isBefore(start) && !date.isAfter(end)
    }
}

@Composable
fun V23Dashboard(snapshot: CommerceSnapshot, onQuickCreate: (String) -> Unit) {
    var range by remember { mutableStateOf(DashboardRange.TODAY) }
    val orders = remember(snapshot.orders, range) { v23FilterOrders(snapshot.orders, range) }
    val total = orders.sumOf { it.total }
    val aov = if (orders.isEmpty()) 0.0 else total / orders.size
    val pending = orders.count { it.state in setOf("pending", "new", "جديد") }
    val noAnswer = orders.count { it.state == "no_answer" }
    val confirmed = orders.count { it.state == "confirmed" }
    val preparing = orders.count { it.state == "preparing" }
    val shipping = orders.count { it.state in setOf("shipping", "in_shipping", "shipped") || it.checkpoint.contains("شحن") }
    val signed = orders.count { it.state == "signed" }
    val collected = orders.count { it.state == "collected" }
    val returned = orders.count { it.state == "returned" }
    val cancelled = orders.count { it.state == "cancelled" }
    val advanced = confirmed + preparing + shipping + signed + collected
    val confirmationRate = if (orders.isEmpty()) 0.0 else advanced * 100.0 / orders.size
    val collectionRate = if (orders.isEmpty()) 0.0 else collected * 100.0 / orders.size
    val topProducts = orders.filter { it.product.isNotBlank() }.groupingBy { it.product }.eachCount().entries.sortedByDescending { it.value }.take(5)
    val topGovs = orders.filter { it.gov.isNotBlank() }.groupingBy { it.gov }.eachCount().entries.sortedByDescending { it.value }.take(5)
    val sources = orders.filter { it.source.isNotBlank() }.groupingBy { it.source }.eachCount().entries.sortedByDescending { it.value }.take(5)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("لوحة التحكم", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("الأرقام تتغير حسب الفترة المختارة", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DashboardRange.entries.forEach { item ->
                    FilterChip(selected = range == item, onClick = { range = item }, label = { Text(item.label) })
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V23Kpi("إجمالي الطلبات", orders.size.toString(), Modifier.weight(1f))
                V23Kpi("المبيعات", v23Money(total), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V23Kpi("متوسط الطلب", v23Money(aov), Modifier.weight(1f))
                V23Kpi("نسبة التأكيد", v23Percent(confirmationRate), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V23Kpi("نسبة التحصيل", v23Percent(collectionRate), Modifier.weight(1f))
                V23Kpi("إلغاء/مرتجع", (cancelled + returned).toString(), Modifier.weight(1f))
            }
        }
        item {
            Text("حالات التشغيل", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            V23StatusRows(
                listOf(
                    "في انتظار التأكيد" to pending,
                    "العميل لا يرد" to noAnswer,
                    "تم التأكيد" to confirmed,
                    "التجهيز والتغليف" to preparing,
                    "جاري الشحن" to shipping,
                    "تم التسليم — تحصيل منتظر" to signed,
                    "تم التحصيل" to collected,
                    "مرتجع" to returned,
                    "ملغي" to cancelled
                )
            )
        }
        item {
            Text("إنشاء سريع", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { onQuickCreate("order") }, modifier = Modifier.weight(1f)) { Text("طلب جديد") }
                FilledTonalButton(onClick = { onQuickCreate("customer") }, modifier = Modifier.weight(1f)) { Text("عميل جديد") }
            }
        }
        if (topProducts.isNotEmpty()) item { V23Breakdown("أكثر المنتجات طلبًا", topProducts.map { it.key to it.value }) }
        if (topGovs.isNotEmpty()) item { V23Breakdown("أعلى المحافظات", topGovs.map { it.key to it.value }) }
        if (sources.isNotEmpty()) item { V23Breakdown("مصادر الطلبات", sources.map { it.key to it.value }) }
        item { Text("أحدث طلبات الفترة", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
        if (orders.isEmpty()) item { V23Empty("لا توجد طلبات في الفترة المختارة") }
        items(orders.take(8), key = { it.id.ifBlank { it.ref + it.phone } }) { order ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(order.name.ifBlank { "عميل" }, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text(v23Money(order.total), fontWeight = FontWeight.Bold)
                    }
                    Text("#${order.ref} • ${v23StateLabel(order.state)}", style = MaterialTheme.typography.bodySmall)
                    if (order.product.isNotBlank()) Text("${order.product} × ${order.qty}", modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun V23Kpi(label: String, value: String, modifier: Modifier = Modifier) {
    ElevatedCard(modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun V23StatusRows(rows: List<Pair<String, Int>>) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            rows.forEach { (label, count) ->
                Row(Modifier.fillMaxWidth()) {
                    Text(label, Modifier.weight(1f))
                    Text(count.toString(), fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun V23Breakdown(title: String, rows: List<Pair<String, Int>>) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            rows.forEachIndexed { index, row ->
                Row(Modifier.fillMaxWidth()) {
                    Text("${index + 1}. ${row.first}", Modifier.weight(1f))
                    Text(row.second.toString(), fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun V23CustomerService(snapshot: CommerceSnapshot, onGlobalRefresh: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var board by remember { mutableStateOf<CustomerServiceBoardResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var stateFilter by remember { mutableStateOf("all") }
    var storeFilter by remember { mutableStateOf("") }
    var selectedOrder by remember { mutableStateOf<CsOrderUi?>(null) }
    var editorData by remember { mutableStateOf<CustomerServiceEditorData?>(null) }

    fun refreshBoard(keepOrderId: String? = selectedOrder?.id) {
        if (loading) return
        loading = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { KunCustomerServiceApi.fetchBoard(context, storeFilter) }
            loading = false
            message = result.message
            if (result.ok) {
                board = result
                selectedOrder = keepOrderId?.let { id -> result.orders.find { it.id == id } }
            }
        }
    }

    LaunchedEffect(storeFilter) { refreshBoard(null) }

    val allOrders = board?.orders.orEmpty()
    val filtered = remember(allOrders, query, stateFilter) {
        allOrders.filter { order ->
            val stateOk = stateFilter == "all" || order.state == stateFilter
            val queryOk = query.isBlank() || listOf(order.name, order.phone, order.ref, order.product, order.gov, order.address, order.storeName, order.awb)
                .any { it.contains(query, true) }
            stateOk && queryOk
        }
    }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            placeholder = { Text("ابحث بالعميل، الهاتف، الطلب، المنتج، العنوان أو AWB") },
            singleLine = true
        )
        board?.stores?.takeIf { it.isNotEmpty() }?.let { stores ->
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(selected = storeFilter.isBlank(), onClick = { storeFilter = "" }, label = { Text("كل المتاجر") })
                stores.forEach { store ->
                    FilterChip(selected = storeFilter == store.id, onClick = { storeFilter = store.id }, label = { Text(store.name.ifBlank { store.code }) })
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            v23CustomerServiceStates().forEach { (key, label) ->
                FilterChip(selected = stateFilter == key, onClick = { stateFilter = key }, label = { Text(label) })
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("خدمة العملاء — ${filtered.size}", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { refreshBoard() }, enabled = !loading) { Icon(Icons.Outlined.Refresh, contentDescription = "تحديث") }
        }
        if (message.isNotBlank() && board?.ok != true) Text(message, Modifier.padding(horizontal = 16.dp))
        if (loading && board == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (filtered.isEmpty()) {
            V23Empty(if (allOrders.isEmpty()) "لا توجد أوردرات خدمة عملاء متاحة" else "لا توجد نتائج مطابقة")
        } else {
            LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(filtered, key = { it.id }) { order ->
                    V23CustomerServiceCard(order) { selectedOrder = order }
                }
            }
        }
    }

    selectedOrder?.let { order ->
        V23OrderDetailDialog(
            order = order,
            labels = board?.stateLabels.orEmpty(),
            onDismiss = { selectedOrder = null },
            onChanged = {
                refreshBoard(order.id)
                onGlobalRefresh()
            },
            onEdit = {
                loading = true
                scope.launch {
                    val data = withContext(Dispatchers.IO) { KunCustomerServiceApi.fetchEditorData(context, order.id) }
                    loading = false
                    if (data.ok) editorData = data else Toast.makeText(context, data.message, Toast.LENGTH_LONG).show()
                }
            }
        )
    }

    editorData?.let { data ->
        V23EditOrderDialog(
            orderId = selectedOrder?.id.orEmpty(),
            data = data,
            onDismiss = { editorData = null },
            onSaved = {
                editorData = null
                refreshBoard(selectedOrder?.id)
                onGlobalRefresh()
            }
        )
    }
}

@Composable
private fun V23CustomerServiceCard(order: CsOrderUi, onOpen: () -> Unit) {
    ElevatedCard(modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Column(Modifier.padding(14.dp)) {
            if (order.returnedFromDeferredToday) {
                Text("رجع من التأجيل اليوم — يحتاج متابعة", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(order.name.ifBlank { "عميل بدون اسم" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text("#${order.ref} • ${v23StateLabel(order.state)}", style = MaterialTheme.typography.bodySmall)
                }
                Text(v23Money(order.total), fontWeight = FontWeight.Bold)
            }
            if (order.storeName.isNotBlank()) Text(order.storeName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            if (order.phone.isNotBlank()) Text(order.phone)
            if (order.gov.isNotBlank() || order.address.isNotBlank()) Text(listOf(order.gov, order.address).filter { it.isNotBlank() }.joinToString(" — "), style = MaterialTheme.typography.bodySmall)
            if (order.product.isNotBlank()) Text("${order.product} × ${order.qty}", modifier = Modifier.padding(top = 6.dp))
            if (order.latestInternalNote.isNotBlank()) Text("آخر ملاحظة: ${order.latestInternalNote}", modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("محاولات التواصل: ${order.contactCount}", style = MaterialTheme.typography.labelMedium)
                Text("عرض التفاصيل والتعديل", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun V23OrderDetailDialog(
    order: CsOrderUi,
    labels: Map<String, String>,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
    onEdit: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var actionBusy by remember { mutableStateOf(false) }
    var selectedState by remember(order.id, order.state) { mutableStateOf(order.state) }
    var deferUntil by remember(order.id, order.deferUntil) { mutableStateOf(order.deferUntil) }
    var awb by remember(order.id, order.awb) { mutableStateOf(order.awb) }
    var note by remember(order.id) { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }

    fun runAction(block: suspend () -> CustomerServiceJsonResult, after: (() -> Unit)? = null) {
        if (actionBusy) return
        actionBusy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { block() }
            actionBusy = false
            Toast.makeText(context, result.message, if (result.ok) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
            if (result.ok) {
                after?.invoke()
                onChanged()
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("الأوردر #${order.ref}") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 620.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                V23DetailRow("العميل", order.name)
                V23DetailRow("الهاتف", order.phone)
                V23DetailRow("المتجر", order.storeName)
                V23DetailRow("المحافظة", order.gov)
                V23DetailRow("العنوان", order.address)
                V23DetailRow("المنتج", order.product)
                if (order.productNote.isNotBlank()) V23DetailRow("اختيار/لون/مقاس", order.productNote)
                V23DetailRow("الكمية", order.qty.toString())
                V23DetailRow("سعر الوحدة", v23Money(order.unitPrice))
                V23DetailRow("الإجمالي", v23Money(order.total))
                V23DetailRow("المصدر", order.source)
                V23DetailRow("التاريخ", order.date)
                V23DetailRow("الحالة", labels[order.state] ?: v23StateLabel(order.state))
                V23DetailRow("محاولات التواصل", order.contactCount.toString())
                if (order.customerNote.isNotBlank()) V23DetailRow("ملاحظة العميل", order.customerNote)
                if (order.latestInternalNote.isNotBlank()) V23DetailRow("آخر ملاحظة داخلية", order.latestInternalNote)
                if (order.stockBatchName.isNotBlank()) V23DetailRow("دفعة المخزون", order.stockBatchName)
                if (order.stockAllocationStatus.isNotBlank()) V23DetailRow("حالة تخصيص المخزون", order.stockAllocationStatus)

                HorizontalDivider()
                Text("تغيير الحالة", fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    v23AllStates().forEach { state ->
                        FilterChip(selected = selectedState == state.first, onClick = { selectedState = state.first }, label = { Text(labels[state.first] ?: state.second) })
                    }
                }
                if (selectedState == "deferred") {
                    OutlinedTextField(value = deferUntil, onValueChange = { deferUntil = it }, label = { Text("تاريخ التأجيل YYYY-MM-DD") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                }
                Button(
                    onClick = { runAction({ KunCustomerServiceApi.updateState(context, order.id, selectedState, deferUntil, order.stockBatchId) }) },
                    enabled = !actionBusy && selectedState.isNotBlank() && (selectedState != "deferred" || deferUntil.matches(Regex("^\\d{4}-\\d{2}-\\d{2}$"))),
                    modifier = Modifier.fillMaxWidth()
                ) { Text("حفظ الحالة") }

                HorizontalDivider()
                Text("البوليصة AWB", fontWeight = FontWeight.Bold)
                OutlinedTextField(value = awb, onValueChange = { awb = it }, label = { Text("رقم البوليصة") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedButton(onClick = { runAction({ KunCustomerServiceApi.saveAwb(context, order.id, awb) }) }, enabled = !actionBusy, modifier = Modifier.fillMaxWidth()) { Text("حفظ AWB") }

                HorizontalDivider()
                Text("التواصل والملاحظات", fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (order.phone.isNotBlank()) {
                        OutlinedButton(
                            onClick = {
                                runAction(
                                    { KunCustomerServiceApi.logContact(context, order.id, "phone", "call") },
                                    after = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${order.phone}"))) }
                                )
                            },
                            modifier = Modifier.weight(1f), enabled = !actionBusy
                        ) { Icon(Icons.Outlined.Call, null); Spacer(Modifier.width(4.dp)); Text("مكالمة") }
                    }
                    OutlinedButton(
                        onClick = { runAction({ KunCustomerServiceApi.logContact(context, order.id, "phone", "contact") }) },
                        modifier = Modifier.weight(1f), enabled = !actionBusy
                    ) { Text("تواصل") }
                }
                if (order.phone.isNotBlank()) {
                    FilledTonalButton(
                        onClick = {
                            if (actionBusy) return@FilledTonalButton
                            actionBusy = true
                            scope.launch {
                                val result = withContext(Dispatchers.IO) {
                                    val contact = KunCustomerServiceApi.logContact(context, order.id, "whatsapp", "contact")
                                    if (contact.ok) KunCustomerServiceApi.logWhatsapp(context, order.id) else contact
                                }
                                actionBusy = false
                                if (result.ok) {
                                    val number = v23WhatsappPhone(order.phone)
                                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$number"))) }
                                    onChanged()
                                } else Toast.makeText(context, result.message, Toast.LENGTH_LONG).show()
                            }
                        },
                        modifier = Modifier.fillMaxWidth(), enabled = !actionBusy
                    ) { Text("واتساب") }
                }
                OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("ملاحظة داخلية") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                Button(
                    onClick = { runAction({ KunCustomerServiceApi.addNote(context, order.id, note) }, after = { note = "" }) },
                    enabled = !actionBusy && note.isNotBlank(), modifier = Modifier.fillMaxWidth()
                ) { Text("إضافة الملاحظة") }

                HorizontalDivider()
                Button(onClick = onEdit, modifier = Modifier.fillMaxWidth(), enabled = !actionBusy) {
                    Icon(Icons.Outlined.Edit, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("تعديل بيانات الأوردر والمنتجات")
                }

                Text("سجل الأوردر", fontWeight = FontWeight.Bold)
                if (order.history.length() == 0) Text("لا يوجد سجل بعد", style = MaterialTheme.typography.bodySmall)
                for (i in order.history.length() - 1 downTo 0) {
                    val event = order.history.optJSONObject(i) ?: continue
                    V23HistoryEvent(event)
                }

                TextButton(onClick = { confirmDelete = true }, enabled = !actionBusy, modifier = Modifier.fillMaxWidth()) {
                    Text("حذف الأوردر", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } }
    )

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("تأكيد حذف الأوردر") },
            text = { Text("الحذف نهائي ويخضع لنفس صلاحيات الويب. هل تريد حذف #${order.ref}؟") },
            confirmButton = {
                Button(
                    onClick = {
                        confirmDelete = false
                        runAction({ KunCustomerServiceApi.deleteOrder(context, order.id) }, after = onDismiss)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("حذف نهائي") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("إلغاء") } }
        )
    }
}

@Composable
private fun V23HistoryEvent(event: JSONObject) {
    val type = event.optString("type")
    val state = event.optString("state")
    val note = event.optString("note")
    val by = event.optString("byName").ifBlank { event.optString("by") }
    val at = event.optString("at")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp)) {
            Text(
                when {
                    note.isNotBlank() -> note
                    state.isNotBlank() -> v23StateLabel(state)
                    type.isNotBlank() -> v23EventLabel(type)
                    else -> "إجراء"
                },
                fontWeight = FontWeight.Bold
            )
            Text(listOf(by, at).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun V23DetailRow(label: String, value: String) {
    if (value.isBlank()) return
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        Text(value)
    }
}

data class CsCatalogVariant(val id: String, val name: String, val sku: String, val price: Double?)
data class CsCatalogProduct(val id: String, val name: String, val sku: String, val price: Double, val variants: List<CsCatalogVariant>)
data class CsEditItem(
    val productId: String,
    val variantId: String,
    val productName: String,
    val variantLabel: String,
    val sku: String,
    val qty: Int,
    val unitPrice: Double
)

@Composable
private fun V23EditOrderDialog(
    orderId: String,
    data: CustomerServiceEditorData,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val details = data.details
    val order = remember(data) { details.optJSONObject("order") ?: JSONObject() }
    val customer = remember(data) { details.optJSONObject("customer") ?: JSONObject() }
    val address = remember(data) { details.optJSONObject("address") ?: JSONObject() }
    val catalog = remember(data) { v23ParseCatalog(data.catalog) }
    val items = remember(data) { mutableStateListOf<CsEditItem>().apply { addAll(v23InitialEditItems(details)) } }
    var name by remember(data) { mutableStateOf(customer.optString("name")) }
    var phone by remember(data) { mutableStateOf(customer.optString("phone")) }
    var gov by remember(data) { mutableStateOf(address.optString("government").ifBlank { customer.optString("government") }) }
    var deliveryAddress by remember(data) { mutableStateOf(address.optString("address").ifBlank { customer.optString("address") }) }
    var couponCode by remember(data) { mutableStateOf(order.optString("couponCode")) }
    var customerNote by remember(data) { mutableStateOf(order.optString("customerNote")) }
    var totalText by remember(data) { mutableStateOf((details.optJSONObject("summary")?.optDouble("total", 0.0) ?: 0.0).toString()) }
    var busy by remember { mutableStateOf(false) }

    fun recalc() {
        totalText = items.sumOf { it.qty.coerceAtLeast(1) * it.unitPrice.coerceAtLeast(0.0) }.toString()
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("تعديل الأوردر") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 650.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("بيانات العميل والتوصيل", fontWeight = FontWeight.Bold)
                V23TextField(name, { name = it }, "اسم العميل")
                V23TextField(phone, { phone = it }, "رقم الهاتف", KeyboardType.Phone)
                V23TextField(gov, { gov = it }, "المحافظة")
                V23TextField(deliveryAddress, { deliveryAddress = it }, "العنوان")

                HorizontalDivider()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("منتجات الطلب", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    TextButton(onClick = { items.add(CsEditItem("", "", "", "", "", 1, 0.0)) }) { Text("+ إضافة منتج") }
                }
                items.forEachIndexed { index, item ->
                    V23EditItemCard(
                        item = item,
                        catalog = catalog,
                        canRemove = items.size > 1,
                        onChange = { updated -> items[index] = updated; recalc() },
                        onRemove = { if (items.size > 1) { items.removeAt(index); recalc() } }
                    )
                }

                HorizontalDivider()
                V23TextField(couponCode, { couponCode = it }, "كود الخصم")
                V23TextField(totalText, { totalText = it }, "إجمالي الطلب", KeyboardType.Decimal)
                OutlinedTextField(value = customerNote, onValueChange = { customerNote = it }, label = { Text("ملاحظة العميل على الطلب") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                Text("كل تعديل يُسجل في سجل الأوردر بنفس آلية الويب.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (busy) return@Button
                    if (name.isBlank() || phone.isBlank() || items.any { it.productName.isBlank() }) {
                        Toast.makeText(context, "الاسم والهاتف واسم كل منتج مطلوبة", Toast.LENGTH_LONG).show()
                        return@Button
                    }
                    busy = true
                    val payload = JSONObject()
                        .put("name", name.trim())
                        .put("phone", phone.trim())
                        .put("gov", gov.trim())
                        .put("address", deliveryAddress.trim())
                        .put("couponCode", couponCode.trim())
                        .put("customerNote", customerNote.trim())
                        .put("total", totalText.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0)
                        .put("items", JSONArray().apply {
                            items.forEach { item ->
                                put(JSONObject()
                                    .put("productId", item.productId)
                                    .put("variantId", item.variantId)
                                    .put("productName", item.productName.trim())
                                    .put("variantLabel", item.variantLabel.trim())
                                    .put("sku", item.sku)
                                    .put("qty", item.qty.coerceAtLeast(1))
                                    .put("unitPrice", item.unitPrice.coerceAtLeast(0.0)))
                            }
                        })
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { KunCustomerServiceApi.editOrder(context, orderId, payload) }
                        busy = false
                        Toast.makeText(context, result.message, if (result.ok) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
                        if (result.ok) onSaved()
                    }
                },
                enabled = !busy
            ) { Text(if (busy) "جارٍ الحفظ..." else "حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("إلغاء") } }
    )
}

@Composable
private fun V23EditItemCard(
    item: CsEditItem,
    catalog: List<CsCatalogProduct>,
    canRemove: Boolean,
    onChange: (CsEditItem) -> Unit,
    onRemove: () -> Unit
) {
    var productMenu by remember { mutableStateOf(false) }
    var variantMenu by remember { mutableStateOf(false) }
    val selectedProduct = catalog.find { it.id == item.productId }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                OutlinedButton(onClick = { productMenu = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(selectedProduct?.name ?: if (item.productName.isBlank()) "اختر منتج أو اكتب يدويًا" else item.productName)
                }
                DropdownMenu(expanded = productMenu, onDismissRequest = { productMenu = false }) {
                    DropdownMenuItem(text = { Text("منتج يدوي") }, onClick = {
                        productMenu = false
                        onChange(item.copy(productId = "", variantId = "", variantLabel = "", sku = ""))
                    })
                    catalog.forEach { product ->
                        DropdownMenuItem(text = { Text(product.name) }, onClick = {
                            productMenu = false
                            onChange(item.copy(productId = product.id, variantId = "", productName = product.name, variantLabel = "", sku = product.sku, unitPrice = product.price))
                        })
                    }
                }
            }
            if (selectedProduct?.variants?.isNotEmpty() == true) {
                Box {
                    OutlinedButton(onClick = { variantMenu = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(item.variantLabel.ifBlank { "اختر اللون / المقاس / الاختيار" })
                    }
                    DropdownMenu(expanded = variantMenu, onDismissRequest = { variantMenu = false }) {
                        DropdownMenuItem(text = { Text("بدون اختيار") }, onClick = {
                            variantMenu = false
                            onChange(item.copy(variantId = "", variantLabel = "", sku = selectedProduct.sku))
                        })
                        selectedProduct.variants.forEach { variant ->
                            DropdownMenuItem(text = { Text(variant.name) }, onClick = {
                                variantMenu = false
                                onChange(item.copy(variantId = variant.id, variantLabel = variant.name, sku = variant.sku.ifBlank { selectedProduct.sku }, unitPrice = variant.price ?: selectedProduct.price))
                            })
                        }
                    }
                }
            }
            V23TextField(item.productName, { onChange(item.copy(productName = it)) }, "اسم المنتج / وصف يدوي")
            if (item.variantLabel.isNotBlank() || item.productId.isBlank()) {
                V23TextField(item.variantLabel, { onChange(item.copy(variantLabel = it)) }, "اللون / المقاس / الاختيار")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = item.qty.toString(),
                    onValueChange = { onChange(item.copy(qty = it.toIntOrNull()?.coerceAtLeast(1) ?: 1)) },
                    label = { Text("الكمية") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f), singleLine = true
                )
                OutlinedTextField(
                    value = item.unitPrice.toString(),
                    onValueChange = { onChange(item.copy(unitPrice = it.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0)) },
                    label = { Text("سعر الوحدة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f), singleLine = true
                )
            }
            if (canRemove) TextButton(onClick = onRemove, modifier = Modifier.align(Alignment.End)) { Text("حذف البند", color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun V23TextField(value: String, onValue: (String) -> Unit, label: String, keyboard: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        singleLine = true
    )
}

@Composable
private fun V23Empty(text: String) {
    Column(Modifier.fillMaxWidth().padding(30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.Inbox, contentDescription = null, modifier = Modifier.size(44.dp))
        Text(text, modifier = Modifier.padding(top = 8.dp))
    }
}

private fun v23InitialEditItems(details: JSONObject): List<CsEditItem> {
    val array = details.optJSONArray("items") ?: JSONArray()
    val list = buildList {
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            add(
                CsEditItem(
                    productId = item.optString("productId"),
                    variantId = item.optString("variantId"),
                    productName = item.optString("name").ifBlank { item.optString("productName") },
                    variantLabel = item.optString("variantName").ifBlank { item.optString("note") }.ifBlank { item.optString("variantLabel") },
                    sku = item.optString("variantSku").ifBlank { item.optString("sku") },
                    qty = item.optInt("quantity", item.optInt("qty", 1)).coerceAtLeast(1),
                    unitPrice = item.optDouble("price", item.optDouble("unitPrice", 0.0)).coerceAtLeast(0.0)
                )
            )
        }
    }
    return if (list.isEmpty()) listOf(CsEditItem("", "", "", "", "", 1, 0.0)) else list
}

private fun v23ParseCatalog(array: JSONArray): List<CsCatalogProduct> = buildList {
    for (i in 0 until array.length()) {
        val product = array.optJSONObject(i) ?: continue
        val variants = buildList {
            val v = product.optJSONArray("variants") ?: JSONArray()
            for (j in 0 until v.length()) {
                val variant = v.optJSONObject(j) ?: continue
                if (variant.has("active") && !variant.optBoolean("active", true)) continue
                val rawPrice = variant.opt("price")
                val price = if (rawPrice == null || rawPrice == JSONObject.NULL) null else rawPrice.toString().toDoubleOrNull()
                add(CsCatalogVariant(variant.optString("id"), variant.optString("name"), variant.optString("sku"), price))
            }
        }
        add(CsCatalogProduct(product.optString("id"), product.optString("name"), product.optString("sku"), product.optDouble("price", 0.0), variants))
    }
}

private fun v23CustomerServiceStates(): List<Pair<String, String>> = listOf(
    "all" to "الكل",
    "pending" to "في انتظار التأكيد",
    "no_answer" to "لا يرد",
    "confirmed" to "تم التأكيد",
    "preparing" to "التجهيز",
    "shipped" to "جاري الشحن",
    "deferred" to "مؤجل"
)

private fun v23AllStates(): List<Pair<String, String>> = listOf(
    "pending" to "في انتظار التأكيد",
    "no_answer" to "العميل لا يرد",
    "confirmed" to "تم التأكيد",
    "preparing" to "التجهيز والتغليف",
    "shipped" to "جاري الشحن",
    "signed" to "تم التسليم — تحصيل منتظر",
    "collected" to "تم التحصيل",
    "returned" to "مرتجع",
    "cancelled" to "تم إلغاء الطلب",
    "deferred" to "مؤجل"
)

private fun v23StateLabel(state: String): String = v23AllStates().firstOrNull { it.first == state }?.second ?: when (state) {
    "new" -> "جديد"
    "shipping", "in_shipping" -> "جاري الشحن"
    else -> state.ifBlank { "بدون حالة" }
}

private fun v23EventLabel(type: String): String = when (type) {
    "internal_note" -> "ملاحظة داخلية"
    "contact" -> "تواصل مع العميل"
    "awb" -> "تحديث البوليصة"
    "order_edit" -> "تعديل الأوردر"
    "defer_return" -> "رجوع من التأجيل"
    "whatsapp" -> "واتساب"
    else -> type.replace('_', ' ')
}

private fun v23WhatsappPhone(raw: String): String {
    var digits = raw.filter(Char::isDigit)
    if (digits.startsWith("00")) digits = digits.drop(2)
    return when {
        digits.matches(Regex("^01\\d{9}$")) -> "20" + digits.drop(1)
        digits.matches(Regex("^05\\d{8}$")) -> "966" + digits.drop(1)
        else -> digits
    }
}

private fun v23Money(value: Double): String = NumberFormat.getNumberInstance(Locale("ar", "EG")).format(value) + " ج.م"
private fun v23Percent(value: Double): String = String.format(Locale.US, "%.1f%%", value)
