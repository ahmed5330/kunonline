package com.kunonline.callerid

import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.isUnspecified
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.times
import androidx.compose.ui.unit.div
import androidx.compose.ui.unit.minus
import androidx.compose.ui.unit.plus
import androidx.compose.ui.unit.takeOrElse
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.coerceAtMost
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.constrainSize
import androidx.compose.ui.unit.offset
import androidx.compose.ui.unit.round
import androidx.compose.ui.unit.roundToPx
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.LocalLayoutDirection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KunNativeApp(activity: MainActivity) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    var loggedIn by remember { mutableStateOf(KunApi.hasSession(context)) }
    var snapshot by remember { mutableStateOf<CommerceSnapshot?>(null) }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(AppSection.DASHBOARD) }
    var createMode by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        if (!loggedIn || loading) return
        loading = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { KunApi.fetchState(context) }
            loading = false
            message = result.message
            if (result.ok) snapshot = result.snapshot else if (!KunApi.hasSession(context)) loggedIn = false
        }
    }

    LaunchedEffect(loggedIn) {
        if (loggedIn) refresh()
    }

    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme {
            if (!loggedIn) {
                LoginScreen(
                    busy = loading,
                    message = message,
                    onLogin = { email, password ->
                        loading = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { KunApi.loginAndSync(context, email, password) }
                            loading = false
                            message = result.message
                            if (result.ok) {
                                loggedIn = true
                                SyncJobService.schedule(context)
                            }
                        }
                    }
                )
                return@MaterialTheme
            }

            ModalNavigationDrawer(
                drawerState = drawerState,
                drawerContent = {
                    ModalDrawerSheet(modifier = Modifier.widthIn(max = 340.dp)) {
                        Text("kun online", modifier = Modifier.padding(20.dp), fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        HorizontalDivider()
                        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                            SectionGroup.entries.forEach { group ->
                                item {
                                    Text(
                                        group.label,
                                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                                items(AppSection.entries.filter { it.group == group }) { section ->
                                    NavigationDrawerItem(
                                        label = { Text(section.label) },
                                        selected = selected == section,
                                        onClick = {
                                            selected = section
                                            scope.launch { drawerState.close() }
                                        },
                                        modifier = Modifier.padding(horizontal = 12.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            ) {
                Scaffold(
                    topBar = {
                        TopAppBar(
                            title = { Text(selected.label, maxLines = 1) },
                            navigationIcon = {
                                IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                    Icon(Icons.Outlined.Menu, contentDescription = "القائمة")
                                }
                            },
                            actions = {
                                IconButton(onClick = { refresh() }, enabled = !loading) {
                                    Icon(Icons.Outlined.Refresh, contentDescription = "تحديث")
                                }
                            }
                        )
                    },
                    bottomBar = {
                        NavigationBar {
                            bottomSections.forEach { section ->
                                NavigationBarItem(
                                    selected = selected == section,
                                    onClick = { selected = section },
                                    icon = { Icon(sectionIcon(section), contentDescription = null) },
                                    label = { Text(bottomLabel(section), maxLines = 1) }
                                )
                            }
                            NavigationBarItem(
                                selected = selected !in bottomSections,
                                onClick = { scope.launch { drawerState.open() } },
                                icon = { Icon(Icons.Outlined.MoreHoriz, contentDescription = null) },
                                label = { Text("المزيد") }
                            )
                        }
                    },
                    floatingActionButton = {
                        if (selected in setOf(AppSection.DASHBOARD, AppSection.ORDERS, AppSection.CUSTOMERS, AppSection.PRODUCTS, AppSection.INVENTORY)) {
                            ExtendedFloatingActionButton(
                                onClick = { createMode = "menu" },
                                icon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                                text = { Text("إنشاء") }
                            )
                        }
                    }
                ) { padding ->
                    Box(Modifier.fillMaxSize().padding(padding)) {
                        val data = snapshot
                        if (data == null && loading) {
                            CircularProgressIndicator(Modifier.align(Alignment.Center))
                        } else {
                            SectionContent(
                                section = selected,
                                snapshot = data ?: CommerceSnapshot(),
                                activity = activity,
                                onRefresh = { refresh() },
                                onQuickCreate = { createMode = it }
                            )
                        }
                        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
                    }
                }
            }

            if (createMode != null) {
                QuickCreateDialog(
                    mode = createMode!!,
                    snapshot = snapshot ?: CommerceSnapshot(),
                    onMode = { createMode = it },
                    onDismiss = { createMode = null },
                    onSubmit = { mode, payload, productId, delta, note ->
                        scope.launch {
                            loading = true
                            val result = withContext(Dispatchers.IO) {
                                when (mode) {
                                    "order" -> KunApi.createOrder(context, payload)
                                    "customer" -> KunApi.createCustomer(context, payload)
                                    "product" -> KunApi.createProduct(context, payload)
                                    "stock" -> KunApi.adjustStock(context, productId.orEmpty(), delta ?: 0.0, note.orEmpty())
                                    else -> ActionResult(false, "عملية غير معروفة")
                                }
                            }
                            loading = false
                            message = result.message
                            if (result.ok) {
                                createMode = null
                                refresh()
                            }
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun LoginScreen(busy: Boolean, message: String, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center
    ) {
        Text("kun online", fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Commerce OS — تطبيق Android حقيقي", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(email, { email = it }, label = { Text("الإيميل") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, label = { Text("كلمة المرور") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(18.dp))
        Button(
            onClick = { onLogin(email.trim(), password) },
            enabled = !busy && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) { Text(if (busy) "جاري الدخول..." else "تسجيل الدخول") }
        if (message.isNotBlank()) Text(message, modifier = Modifier.padding(top = 16.dp))
    }
}

@Composable
private fun SectionContent(
    section: AppSection,
    snapshot: CommerceSnapshot,
    activity: MainActivity,
    onRefresh: () -> Unit,
    onQuickCreate: (String) -> Unit
) {
    when (section) {
        AppSection.DASHBOARD -> DashboardScreen(snapshot, onQuickCreate)
        AppSection.ORDERS -> OrdersScreen(snapshot.orders)
        AppSection.CUSTOMER_SERVICE -> CustomerServiceScreen(snapshot.orders)
        AppSection.CUSTOMERS -> CustomersScreen(snapshot.customers)
        AppSection.PRODUCTS -> ProductsScreen(snapshot.products, false, onQuickCreate)
        AppSection.INVENTORY -> ProductsScreen(snapshot.products, true, onQuickCreate)
        AppSection.SHIPPING -> OrdersScreen(snapshot.orders.filter { it.state.contains("ship", true) || it.checkpoint.contains("ship", true) }, "الشحن")
        AppSection.POST_SHIPPING -> OrdersScreen(snapshot.orders.filter { it.state in setOf("shipped", "collected", "تم الشحن", "تم التحصيل") }, "ما بعد الشحن")
        AppSection.RETURNS -> OrdersScreen(snapshot.orders.filter { it.state.contains("return", true) || it.state.contains("refund", true) || it.state.contains("مرتجع") }, "المرتجعات والاستبدالات")
        AppSection.PRINTING -> OrdersScreen(snapshot.orders.filter { it.awb.isNotBlank() }, "طلبات جاهزة للطباعة")
        AppSection.SETTINGS -> SettingsScreen(activity, snapshot, onRefresh)
        else -> GenericSectionScreen(section, snapshot)
    }
}

@Composable
private fun DashboardScreen(snapshot: CommerceSnapshot, onQuickCreate: (String) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("نظرة سريعة", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KpiCard("إجمالي الطلبات", snapshot.orders.size.toString(), Modifier.weight(1f))
                KpiCard("إجمالي المبيعات", money(snapshot.totalSales), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KpiCard("تم التأكيد", snapshot.confirmedOrders.toString(), Modifier.weight(1f))
                KpiCard("جاري الشحن", snapshot.shippingOrders.toString(), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KpiCard("تم التحصيل", snapshot.collectedOrders.toString(), Modifier.weight(1f))
                KpiCard("مخزون منخفض", snapshot.lowStockProducts.toString(), Modifier.weight(1f))
            }
        }
        item {
            Text("إنشاء سريع", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { onQuickCreate("order") }, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("طلب جديد") }
                FilledTonalButton(onClick = { onQuickCreate("customer") }, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("عميل") }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { onQuickCreate("product") }, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("منتج") }
                FilledTonalButton(onClick = { onQuickCreate("stock") }, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("تسوية مخزون") }
            }
        }
        item {
            Text("أحدث الطلبات", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        items(snapshot.orders.take(8)) { OrderCard(it) }
    }
}

@Composable
private fun KpiCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(16.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun OrdersScreen(orders: List<OrderUi>, title: String = "الطلبات") {
    var query by remember { mutableStateOf("") }
    val filtered = remember(orders, query) {
        if (query.isBlank()) orders else orders.filter {
            listOf(it.ref, it.name, it.phone, it.product, it.gov, it.state).any { v -> v.contains(query, true) }
        }
    }
    Column(Modifier.fillMaxSize()) {
        SearchField(query, { query = it }, "ابحث بالاسم، الرقم، الطلب أو المنتج")
        Text("$title — ${filtered.size}", modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), fontWeight = FontWeight.Bold)
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(filtered, key = { it.id.ifBlank { it.ref + it.phone } }) { OrderCard(it) }
        }
    }
}

@Composable
private fun OrderCard(order: OrderUi) {
    val context = LocalContext.current
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(order.name.ifBlank { "عميل بدون اسم" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text("#${order.ref} • ${statusLabel(order.state)}", style = MaterialTheme.typography.bodySmall)
                }
                Text(money(order.total), fontWeight = FontWeight.Bold)
            }
            if (order.product.isNotBlank()) Text("${order.product} × ${order.qty}", modifier = Modifier.padding(top = 8.dp))
            if (order.gov.isNotBlank()) Text("${order.gov} — ${order.address}", style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (order.phone.isNotBlank()) {
                    OutlinedButton(
                        onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${order.phone}"))) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                    ) { Icon(Icons.Outlined.Call, null); Spacer(Modifier.width(6.dp)); Text("اتصال") }
                }
                if (order.awb.isNotBlank()) {
                    FilledTonalButton(onClick = {}, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("AWB ${order.awb}", maxLines = 1) }
                }
            }
        }
    }
}

@Composable
private fun CustomerServiceScreen(orders: List<OrderUi>) {
    var filter by remember { mutableStateOf("all") }
    val visible = when (filter) {
        "pending" -> orders.filter { it.state in setOf("pending", "new", "جديد") }
        "confirmed" -> orders.filter { it.state in setOf("confirmed", "تم التأكيد") }
        "shipping" -> orders.filter { it.state.contains("ship", true) || it.checkpoint.contains("ship", true) }
        else -> orders
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "الكل", "pending" to "جديد", "confirmed" to "مؤكد", "shipping" to "شحن").forEach { (key, label) ->
                FilterChip(selected = filter == key, onClick = { filter = key }, label = { Text(label) })
            }
        }
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(visible, key = { it.id.ifBlank { it.ref + it.phone } }) { OrderCard(it) }
        }
    }
}

@Composable
private fun CustomersScreen(customers: List<CustomerUi>) {
    var query by remember { mutableStateOf("") }
    val visible = if (query.isBlank()) customers else customers.filter { it.name.contains(query, true) || it.phone.contains(query) || it.gov.contains(query, true) }
    Column(Modifier.fillMaxSize()) {
        SearchField(query, { query = it }, "ابحث عن عميل")
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(visible, key = { it.id.ifBlank { it.phone } }) { customer ->
                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text(customer.name.ifBlank { "عميل" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                        Text(customer.phone)
                        if (customer.gov.isNotBlank()) Text(customer.gov, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(8.dp))
                        Text("${customer.ordersCount} طلب • ${money(customer.totalSpend)}")
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductsScreen(products: List<ProductUi>, inventoryMode: Boolean, onQuickCreate: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val visible = if (query.isBlank()) products else products.filter { it.name.contains(query, true) || it.sku.contains(query, true) || it.category.contains(query, true) }
    Column(Modifier.fillMaxSize()) {
        SearchField(query, { query = it }, if (inventoryMode) "ابحث في المخزون" else "ابحث عن منتج")
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(visible, key = { it.id.ifBlank { it.name + it.sku } }) { p ->
                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(p.name.ifBlank { "منتج" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                                if (p.sku.isNotBlank()) Text("SKU: ${p.sku}", style = MaterialTheme.typography.bodySmall)
                            }
                            Text(if (inventoryMode) "${p.stock}" else money(p.price), fontWeight = FontWeight.Bold)
                        }
                        if (p.category.isNotBlank()) Text(p.category, style = MaterialTheme.typography.bodySmall)
                        if (inventoryMode) {
                            Text(if (p.stock <= p.lowStockThreshold) "مخزون منخفض" else "المخزون جيد", modifier = Modifier.padding(top = 6.dp))
                            OutlinedButton(onClick = { onQuickCreate("stock") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 48.dp)) { Text("تسوية المخزون") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GenericSectionScreen(section: AppSection, snapshot: CommerceSnapshot) {
    val key = section.dataKey
    val count = remember(snapshot, key) {
        if (key.isNullOrBlank()) null else snapshot.raw.optJSONArray(key)?.length()
    }
    Column(Modifier.fillMaxSize().padding(18.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(section.label, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (count != null) KpiCard("العناصر المتاحة", count.toString(), Modifier.fillMaxWidth())
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp)) {
                Text("واجهة موبايل أصلية", fontWeight = FontWeight.Bold)
                Text("القسم موجود داخل التطبيق كجزء من التنقل الأصلي. سيتم ربط العمليات المتخصصة بنفس API المستخدم في النظام بدون الرجوع إلى WebView.")
            }
        }
    }
}

@Composable
private fun SettingsScreen(activity: MainActivity, snapshot: CommerceSnapshot, onRefresh: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("إعدادات التطبيق", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        FilledTonalButton(onClick = { activity.requestCallerRole() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("تفعيل Caller ID") }
        FilledTonalButton(onClick = { activity.requestOverlayPermission() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("السماح بالظهور فوق التطبيقات") }
        FilledTonalButton(onClick = { activity.requestContactsPermission() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("السماح بقراءة جهات الاتصال") }
        OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("مزامنة الآن") }
        Text("الكاش المحلي: ${CustomerCache.count(context)} عميل • الطلبات المحملة: ${snapshot.orders.size}")
        HorizontalDivider()
        OutlinedButton(
            onClick = {
                KunApi.logout(context)
                SyncJobService.cancel(context)
                activity.recreate()
            },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) { Text("تسجيل الخروج ومسح بيانات العملاء") }
    }
}

@Composable
private fun SearchField(value: String, onValue: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        singleLine = true,
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        placeholder = { Text(placeholder) }
    )
}

@Composable
private fun QuickCreateDialog(
    mode: String,
    snapshot: CommerceSnapshot,
    onMode: (String) -> Unit,
    onDismiss: () -> Unit,
    onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit
) {
    if (mode == "menu") {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("إنشاء سريع") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    QuickModeButton("طلب جديد") { onMode("order") }
                    QuickModeButton("عميل CRM") { onMode("customer") }
                    QuickModeButton("منتج جديد") { onMode("product") }
                    QuickModeButton("تسوية مخزون") { onMode("stock") }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } }
        )
        return
    }

    when (mode) {
        "order" -> OrderCreateDialog(onDismiss, onSubmit)
        "customer" -> CustomerCreateDialog(onDismiss, onSubmit)
        "product" -> ProductCreateDialog(onDismiss, onSubmit)
        "stock" -> StockCreateDialog(snapshot.products, onDismiss, onSubmit)
    }
}

@Composable
private fun QuickModeButton(label: String, action: () -> Unit) {
    FilledTonalButton(onClick = action, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(label) }
}

@Composable
private fun OrderCreateDialog(onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }; var phone by remember { mutableStateOf("") }; var gov by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }; var product by remember { mutableStateOf("") }; var qty by remember { mutableStateOf("1") }
    var total by remember { mutableStateOf("") }; var note by remember { mutableStateOf("") }
    FormDialog("طلب جديد", onDismiss, enabled = name.isNotBlank() && phone.isNotBlank() && gov.isNotBlank() && address.isNotBlank() && product.isNotBlank()) {
        Field(name, { name = it }, "اسم المشتري"); Field(phone, { phone = it }, "رقم التليفون"); Field(gov, { gov = it }, "المحافظة")
        Field(address, { address = it }, "العنوان بالتفصيل"); Field(product, { product = it }, "المنتج"); Field(qty, { qty = it }, "الكمية")
        Field(total, { total = it }, "الإجمالي"); Field(note, { note = it }, "ملاحظات")
    } onConfirm@{
        val payload = JSONObject().put("name", name).put("phone", phone).put("gov", gov).put("address", address)
            .put("product", product).put("qty", qty.toIntOrNull()?.coerceAtLeast(1) ?: 1).put("total", total.toDoubleOrNull() ?: 0.0)
            .put("note", note).put("source", "mobile_app").put("state", "pending")
        onSubmit("order", payload, null, null, null)
    }
}

@Composable
private fun CustomerCreateDialog(onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }; var phone by remember { mutableStateOf("") }; var gov by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }; var note by remember { mutableStateOf("") }
    FormDialog("عميل جديد", onDismiss, enabled = name.isNotBlank() && phone.isNotBlank()) {
        Field(name, { name = it }, "الاسم"); Field(phone, { phone = it }, "الهاتف"); Field(gov, { gov = it }, "المحافظة")
        Field(address, { address = it }, "العنوان"); Field(note, { note = it }, "ملاحظة")
    } onConfirm@{
        onSubmit("customer", JSONObject().put("name", name).put("phone", phone).put("gov", gov).put("address", address).put("note", note), null, null, null)
    }
}

@Composable
private fun ProductCreateDialog(onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }; var sku by remember { mutableStateOf("") }; var category by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }; var cost by remember { mutableStateOf("") }; var stock by remember { mutableStateOf("0") }
    FormDialog("منتج جديد", onDismiss, enabled = name.isNotBlank()) {
        Field(name, { name = it }, "اسم المنتج"); Field(sku, { sku = it }, "SKU"); Field(category, { category = it }, "التصنيف")
        Field(price, { price = it }, "السعر"); Field(cost, { cost = it }, "التكلفة"); Field(stock, { stock = it }, "المخزون")
    } onConfirm@{
        onSubmit("product", JSONObject().put("name", name).put("sku", sku).put("category", category).put("price", price.toDoubleOrNull() ?: 0.0)
            .put("cost", cost.toDoubleOrNull() ?: 0.0).put("stock", stock.toDoubleOrNull() ?: 0.0).put("lowStockThreshold", 5), null, null, null)
    }
}

@Composable
private fun StockCreateDialog(products: List<ProductUi>, onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var selectedId by remember { mutableStateOf(products.firstOrNull()?.id.orEmpty()) }
    var delta by remember { mutableStateOf("") }; var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تسوية مخزون") },
        text = {
            Column(Modifier.heightIn(max = 500.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                products.forEach { p ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = selectedId == p.id, onClick = { selectedId = p.id })
                        Text("${p.name} — ${p.stock}")
                    }
                }
                Field(delta, { delta = it }, "التغيير (+ أو -)")
                Field(note, { note = it }, "السبب")
            }
        },
        confirmButton = { Button(onClick = { onSubmit("stock", JSONObject(), selectedId, delta.toDoubleOrNull(), note) }, enabled = selectedId.isNotBlank() && (delta.toDoubleOrNull() ?: 0.0) != 0.0) { Text("تطبيق") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
private fun FormDialog(title: String, onDismiss: () -> Unit, enabled: Boolean, fields: @Composable ColumnScope.() -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp), content = fields) },
        confirmButton = { Button(onClick = onConfirm, enabled = enabled) { Text("حفظ") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
private fun Field(value: String, onValue: (String) -> Unit, label: String) {
    OutlinedTextField(value, onValue, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
}

private fun sectionIcon(section: AppSection) = when (section) {
    AppSection.DASHBOARD -> Icons.Outlined.Home
    AppSection.ORDERS -> Icons.Outlined.ShoppingCart
    AppSection.CUSTOMER_SERVICE -> Icons.Outlined.SupportAgent
    AppSection.PRODUCTS -> Icons.Outlined.Inventory2
    else -> Icons.Outlined.MoreHoriz
}

private fun bottomLabel(section: AppSection) = when (section) {
    AppSection.DASHBOARD -> "الرئيسية"
    AppSection.ORDERS -> "الطلبات"
    AppSection.CUSTOMER_SERVICE -> "خدمة العملاء"
    AppSection.PRODUCTS -> "المنتجات"
    else -> section.label
}

private fun statusLabel(value: String): String = when (value.lowercase()) {
    "pending", "new" -> "جديد"
    "confirmed" -> "تم التأكيد"
    "shipping", "in_shipping" -> "جاري الشحن"
    "shipped" -> "تم الشحن"
    "collected" -> "تم التحصيل"
    else -> value.ifBlank { "بدون حالة" }
}

private fun money(value: Double): String = NumberFormat.getNumberInstance(Locale("ar", "EG")).format(value) + " ج.م"
