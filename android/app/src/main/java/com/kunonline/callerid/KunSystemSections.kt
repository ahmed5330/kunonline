package com.kunonline.callerid

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.LocalDate
import java.util.Locale

private enum class NativeClientSection(val label: String, val description: String) {
    PRINTING("الطباعة", "إرسال J&T وطباعة البوليصة"),
    FINANCE("المالية", "التدفقات والربحية والحركات الأخيرة"),
    ACCOUNTING("الحسابات والحركات", "قراءة وتسجيل الحركات المحاسبية"),
    CAMPAIGNS("الحملات", "Meta Ads والتحليل الفعلي"),
    INVENTORY("المخزون", "الرصيد وحركات الإضافة والتسوية"),
    WALLET("المحفظة", "الرصيد والخصومات وسجل المحفظة"),
    INTEGRATIONS("مركز التكاملات", "حالة وربط واختبار المزودين"),
    SETTINGS("الإعدادات", "مزامنة التطبيق وإعداداته")
}

private val NATIVE_CLIENT_SECTIONS = NativeClientSection.entries.toList()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileSystemSectionsDialog(onDismiss: () -> Unit) {
    var selected by remember { mutableStateOf<NativeClientSection?>(null) }

    BackHandler {
        if (selected != null) selected = null else onDismiss()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = KunColors.Ground) {
            if (selected == null) {
                Scaffold(
                    containerColor = KunColors.Ground,
                    topBar = {
                        TopAppBar(
                            title = {
                                Column {
                                    Text("أقسام التطبيق", fontWeight = FontWeight.ExtraBold)
                                    Text(
                                        "8 أقسام Native مرتبطة مباشرة بالسيستم",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = Color.White.copy(alpha = .76f)
                                    )
                                }
                            },
                            navigationIcon = {
                                IconButton(onClick = onDismiss) {
                                    Icon(Icons.Outlined.ArrowBack, contentDescription = "رجوع")
                                }
                            },
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = KunColors.Chrome,
                                titleContentColor = Color.White,
                                navigationIconContentColor = Color.White
                            )
                        )
                    }
                ) { padding ->
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        contentPadding = PaddingValues(14.dp),
                        verticalArrangement = Arrangement.spacedBy(9.dp)
                    ) {
                        items(NATIVE_CLIENT_SECTIONS, key = { it.name }) { section ->
                            Card(
                                modifier = Modifier.fillMaxWidth().clickable { selected = section },
                                shape = RoundedCornerShape(18.dp),
                                colors = CardDefaults.cardColors(containerColor = KunColors.Surface)
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 15.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Surface(shape = RoundedCornerShape(13.dp), color = KunColors.PineSoft) {
                                        Box(Modifier.size(43.dp), contentAlignment = Alignment.Center) {
                                            Icon(Icons.Outlined.GridView, contentDescription = null, tint = KunColors.Pine)
                                        }
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(section.label, fontWeight = FontWeight.Bold, color = KunColors.Ink)
                                        Text(section.description, style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                NativeClientSectionScreen(
                    section = selected!!,
                    onBack = { selected = null },
                    onClose = onDismiss
                )
            }
        }
    }
}

@Composable
private fun NativeClientSectionScreen(
    section: NativeClientSection,
    onBack: () -> Unit,
    onClose: () -> Unit
) {
    when (section) {
        NativeClientSection.PRINTING -> NativePrintingScreen(onBack)
        NativeClientSection.FINANCE -> NativeFinanceScreen(onBack)
        NativeClientSection.ACCOUNTING -> NativeAccountingScreen(onBack)
        NativeClientSection.CAMPAIGNS -> NativeCampaignsScreen(onBack)
        NativeClientSection.INVENTORY -> NativeInventoryScreen(onBack)
        NativeClientSection.WALLET -> NativeWalletScreen(onBack)
        NativeClientSection.INTEGRATIONS -> NativeIntegrationsScreen(onBack)
        NativeClientSection.SETTINGS -> NativeSettingsScreen(onBack, onClose)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeSectionScaffold(
    title: String,
    subtitle: String,
    onBack: () -> Unit,
    onRefresh: (() -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit
) {
    Scaffold(
        containerColor = KunColors.Ground,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(subtitle, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = .72f))
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    if (onRefresh != null) {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Outlined.Refresh, contentDescription = "تحديث")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = KunColors.Chrome,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        content = content
    )
}

@Composable
private fun NativeBusy(padding: PaddingValues, message: String = "جاري تحميل البيانات...") {
    Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator(color = KunColors.Pine)
            Text(message, color = KunColors.Ink2)
        }
    }
}

@Composable
private fun NativeError(padding: PaddingValues, message: String, retry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(padding).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        KunSectionCard {
            Text("تعذر تحميل القسم", fontWeight = FontWeight.Bold, color = KunColors.Brick)
            Text(message, color = KunColors.Ink2)
            Button(onClick = retry, modifier = Modifier.fillMaxWidth()) { Text("إعادة المحاولة") }
        }
    }
}

@Composable
private fun NativeMetricRow(items: List<Pair<String, String>>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { item ->
                    KunInfoCard(item.first, item.second, Modifier.weight(1f))
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun NativeSimpleRow(
    title: String,
    subtitle: String,
    trailing: String = "",
    onClick: (() -> Unit)? = null
) {
    val modifier = if (onClick != null) Modifier.fillMaxWidth().clickable(onClick = onClick) else Modifier.fillMaxWidth()
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
        shape = RoundedCornerShape(15.dp)
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title.ifBlank { "—" }, fontWeight = FontWeight.Bold, color = KunColors.Ink)
                if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
            }
            if (trailing.isNotBlank()) {
                Spacer(Modifier.width(10.dp))
                Text(trailing, fontWeight = FontWeight.Bold, color = KunColors.Pine)
            }
        }
    }
}

@Composable
private fun NativePrintingScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var orders by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var sendingId by remember { mutableStateOf("") }
    var confirmOrder by remember { mutableStateOf<JSONObject?>(null) }

    fun load() { refresh++ }

    LaunchedEffect(refresh) {
        loading = true
        error = ""
        val result = withContext(Dispatchers.IO) { NativeSectionsApi.printing(context) }
        if (result.ok) {
            orders = (result.obj?.optJSONArray("orders") ?: result.array ?: JSONArray()).objects()
        } else error = result.message
        loading = false
    }

    fun send(order: JSONObject) {
        val orderId = order.str("id")
        if (orderId.isBlank() || sendingId.isNotBlank()) return
        sendingId = orderId
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                val queued = NativeSectionsApi.queueJt(context, orderId, order.str("storeId", "store_id"))
                if (!queued.ok) queued else NativeSectionsApi.printJt(context, orderId, order.str("storeId", "store_id"))
            }
            sendingId = ""
            if (result.ok) {
                val url = result.obj?.optString("url").orEmpty()
                val awb = result.obj?.optString("awb").orEmpty()
                Toast.makeText(context, if (awb.isBlank()) "تم إرسال الأوردر إلى J&T" else "تم إنشاء AWB: $awb", Toast.LENGTH_LONG).show()
                if (url.isNotBlank()) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                load()
            } else {
                Toast.makeText(context, result.message.ifBlank { "تعذر الإرسال إلى J&T" }, Toast.LENGTH_LONG).show()
            }
        }
    }

    if (confirmOrder != null) {
        AlertDialog(
            onDismissRequest = { confirmOrder = null },
            title = { Text("إرسال إلى J&T") },
            text = { Text("سيتم إنشاء الشحنة فعليًا لدى J&T ثم طلب البوليصة الرسمية ونقل الأوردر إلى جاري الشحن بعد النجاح.") },
            confirmButton = {
                Button(onClick = {
                    val order = confirmOrder
                    confirmOrder = null
                    if (order != null) send(order)
                }) { Text("إرسال وطباعة") }
            },
            dismissButton = { TextButton(onClick = { confirmOrder = null }) { Text("إلغاء") } }
        )
    }

    NativeSectionScaffold("الطباعة", "Native · J&T Create Order + Print", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() -> NativeError(padding, error, ::load)
            else -> {
                val waiting = orders.filterNot { it.isPrintedOrder() }
                val printed = orders.filter { it.isPrintedOrder() }
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    item {
                        NativeMetricRow(listOf(
                            "في انتظار الإرسال" to waiting.size.toString(),
                            "تم الإرسال" to printed.size.toString()
                        ))
                    }
                    item {
                        Text("في انتظار الطباعة", style = MaterialTheme.typography.titleMedium, color = KunColors.Ink)
                    }
                    if (waiting.isEmpty()) item { KunSectionCard { Text("لا توجد أوردرات مؤكدة في انتظار الطباعة.", color = KunColors.Ink2) } }
                    items(waiting, key = { it.str("id") }) { order ->
                        KunSectionCard {
                            Text(order.str("name").ifBlank { "بدون اسم" }, fontWeight = FontWeight.Bold)
                            Text("#${order.str("ref", "id")} · ${order.str("product").ifBlank { "بدون منتج" }}", color = KunColors.Ink2)
                            Text(order.str("street", "address").ifBlank { "العنوان غير مكتمل" }, color = KunColors.Ink2)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = {
                                        val id = order.str("id")
                                        if (id.isNotBlank()) context.startActivity(
                                            Intent(context, CallerJntOrderEditActivity::class.java)
                                                .putExtra(CallerJntOrderEditActivity.EXTRA_ORDER_ID, id)
                                        )
                                    },
                                    modifier = Modifier.weight(1f)
                                ) { Text("بيانات J&T") }
                                Button(
                                    onClick = { confirmOrder = order },
                                    enabled = sendingId.isBlank(),
                                    modifier = Modifier.weight(1f)
                                ) { Text(if (sendingId == order.str("id")) "جاري الإرسال..." else "إرسال وطباعة") }
                            }
                        }
                    }
                    if (printed.isNotEmpty()) {
                        item { Text("تم الإرسال والطباعة", style = MaterialTheme.typography.titleMedium, color = KunColors.Ink) }
                        items(printed, key = { "printed-" + it.str("id") }) { order ->
                            NativeSimpleRow(
                                title = order.str("name").ifBlank { order.str("ref", "id") },
                                subtitle = order.str("product"),
                                trailing = order.str("awb").ifBlank { "تم" }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeFinanceScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<Map<String, NativeSectionResult>>(emptyMap()) }

    fun load() { refresh++ }
    LaunchedEffect(refresh) {
        loading = true
        val result = withContext(Dispatchers.IO) { NativeSectionsApi.finance(context) }
        data = result
        error = result.values.firstOrNull { !it.ok }?.message.orEmpty()
        loading = false
    }

    NativeSectionScaffold("المالية", "Native · بيانات مالية مباشرة من السيستم", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() && data["dashboard"]?.ok != true -> NativeError(padding, error, ::load)
            else -> {
                val overview = data["overview"]?.obj ?: JSONObject()
                val collected = data["collected"]?.obj ?: JSONObject()
                val entries = data["entries"].rows("entries")
                val currency = overview.str("currency").ifBlank { collected.str("currency").ifBlank { "EGP" } }
                val collectedValue = firstNumber(collected, "collectedProfit", "collected", "amount", "total")
                    ?: nestedNumber(overview, "sales", "collectedRevenue")
                val netCash = firstNumber(overview, "netCash") ?: nestedNumber(overview, "cash", "netCash")
                val manualIncome = firstNumber(overview, "manualIncome") ?: nestedNumber(overview, "profit", "otherIncome")
                val manualExpenses = firstNumber(overview, "manualExpenses") ?: nestedNumber(overview, "costs", "general")

                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    item {
                        NativeMetricRow(listOf(
                            "المحصل فعليًا" to money(collectedValue, currency),
                            "صافي التدفق" to money(netCash, currency),
                            "إيرادات يدوية" to money(manualIncome, currency),
                            "مصروفات يدوية" to money(manualExpenses, currency)
                        ))
                    }
                    item { Text("آخر الحركات", style = MaterialTheme.typography.titleMedium) }
                    if (entries.isEmpty()) item { KunSectionCard { Text("لا توجد حركات محاسبية حديثة.", color = KunColors.Ink2) } }
                    items(entries.take(60), key = { it.str("id").ifBlank { it.toString() } }) { entry ->
                        NativeSimpleRow(
                            title = entry.str("category", "type").ifBlank { "حركة مالية" },
                            subtitle = listOf(entry.str("date", "created_at"), entry.str("note")).filter { it.isNotBlank() }.joinToString(" · "),
                            trailing = money(firstNumber(entry, "amount", "value"), currency)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeAccountingScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<Map<String, NativeSectionResult>>(emptyMap()) }
    var stores by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var showAdd by remember { mutableStateOf(false) }

    fun load() { refresh++ }
    LaunchedEffect(refresh) {
        loading = true
        val pair = withContext(Dispatchers.IO) {
            NativeSectionsApi.accounting(context) to NativeSectionsApi.stores(context)
        }
        data = pair.first
        stores = pair.second.obj?.optJSONArray("stores")?.objects().orEmpty()
        error = pair.first.values.firstOrNull { !it.ok }?.message.orEmpty()
        loading = false
    }

    if (showAdd) {
        AccountingEntryDialog(
            catalog = data["catalog"]?.obj ?: JSONObject(),
            stores = stores,
            fixedStoreId = NativeSectionsApi.scope(context).storeId,
            onDismiss = { showAdd = false },
            onSaved = {
                showAdd = false
                load()
            }
        )
    }

    NativeSectionScaffold("الحسابات والحركات", "Native · قراءة وتسجيل الحركات", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() && data["overview"]?.ok != true -> NativeError(padding, error, ::load)
            else -> {
                val overview = data["overview"]?.obj ?: JSONObject()
                val entries = data["entries"].rows("entries")
                val currency = overview.str("currency").ifBlank { "EGP" }
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { showAdd = true }, modifier = Modifier.weight(1f)) { Text("+ تسجيل حركة") }
                            OutlinedButton(onClick = ::load, modifier = Modifier.weight(1f)) { Text("تحديث") }
                        }
                    }
                    item {
                        NativeMetricRow(listOf(
                            "صافي التدفق" to money(firstNumber(overview, "netCash"), currency),
                            "إجمالي الإيرادات" to money(firstNumber(overview, "manualIncome", "income"), currency),
                            "إجمالي المصروفات" to money(firstNumber(overview, "manualExpenses", "expenses"), currency),
                            "عدد الحركات" to entries.size.toString()
                        ))
                    }
                    item { Text("الحركات", style = MaterialTheme.typography.titleMedium) }
                    if (entries.isEmpty()) item { KunSectionCard { Text("لا توجد حركات مسجلة.", color = KunColors.Ink2) } }
                    items(entries, key = { it.str("id").ifBlank { it.toString() } }) { entry ->
                        NativeSimpleRow(
                            title = entry.str("category").ifBlank { if (entry.str("type") == "income") "إيراد" else "مصروف" },
                            subtitle = listOf(entry.str("date", "created_at"), entry.str("counterparty"), entry.str("note")).filter { it.isNotBlank() }.joinToString(" · "),
                            trailing = money(firstNumber(entry, "amount"), currency)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AccountingEntryDialog(
    catalog: JSONObject,
    stores: List<JSONObject>,
    fixedStoreId: String,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val categories = catalog.optJSONArray("categories")?.strings().orEmpty()
    val methods = catalog.optJSONArray("methods")?.strings().orEmpty()
    var storeId by remember { mutableStateOf(fixedStoreId.ifBlank { if (stores.size == 1) stores.first().str("id") else "" }) }
    var type by remember { mutableStateOf("expense") }
    var category by remember { mutableStateOf(categories.firstOrNull().orEmpty()) }
    var amount by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(methods.firstOrNull().orEmpty()) }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var counterparty by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }

    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(20.dp), color = KunColors.Surface) {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().heightIn(max = 650.dp),
                contentPadding = PaddingValues(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item { Text("تسجيل حركة محاسبية", style = MaterialTheme.typography.titleLarge) }
                if (fixedStoreId.isBlank()) item {
                    NativeChoiceField(
                        label = "المتجر / الفرع",
                        value = stores.firstOrNull { it.str("id") == storeId }?.str("name", "code", "id").orEmpty(),
                        options = stores.map { it.str("id") to it.str("name", "code", "id") },
                        onSelected = { storeId = it }
                    )
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { type = "expense" }, modifier = Modifier.weight(1f)) { Text(if (type == "expense") "✓ مصروف" else "مصروف") }
                        FilledTonalButton(onClick = { type = "income" }, modifier = Modifier.weight(1f)) { Text(if (type == "income") "✓ إيراد" else "إيراد") }
                    }
                }
                item { OutlinedTextField(category, { category = it }, label = { Text("البند") }, modifier = Modifier.fillMaxWidth()) }
                item {
                    OutlinedTextField(
                        amount,
                        { amount = it },
                        label = { Text("المبلغ") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                item { OutlinedTextField(method, { method = it }, label = { Text("طريقة الدفع") }, modifier = Modifier.fillMaxWidth()) }
                item { OutlinedTextField(date, { date = it }, label = { Text("التاريخ YYYY-MM-DD") }, modifier = Modifier.fillMaxWidth()) }
                item { OutlinedTextField(counterparty, { counterparty = it }, label = { Text("الجهة / الطرف المقابل") }, modifier = Modifier.fillMaxWidth()) }
                item { OutlinedTextField(note, { note = it }, label = { Text("البيان") }, minLines = 2, modifier = Modifier.fillMaxWidth()) }
                if (message.isNotBlank()) item { Text(message, color = KunColors.Brick) }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("إلغاء") }
                        Button(
                            onClick = {
                                val value = amount.toDoubleOrNull()
                                if (storeId.isBlank()) { message = "اختر المتجر أو الفرع"; return@Button }
                                if (value == null || value <= 0) { message = "اكتب مبلغ أكبر من صفر"; return@Button }
                                saving = true
                                scope.launch {
                                    val payload = JSONObject()
                                        .put("storeId", storeId)
                                        .put("type", type)
                                        .put("category", category)
                                        .put("amount", value)
                                        .put("method", method)
                                        .put("date", date)
                                        .put("counterparty", counterparty)
                                        .put("note", note)
                                    val result = withContext(Dispatchers.IO) { NativeSectionsApi.addAccountingEntry(context, payload) }
                                    saving = false
                                    if (result.ok) {
                                        Toast.makeText(context, "تم تسجيل الحركة", Toast.LENGTH_SHORT).show()
                                        onSaved()
                                    } else message = result.message
                                }
                            },
                            enabled = !saving,
                            modifier = Modifier.weight(1f)
                        ) { Text(if (saving) "جاري الحفظ..." else "حفظ") }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeInventoryScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<Map<String, NativeSectionResult>>(emptyMap()) }
    var showAdjust by remember { mutableStateOf(false) }

    fun load() { refresh++ }
    LaunchedEffect(refresh) {
        loading = true
        data = withContext(Dispatchers.IO) { NativeSectionsApi.inventory(context) }
        error = data.values.firstOrNull { !it.ok }?.message.orEmpty()
        loading = false
    }

    val products = data["state"]?.obj?.optJSONArray("products")?.objects().orEmpty()
    val suppliers = data["suppliers"].rows()
    if (showAdjust) {
        InventoryAdjustDialog(products, suppliers, onDismiss = { showAdjust = false }, onSaved = {
            showAdjust = false
            load()
        })
    }

    NativeSectionScaffold("المخزون", "Native · المنتجات وحركات المخزون", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() && data["state"]?.ok != true -> NativeError(padding, error, ::load)
            else -> {
                val log = data["log"].rows("entries")
                val low = products.count { (firstNumber(it, "stock") ?: 0.0) <= (firstNumber(it, "lowStockThreshold", "low_stock_threshold") ?: 5.0) }
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    item {
                        NativeMetricRow(listOf(
                            "المنتجات" to products.size.toString(),
                            "مخزون منخفض" to low.toString()
                        ))
                    }
                    item { Button(onClick = { showAdjust = true }, modifier = Modifier.fillMaxWidth()) { Text("+ إضافة / تسوية مخزون") } }
                    item { Text("المنتجات", style = MaterialTheme.typography.titleMedium) }
                    items(products, key = { it.str("id").ifBlank { it.toString() } }) { product ->
                        NativeSimpleRow(
                            title = product.str("name").ifBlank { product.str("sku") },
                            subtitle = listOf(product.str("sku"), product.str("category")).filter { it.isNotBlank() }.joinToString(" · "),
                            trailing = "المتاح ${moneyPlain(firstNumber(product, "stock"))}"
                        )
                    }
                    item { Text("آخر حركات المخزون", style = MaterialTheme.typography.titleMedium) }
                    items(log.take(80), key = { it.str("id").ifBlank { it.toString() } }) { row ->
                        NativeSimpleRow(
                            title = row.str("product_name").ifBlank { "حركة مخزون" },
                            subtitle = listOf(row.str("stock_date", "created_at"), row.str("supplier_name"), row.str("note")).filter { it.isNotBlank() }.joinToString(" · "),
                            trailing = signed(firstNumber(row, "delta"))
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InventoryAdjustDialog(
    products: List<JSONObject>,
    suppliers: List<JSONObject>,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var productId by remember { mutableStateOf(products.firstOrNull()?.str("id").orEmpty()) }
    var supplierId by remember { mutableStateOf("") }
    var delta by remember { mutableStateOf("") }
    var stockDate by remember { mutableStateOf(LocalDate.now().toString()) }
    var note by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }

    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(20.dp), color = KunColors.Surface) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("إضافة / تسوية مخزون", style = MaterialTheme.typography.titleLarge)
                NativeChoiceField(
                    "المنتج",
                    products.firstOrNull { it.str("id") == productId }?.str("name").orEmpty(),
                    products.map { it.str("id") to it.str("name").ifBlank { it.str("sku") } },
                    { productId = it }
                )
                OutlinedTextField(
                    delta,
                    { delta = it },
                    label = { Text("الكمية (+ إضافة / - خصم)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(stockDate, { stockDate = it }, label = { Text("تاريخ المخزون YYYY-MM-DD") }, modifier = Modifier.fillMaxWidth())
                NativeChoiceField(
                    "المورد (اختياري)",
                    suppliers.firstOrNull { it.str("id") == supplierId }?.str("name").orEmpty().ifBlank { "بدون مورد" },
                    listOf("" to "بدون مورد") + suppliers.map { it.str("id") to it.str("name") },
                    { supplierId = it }
                )
                OutlinedTextField(note, { note = it }, label = { Text("السبب / الملاحظة") }, modifier = Modifier.fillMaxWidth())
                if (message.isNotBlank()) Text(message, color = KunColors.Brick)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("إلغاء") }
                    Button(
                        onClick = {
                            val qty = delta.toDoubleOrNull()
                            if (productId.isBlank()) { message = "اختر المنتج"; return@Button }
                            if (qty == null || qty == 0.0) { message = "اكتب كمية غير صفرية"; return@Button }
                            saving = true
                            scope.launch {
                                val result = withContext(Dispatchers.IO) {
                                    NativeSectionsApi.adjustInventory(context, productId, qty, stockDate, supplierId.ifBlank { null }, note)
                                }
                                saving = false
                                if (result.ok) {
                                    Toast.makeText(context, "تم تحديث المخزون", Toast.LENGTH_SHORT).show()
                                    onSaved()
                                } else message = result.message
                            }
                        },
                        enabled = !saving,
                        modifier = Modifier.weight(1f)
                    ) { Text(if (saving) "جاري الحفظ..." else "حفظ") }
                }
            }
        }
    }
}

@Composable
private fun NativeCampaignsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var syncing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var root by remember { mutableStateOf(JSONObject()) }

    fun load() { refresh++ }
    LaunchedEffect(refresh) {
        loading = true
        val result = withContext(Dispatchers.IO) { NativeSectionsApi.campaigns(context) }
        if (result.ok) root = result.obj ?: JSONObject() else error = result.message
        loading = false
    }

    NativeSectionScaffold("الحملات", "Native · Meta Ads + نتائج Kun Online", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() -> NativeError(padding, error, ::load)
            else -> {
                val campaigns = root.optJSONObject("campaigns")?.optJSONArray("rows")?.objects()
                    ?: root.optJSONArray("campaigns")?.objects().orEmpty()
                val active = campaigns.filter { it.str("status").equals("active", true) }
                val spend = active.sumOf { firstNumber(it, "spend") ?: 0.0 }
                val purchases = active.sumOf { firstNumber(it, "platformPurchases", "purchases") ?: 0.0 }
                val realOrders = active.sumOf { firstNumber(it, "realOrders") ?: 0.0 }
                val purchaseValue = active.sumOf { firstNumber(it, "platformPurchaseValue", "purchaseValue") ?: 0.0 }
                val roas = if (spend > 0) purchaseValue / spend else null
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    item {
                        NativeMetricRow(listOf(
                            "Spend" to money(spend, "EGP"),
                            "Meta Purchases" to moneyPlain(purchases),
                            "Platform ROAS" to (roas?.let { String.format(Locale.US, "%.2fx", it) } ?: "—"),
                            "Real Orders" to moneyPlain(realOrders)
                        ))
                    }
                    item {
                        Button(
                            onClick = {
                                if (syncing) return@Button
                                syncing = true
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) { NativeSectionsApi.syncCampaigns(context, 30) }
                                    syncing = false
                                    Toast.makeText(context, if (result.ok) "تم تحديث Meta Ads" else result.message, Toast.LENGTH_LONG).show()
                                    if (result.ok) load()
                                }
                            },
                            enabled = !syncing,
                            modifier = Modifier.fillMaxWidth()
                        ) { Text(if (syncing) "جاري مزامنة Meta..." else "مزامنة Meta وتحليل") }
                    }
                    item { Text("الحملات الشغالة", style = MaterialTheme.typography.titleMedium) }
                    if (active.isEmpty()) item { KunSectionCard { Text("لا توجد حملات نشطة أو Meta Ads غير مربوط.", color = KunColors.Ink2) } }
                    items(active, key = { it.str("id", "campaignId", "name") }) { campaign ->
                        NativeSimpleRow(
                            title = campaign.str("name").ifBlank { "حملة" },
                            subtitle = "Spend ${money(firstNumber(campaign, "spend"), "EGP")} · Purchases ${moneyPlain(firstNumber(campaign, "platformPurchases", "purchases"))}",
                            trailing = firstNumber(campaign, "platformRoas", "roas")?.let { String.format(Locale.US, "%.2fx", it) } ?: "—"
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeWalletScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<Map<String, NativeSectionResult>>(emptyMap()) }

    fun load() { refresh++ }
    LaunchedEffect(refresh) {
        loading = true
        error = ""
        data = withContext(Dispatchers.IO) { NativeSectionsApi.wallet(context) }
        error = data["access"]?.takeIf { !it.ok }?.message
            .orEmpty()
            .ifBlank { data["log"]?.takeIf { !it.ok }?.message.orEmpty() }
        loading = false
    }

    NativeSectionScaffold("المحفظة", "Native · نفس إعدادات الخصم الحالية في السيستم", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() && data["access"]?.ok != true -> NativeError(padding, error, ::load)
            else -> {
                // /api/subscription/access is the single source of truth used by v127.
                // Never calculate the client fee from the legacy-compatible /api/wallet fields.
                val access = data["access"]?.obj ?: JSONObject()
                val rows = data["log"].rows("log", "entries")
                val currency = access.str("currency").ifBlank { "EGP" }
                val trial = access.optBoolean("trialActive", false)
                val locked = access.optBoolean("locked", false)
                val balanceEmpty = access.optBoolean("balanceEmpty", false)
                val orderFee = firstNumber(access, "orderFee")
                val monthlyMinimum = firstNumber(access, "monthlyMinimum")
                val balance = firstNumber(access, "balance")
                val status = when {
                    trial -> "فترة مجانية"
                    locked -> "موقوف"
                    balanceEmpty -> "يحتاج شحن رصيد"
                    else -> "نشط"
                }
                val period = listOf(access.str("periodStart"), access.str("periodEnd"))
                    .filter { it.isNotBlank() }
                    .joinToString(" ← ")

                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    item {
                        NativeMetricRow(
                            listOf(
                                "الرصيد الحالي" to money(balance, currency),
                                "رسوم كل أوردر" to if (trial) "مجانًا" else money(orderFee, currency),
                                "الحد الأدنى الشهري" to if (trial) "مجانًا" else money(monthlyMinimum, currency),
                                "الحالة" to status
                            )
                        )
                    }
                    item {
                        KunSectionCard {
                            Text("إعدادات الخصم الحالية", fontWeight = FontWeight.Bold)
                            Text(
                                if (trial) {
                                    "الفترة المجانية فعالة حتى ${access.str("trialEndsAt").ifBlank { "—" }}؛ لا يتم خلالها خصم رسوم شهرية أو رسوم على الأوردرات."
                                } else {
                                    "يتم احتساب خصم الأوردر من قيمة «رسوم كل أوردر» الظاهرة هنا، والحد الأدنى الشهري من إعداد الاشتراك الحالي في السيستم."
                                },
                                color = KunColors.Ink2
                            )
                            if (period.isNotBlank()) {
                                Text("فترة الحساب الحالية: $period", style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                            }
                        }
                    }
                    if (balanceEmpty || locked) {
                        item {
                            KunSectionCard {
                                Text("حالة الرصيد", fontWeight = FontWeight.Bold, color = if (locked) KunColors.Brick else KunColors.Ink)
                                Text(
                                    when {
                                        locked -> "الحساب موقوف من إعدادات الاشتراك أو المحفظة."
                                        else -> "الرصيد يحتاج شحن، لكن أقسام النظام تظل متاحة. العمليات التي تحتاج خصمًا قد تنتظر حتى يتم شحن الرصيد."
                                    },
                                    color = KunColors.Ink2
                                )
                            }
                        }
                    }
                    item { Text("سجل الرصيد والخصومات", style = MaterialTheme.typography.titleMedium) }
                    if (rows.isEmpty()) {
                        item { KunSectionCard { Text("لا توجد حركات محفظة.", color = KunColors.Ink2) } }
                    }
                    items(rows, key = { it.str("id").ifBlank { it.toString() } }) { row ->
                        val type = row.str("type")
                        val amount = firstNumber(row, "amount")
                        NativeSimpleRow(
                            title = row.str("note").ifBlank { if (type == "deduct") "خصم" else if (type == "credit") "إضافة رصيد" else "حركة محفظة" },
                            subtitle = listOf(
                                row.str("created_at"),
                                firstNumber(row, "balance_after")?.let { "الرصيد بعدها ${money(it, currency)}" }.orEmpty()
                            ).filter { it.isNotBlank() }.joinToString(" · "),
                            trailing = when {
                                amount == null -> "—"
                                type == "deduct" -> "− ${money(amount, currency)}"
                                else -> "+ ${money(amount, currency)}"
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeIntegrationsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }

    fun load() { refresh++ }
    LaunchedEffect(refresh) {
        loading = true
        val result = withContext(Dispatchers.IO) { NativeSectionsApi.integrations(context) }
        if (result.ok) rows = (result.array ?: result.obj?.optJSONArray("providers") ?: JSONArray()).objects() else error = result.message
        loading = false
    }

    if (editing != null) {
        IntegrationSetupDialog(editing!!, onDismiss = { editing = null }, onSaved = {
            editing = null
            load()
        })
    }

    NativeSectionScaffold("مركز التكاملات", "Native · ربط واختبار المزودين", onBack, ::load) { padding ->
        when {
            loading -> NativeBusy(padding)
            error.isNotBlank() -> NativeError(padding, error, ::load)
            else -> {
                val connected = rows.count { it.str("readiness") == "connected" }
                val needs = rows.count { it.str("readiness") == "needs_secrets" }
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    item { NativeMetricRow(listOf("متصل" to connected.toString(), "يحتاج إعداد" to needs.toString())) }
                    items(rows, key = { it.str("id") }) { row ->
                        val connection = row.optJSONObject("connection")
                        NativeSimpleRow(
                            title = row.str("name").ifBlank { row.str("id") },
                            subtitle = listOf(
                                readinessLabel(row.str("readiness")),
                                connection?.str("store_name", "external_store_id").orEmpty(),
                                row.optJSONArray("missingSecrets")?.strings()?.takeIf { it.isNotEmpty() }?.joinToString("، ")?.let { "ناقص: $it" }.orEmpty()
                            ).filter { it.isNotBlank() }.joinToString(" · "),
                            trailing = if (connection == null) "ربط" else "إدارة",
                            onClick = { editing = row }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun IntegrationSetupDialog(
    row: JSONObject,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val providerId = row.str("id")
    val connection = row.optJSONObject("connection")
    val required = row.optJSONArray("requiredSecrets")?.strings().orEmpty()
    val missing = row.optJSONArray("missingSecrets")?.strings().orEmpty().toSet()
    val secrets = remember(providerId) { mutableStateMapOf<String, String>() }
    var storeName by remember { mutableStateOf(connection?.str("store_name").orEmpty().ifBlank { row.str("name") }) }
    var adAccountId by remember { mutableStateOf(connection?.str("ad_account_id").orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(18.dp),
            shape = RoundedCornerShape(22.dp),
            color = KunColors.Surface
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().heightIn(max = 700.dp),
                contentPadding = PaddingValues(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item { Text("إعداد ${row.str("name").ifBlank { providerId }}", style = MaterialTheme.typography.titleLarge) }
                item { Text("القيم السرية تُرسل مباشرة للسيرفر وتُحفظ مشفرة ولا يعاد عرضها.", color = KunColors.Ink2) }
                item { OutlinedTextField(storeName, { storeName = it }, label = { Text("اسم المتجر / الحساب") }, modifier = Modifier.fillMaxWidth()) }
                if (providerId == "meta_ads") item {
                    OutlinedTextField(adAccountId, { adAccountId = it.removePrefix("act_") }, label = { Text("Meta Ad Account ID") }, modifier = Modifier.fillMaxWidth())
                }
                items(required, key = { it }) { secret ->
                    OutlinedTextField(
                        value = secrets[secret].orEmpty(),
                        onValueChange = { secrets[secret] = it },
                        label = { Text(secretLabel(secret) + if (secret in missing) " *" else " — محفوظ") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (message.isNotBlank()) item { Text(message, color = if (message.startsWith("تم")) KunColors.Pine else KunColors.Brick) }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("إلغاء") }
                        Button(
                            onClick = {
                                if (providerId == "meta_ads" && adAccountId.isBlank()) {
                                    message = "اكتب رقم الحساب الإعلاني"
                                    return@Button
                                }
                                saving = true
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) {
                                        var connectionId = connection?.str("id").orEmpty()
                                        if (connectionId.isBlank()) {
                                            val created = NativeSectionsApi.createIntegration(context, providerId, storeName)
                                            if (!created.ok) return@withContext created
                                            connectionId = created.obj?.optString("id").orEmpty()
                                            if (connectionId.isBlank()) return@withContext NativeSectionResult(false, "تعذر إنشاء الربط")
                                        }
                                        for ((secret, value) in secrets) {
                                            if (value.isBlank()) continue
                                            val saved = NativeSectionsApi.saveIntegrationSecret(context, connectionId, secret, value.trim())
                                            if (!saved.ok) return@withContext saved
                                        }
                                        val payload = JSONObject()
                                        if (providerId == "meta_ads") payload.put("adAccountId", adAccountId)
                                        val validated = NativeSectionsApi.validateIntegration(context, connectionId, payload)
                                        if (!validated.ok) return@withContext validated
                                        if (providerId == "jt") {
                                            val jt = NativeSectionsApi.validateJt(context)
                                            if (!jt.ok) return@withContext jt
                                        }
                                        validated
                                    }
                                    saving = false
                                    if (result.ok) {
                                        Toast.makeText(context, result.message.ifBlank { "تم حفظ واختبار الربط" }, Toast.LENGTH_LONG).show()
                                        onSaved()
                                    } else message = result.message
                                }
                            },
                            enabled = !saving,
                            modifier = Modifier.weight(1f)
                        ) { Text(if (saving) "جاري الحفظ..." else "حفظ واختبار") }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeSettingsScreen(onBack: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var syncing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf(false) }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("تسجيل الخروج") },
            text = { Text("سيتم إنهاء جلسة كن أونلاين على هذا الهاتف.") },
            confirmButton = {
                Button(onClick = {
                    confirmLogout = false
                    KunApi.logout(context)
                    onClose()
                }) { Text("تسجيل الخروج") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("إلغاء") } }
        )
    }

    NativeSectionScaffold("الإعدادات", "Native · إعدادات التطبيق والمزامنة", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                KunSectionCard {
                    Text("حالة الاتصال", fontWeight = FontWeight.Bold)
                    KunStatusDot(KunApi.hasSession(context), if (KunApi.hasSession(context)) "الجلسة متصلة بالسيستم" else "لا توجد جلسة")
                    if (status.isNotBlank()) Text(status, color = KunColors.Ink2)
                }
            }
            item {
                Button(
                    onClick = {
                        syncing = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { KunApi.fetchState(context, forceFull = true) }
                            syncing = false
                            status = result.message
                        }
                    },
                    enabled = !syncing,
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (syncing) "جاري المزامنة..." else "مزامنة كاملة الآن") }
            }
            item {
                OutlinedButton(
                    onClick = {
                        val uri = Uri.parse("package:${context.packageName}")
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri))
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("إعدادات وصلاحيات التطبيق") }
            }
            item {
                OutlinedButton(onClick = { confirmLogout = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("تسجيل الخروج", color = KunColors.Brick)
                }
            }
        }
    }
}

@Composable
private fun NativeChoiceField(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    onSelected: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = KunColors.Ink2)
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text(value.ifBlank { "اختر" }, modifier = Modifier.weight(1f))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, name) ->
                DropdownMenuItem(
                    text = { Text(name.ifBlank { id }) },
                    onClick = {
                        expanded = false
                        onSelected(id)
                    }
                )
            }
        }
    }
}

private fun NativeSectionResult?.rows(vararg keys: String): List<JSONObject> {
    if (this == null || !ok) return emptyList()
    array?.let { return it.objects() }
    for (key in keys) obj?.optJSONArray(key)?.let { return it.objects() }
    return emptyList()
}

private fun JSONArray.objects(): List<JSONObject> = buildList {
    for (i in 0 until length()) optJSONObject(i)?.let(::add)
}

private fun JSONArray.strings(): List<String> = buildList {
    for (i in 0 until length()) {
        val value = optString(i).trim()
        if (value.isNotBlank()) add(value)
    }
}

private fun JSONObject.str(vararg keys: String): String {
    for (key in keys) {
        val value = optString(key, "").trim()
        if (value.isNotBlank() && value != "null") return value
    }
    return ""
}

private fun firstNumber(obj: JSONObject, vararg keys: String): Double? {
    for (key in keys) {
        if (!obj.has(key) || obj.isNull(key)) continue
        val raw = obj.opt(key)
        val value = when (raw) {
            is Number -> raw.toDouble()
            else -> raw?.toString()?.toDoubleOrNull()
        }
        if (value != null) return value
    }
    return null
}

private fun nestedNumber(obj: JSONObject, parent: String, key: String): Double? =
    obj.optJSONObject(parent)?.let { firstNumber(it, key) }

private fun money(value: Double?, currency: String = "EGP"): String =
    value?.let { "${NumberFormat.getNumberInstance(Locale("ar", "EG")).format(it)} ${if (currency.equals("EGP", true)) "ج.م" else currency}" } ?: "—"

private fun moneyPlain(value: Double?): String =
    value?.let { NumberFormat.getNumberInstance(Locale("ar", "EG")).format(it) } ?: "—"

private fun signed(value: Double?): String = when {
    value == null -> "—"
    value > 0 -> "+${moneyPlain(value)}"
    else -> moneyPlain(value)
}

private fun JSONObject.isPrintedOrder(): Boolean {
    if (optBoolean("printed", false)) return true
    val state = str("state", "checkpoint").lowercase()
    val awb = str("awb")
    return awb.isNotBlank() && (state.contains("shipping") || state.contains("shipped") || state.contains("signed") || state.contains("جاري"))
}

private fun readinessLabel(value: String): String = when (value) {
    "connected" -> "متصل"
    "needs_secrets" -> "يحتاج بيانات ربط"
    "configured" -> "مُعدّ ويحتاج تأكيد"
    "disconnected" -> "غير متصل"
    else -> value.ifBlank { "غير متصل" }
}

private fun secretLabel(value: String): String = when (value) {
    "api_account" -> "API Account"
    "private_key" -> "Private Key"
    "source_code" -> "Source Code"
    "customer_code" -> "Customer Code"
    "customer_password" -> "Customer Password"
    "api_key" -> "API Key"
    "access_token" -> "Access Token"
    "verify_token" -> "Verify Token"
    "consumer_key" -> "Consumer Key"
    "consumer_secret" -> "Consumer Secret"
    "page_access_token" -> "Page Access Token"
    "developer_token" -> "Developer Token"
    "refresh_token" -> "Refresh Token"
    "client_id" -> "Client ID"
    "client_secret" -> "Client Secret"
    else -> value
}
