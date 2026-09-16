package com.kunonline.callerid

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KunNativeAppV22(activity: MainActivity) {
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
            if (result.ok) snapshot = result.snapshot
            else if (!KunApi.hasSession(context)) loggedIn = false
        }
    }

    LaunchedEffect(loggedIn) {
        if (loggedIn) refresh()
    }

    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme {
            if (!loggedIn) {
                V22LoginScreen(
                    busy = loading,
                    message = message,
                    onLogin = { email, password ->
                        loading = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                KunApi.loginAndSync(context, email, password)
                            }
                            loading = false
                            message = result.message
                            if (result.ok) {
                                loggedIn = true
                                SyncJobService.schedule(context)
                            }
                        }
                    }
                )
            } else {
                ModalNavigationDrawer(
                    drawerState = drawerState,
                    drawerContent = {
                        ModalDrawerSheet(modifier = Modifier.widthIn(max = 340.dp)) {
                            Text(
                                "Kun Online",
                                modifier = Modifier.padding(20.dp),
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold
                            )
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
                                        icon = { Icon(v22SectionIcon(section), contentDescription = null) },
                                        label = { Text(v22BottomLabel(section), maxLines = 1) }
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
                            if (selected in setOf(
                                    AppSection.DASHBOARD,
                                    AppSection.ORDERS,
                                    AppSection.CUSTOMERS,
                                    AppSection.PRODUCTS,
                                    AppSection.INVENTORY
                                )
                            ) {
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
                                V22SectionContent(
                                    section = selected,
                                    snapshot = data ?: CommerceSnapshot(),
                                    activity = activity,
                                    onRefresh = { refresh() },
                                    onQuickCreate = { createMode = it }
                                )
                            }
                            if (loading) {
                                LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
                            }
                        }
                    }
                }

                createMode?.let { mode ->
                    V22QuickCreateDialog(
                        mode = mode,
                        snapshot = snapshot ?: CommerceSnapshot(),
                        onMode = { createMode = it },
                        onDismiss = { createMode = null },
                        onSubmit = { action, payload, productId, delta, note ->
                            scope.launch {
                                loading = true
                                val result = withContext(Dispatchers.IO) {
                                    when (action) {
                                        "order" -> KunApi.createOrder(context, payload)
                                        "customer" -> KunApi.createCustomer(context, payload)
                                        "product" -> KunApi.createProduct(context, payload)
                                        "stock" -> KunApi.adjustStock(
                                            context,
                                            productId.orEmpty(),
                                            delta ?: 0.0,
                                            note.orEmpty()
                                        )
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
}

@Composable
private fun V22LoginScreen(busy: Boolean, message: String, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center
    ) {
        Text("Kun Online", fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Commerce OS — Native Android", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("الإيميل") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            singleLine = true
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("كلمة المرور") },
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true
        )
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
private fun V22SectionContent(
    section: AppSection,
    snapshot: CommerceSnapshot,
    activity: MainActivity,
    onRefresh: () -> Unit,
    onQuickCreate: (String) -> Unit
) {
    when (section) {
        AppSection.DASHBOARD -> V22Dashboard(snapshot, onQuickCreate)
        AppSection.ORDERS -> V22Orders(snapshot.orders)
        AppSection.CUSTOMER_SERVICE -> V22CustomerService(snapshot.orders)
        AppSection.CUSTOMERS -> V22Customers(snapshot.customers)
        AppSection.PRODUCTS -> V22Products(snapshot.products, false, onQuickCreate)
        AppSection.INVENTORY -> V22Products(snapshot.products, true, onQuickCreate)
        AppSection.SHIPPING -> V22Orders(
            snapshot.orders.filter {
                it.state.contains("ship", true) || it.checkpoint.contains("ship", true)
            },
            "الشحن"
        )
        AppSection.POST_SHIPPING -> V22Orders(
            snapshot.orders.filter {
                it.state in setOf("shipped", "collected", "تم الشحن", "تم التحصيل")
            },
            "ما بعد الشحن"
        )
        AppSection.RETURNS -> V22Orders(
            snapshot.orders.filter {
                it.state.contains("return", true) ||
                    it.state.contains("refund", true) ||
                    it.state.contains("مرتجع")
            },
            "المرتجعات والاستبدالات"
        )
        AppSection.PRINTING -> V22Orders(
            snapshot.orders.filter { it.awb.isNotBlank() },
            "طلبات جاهزة للطباعة"
        )
        AppSection.SETTINGS -> V22Settings(activity, snapshot, onRefresh)
        AppSection.INTELLIGENCE,
        AppSection.ONBOARDING,
        AppSection.READINESS,
        AppSection.MARKETING,
        AppSection.AD_STUDIO,
        AppSection.ANALYTICS,
        AppSection.ACCOUNT -> V22Overview(section, snapshot)
        else -> V22DataSection(section, snapshot)
    }
}

@Composable
private fun V22Dashboard(snapshot: CommerceSnapshot, onQuickCreate: (String) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("نظرة سريعة", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V22Kpi("الطلبات", snapshot.orders.size.toString(), Modifier.weight(1f))
                V22Kpi("المبيعات", v22Money(snapshot.totalSales), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V22Kpi("مؤكد", snapshot.confirmedOrders.toString(), Modifier.weight(1f))
                V22Kpi("جاري الشحن", snapshot.shippingOrders.toString(), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V22Kpi("تم التحصيل", snapshot.collectedOrders.toString(), Modifier.weight(1f))
                V22Kpi("مخزون منخفض", snapshot.lowStockProducts.toString(), Modifier.weight(1f))
            }
        }
        item {
            Text("إنشاء سريع", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = { onQuickCreate("order") },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp)
                ) { Text("طلب") }
                FilledTonalButton(
                    onClick = { onQuickCreate("customer") },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp)
                ) { Text("عميل") }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = { onQuickCreate("product") },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp)
                ) { Text("منتج") }
                FilledTonalButton(
                    onClick = { onQuickCreate("stock") },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp)
                ) { Text("مخزون") }
            }
        }
        item { Text("أحدث الطلبات", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
        items(snapshot.orders.take(8)) { V22OrderCard(it) }
    }
}

@Composable
private fun V22Kpi(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun V22Orders(orders: List<OrderUi>, title: String = "الطلبات") {
    var query by remember { mutableStateOf("") }
    val visible = remember(orders, query) {
        if (query.isBlank()) orders else orders.filter { order ->
            listOf(order.ref, order.name, order.phone, order.product, order.gov, order.state)
                .any { it.contains(query, true) }
        }
    }
    Column(Modifier.fillMaxSize()) {
        V22Search(query, { query = it }, "ابحث بالاسم، الهاتف، الطلب أو المنتج")
        Text("$title — ${visible.size}", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontWeight = FontWeight.Bold)
        LazyColumn(
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(visible, key = { it.id.ifBlank { it.ref + it.phone } }) { V22OrderCard(it) }
        }
    }
}

@Composable
private fun V22OrderCard(order: OrderUi) {
    val context = LocalContext.current
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(order.name.ifBlank { "عميل بدون اسم" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text("#${order.ref} • ${v22Status(order.state)}", style = MaterialTheme.typography.bodySmall)
                }
                Text(v22Money(order.total), fontWeight = FontWeight.Bold)
            }
            if (order.product.isNotBlank()) Text("${order.product} × ${order.qty}", modifier = Modifier.padding(top = 8.dp))
            if (order.gov.isNotBlank() || order.address.isNotBlank()) {
                Text(
                    listOf(order.gov, order.address).filter { it.isNotBlank() }.joinToString(" — "),
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (order.phone.isNotBlank()) {
                    OutlinedButton(
                        onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${order.phone}"))) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                    ) {
                        Icon(Icons.Outlined.Call, contentDescription = null)
                        Spacer(Modifier.width(5.dp))
                        Text("اتصال")
                    }
                }
                if (order.awb.isNotBlank()) {
                    FilledTonalButton(
                        onClick = { v22Copy(context, "AWB", order.awb) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                    ) {
                        Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                        Spacer(Modifier.width(5.dp))
                        Text("AWB", maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun V22CustomerService(orders: List<OrderUi>) {
    var filter by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    val base = when (filter) {
        "pending" -> orders.filter { it.state in setOf("pending", "new", "جديد") }
        "confirmed" -> orders.filter { it.state in setOf("confirmed", "تم التأكيد") }
        "shipping" -> orders.filter { it.state.contains("ship", true) || it.checkpoint.contains("ship", true) }
        else -> orders
    }
    val visible = if (query.isBlank()) base else base.filter {
        listOf(it.name, it.phone, it.ref, it.product).any { value -> value.contains(query, true) }
    }
    Column(Modifier.fillMaxSize()) {
        V22Search(query, { query = it }, "ابحث في خدمة العملاء")
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf("all" to "الكل", "pending" to "جديد", "confirmed" to "مؤكد", "shipping" to "شحن")
                .forEach { (key, label) ->
                    FilterChip(selected = filter == key, onClick = { filter = key }, label = { Text(label) })
                }
        }
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(visible, key = { it.id.ifBlank { it.ref + it.phone } }) { V22OrderCard(it) }
        }
    }
}

@Composable
private fun V22Customers(customers: List<CustomerUi>) {
    val context = LocalContext.current
    var query by remember { mutableStateOf("") }
    val visible = if (query.isBlank()) customers else customers.filter {
        it.name.contains(query, true) || it.phone.contains(query) || it.gov.contains(query, true)
    }
    Column(Modifier.fillMaxSize()) {
        V22Search(query, { query = it }, "ابحث عن عميل")
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(visible, key = { it.id.ifBlank { it.phone } }) { customer ->
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text(customer.name.ifBlank { "عميل" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                        Text(customer.phone)
                        if (customer.gov.isNotBlank()) Text(customer.gov, style = MaterialTheme.typography.bodySmall)
                        Text("${customer.ordersCount} طلب • ${v22Money(customer.totalSpend)}", modifier = Modifier.padding(top = 6.dp))
                        if (customer.phone.isNotBlank()) {
                            OutlinedButton(
                                onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${customer.phone}"))) },
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 48.dp)
                            ) {
                                Icon(Icons.Outlined.Call, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("اتصال بالعميل")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun V22Products(products: List<ProductUi>, inventoryMode: Boolean, onQuickCreate: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val visible = if (query.isBlank()) products else products.filter {
        it.name.contains(query, true) || it.sku.contains(query, true) || it.category.contains(query, true)
    }
    Column(Modifier.fillMaxSize()) {
        V22Search(query, { query = it }, if (inventoryMode) "ابحث في المخزون" else "ابحث عن منتج")
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(visible, key = { it.id.ifBlank { it.name + it.sku } }) { product ->
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(product.name.ifBlank { "منتج" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                                if (product.sku.isNotBlank()) Text("SKU: ${product.sku}", style = MaterialTheme.typography.bodySmall)
                            }
                            Text(if (inventoryMode) v22Qty(product.stock) else v22Money(product.price), fontWeight = FontWeight.Bold)
                        }
                        if (product.category.isNotBlank()) Text(product.category, style = MaterialTheme.typography.bodySmall)
                        if (inventoryMode) {
                            Text(if (product.stock <= product.lowStockThreshold) "مخزون منخفض" else "المخزون جيد", modifier = Modifier.padding(top = 6.dp))
                            OutlinedButton(
                                onClick = { onQuickCreate("stock") },
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 48.dp)
                            ) { Text("تسوية المخزون") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun V22DataSection(section: AppSection, snapshot: CommerceSnapshot) {
    val key = section.dataKey
    val array = remember(snapshot, key) {
        if (key.isNullOrBlank()) null else snapshot.raw.optJSONArray(key)
    }
    val rows = remember(array) { v22JsonRows(array) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    val visible = remember(rows, query) {
        if (query.isBlank()) rows else rows.filter { v22JsonSearchText(it).contains(query, true) }
    }

    Column(Modifier.fillMaxSize()) {
        V22Search(query, { query = it }, "ابحث داخل ${section.label}")
        Text("${section.label} — ${visible.size}", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontWeight = FontWeight.Bold)
        if (rows.isEmpty()) {
            V22EmptyState("لا توجد بيانات متاحة في هذا القسم حاليًا")
        } else {
            LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(visible) { row ->
                    ElevatedCard(
                        modifier = Modifier.fillMaxWidth().clickable { selected = row }
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(v22JsonTitle(row), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            v22JsonSubtitle(row).takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            v22JsonSummary(row).forEach { (label, value) ->
                                Text("$label: $value", modifier = Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium)
                            }
                            Text("اضغط لعرض التفاصيل", modifier = Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }

    selected?.let { row ->
        V22JsonDetailDialog(section.label, row) { selected = null }
    }
}

@Composable
private fun V22Overview(section: AppSection, snapshot: CommerceSnapshot) {
    val aov = if (snapshot.orders.isEmpty()) 0.0 else snapshot.totalSales / snapshot.orders.size
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { Text(section.label, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) }
        when (section) {
            AppSection.INTELLIGENCE, AppSection.ANALYTICS -> {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        V22Kpi("المبيعات", v22Money(snapshot.totalSales), Modifier.weight(1f))
                        V22Kpi("متوسط الطلب", v22Money(aov), Modifier.weight(1f))
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        V22Kpi("الطلبات", snapshot.orders.size.toString(), Modifier.weight(1f))
                        V22Kpi("تم التحصيل", snapshot.collectedOrders.toString(), Modifier.weight(1f))
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        V22Kpi("العملاء", snapshot.customers.size.toString(), Modifier.weight(1f))
                        V22Kpi("مخزون منخفض", snapshot.lowStockProducts.toString(), Modifier.weight(1f))
                    }
                }
            }
            AppSection.READINESS, AppSection.ONBOARDING -> {
                item { V22InfoCard("البيانات", "${snapshot.orders.size} طلب • ${snapshot.customers.size} عميل • ${snapshot.products.size} منتج") }
                item { V22InfoCard("Caller ID", "متاح من إعدادات التطبيق مع صلاحية فحص المكالمات والظهور فوق التطبيقات") }
                item { V22InfoCard("المزامنة", "البيانات تُقرأ من Kun Online وتُحفظ محليًا لخدمة Caller ID") }
            }
            AppSection.MARKETING, AppSection.AD_STUDIO -> {
                val campaigns = snapshot.raw.optJSONArray("campaigns")?.length() ?: 0
                item { V22Kpi("الحملات المتاحة", campaigns.toString(), Modifier.fillMaxWidth()) }
                item { V22InfoCard("ملخص المبيعات", "${snapshot.orders.size} طلب بقيمة ${v22Money(snapshot.totalSales)}") }
            }
            AppSection.ACCOUNT -> {
                val stores = snapshot.raw.optJSONArray("stores")?.length() ?: 0
                val integrations = snapshot.raw.optJSONArray("integrations")?.length() ?: 0
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        V22Kpi("المتاجر", stores.toString(), Modifier.weight(1f))
                        V22Kpi("التكاملات", integrations.toString(), Modifier.weight(1f))
                    }
                }
                item { V22InfoCard("الحساب", "التطبيق يستخدم نفس جلسة Kun Online ونفس نطاق الصلاحيات الخاص بالحساب") }
            }
            else -> item { V22EmptyState("لا توجد بيانات إضافية متاحة حاليًا") }
        }
    }
}

@Composable
private fun V22InfoCard(title: String, text: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(text, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
private fun V22EmptyState(text: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(Icons.Outlined.Inbox, contentDescription = null, modifier = Modifier.size(42.dp))
        Text(text, modifier = Modifier.padding(top = 10.dp))
    }
}

@Composable
private fun V22JsonDetailDialog(title: String, row: JSONObject, onDismiss: () -> Unit) {
    val fields = remember(row) { v22JsonFields(row, 30) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                fields.forEach { (key, value) ->
                    Column {
                        Text(v22FieldLabel(key), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(value, style = MaterialTheme.typography.bodyMedium)
                    }
                    HorizontalDivider()
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } }
    )
}

@Composable
private fun V22Settings(activity: MainActivity, snapshot: CommerceSnapshot, onRefresh: () -> Unit) {
    val context = LocalContext.current
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("إعدادات التطبيق", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        FilledTonalButton(
            onClick = { activity.requestCallerRole() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) { Text("تفعيل Caller ID") }
        FilledTonalButton(
            onClick = { activity.requestOverlayPermission() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) { Text("السماح بالظهور فوق التطبيقات") }
        FilledTonalButton(
            onClick = { activity.requestContactsPermission() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) { Text("السماح بقراءة جهات الاتصال") }
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
private fun V22Search(value: String, onValue: (String) -> Unit, placeholder: String) {
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
private fun V22QuickCreateDialog(
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
                    listOf(
                        "order" to "طلب جديد",
                        "customer" to "عميل CRM",
                        "product" to "منتج جديد",
                        "stock" to "تسوية مخزون"
                    ).forEach { (key, label) ->
                        FilledTonalButton(
                            onClick = { onMode(key) },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                        ) { Text(label) }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } }
        )
        return
    }
    when (mode) {
        "order" -> V22OrderCreate(onDismiss, onSubmit)
        "customer" -> V22CustomerCreate(onDismiss, onSubmit)
        "product" -> V22ProductCreate(onDismiss, onSubmit)
        "stock" -> V22StockCreate(snapshot.products, onDismiss, onSubmit)
    }
}

@Composable
private fun V22OrderCreate(onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var gov by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var product by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("1") }
    var total by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    V22FormDialog(
        title = "طلب جديد",
        onDismiss = onDismiss,
        enabled = name.isNotBlank() && phone.isNotBlank() && gov.isNotBlank() && address.isNotBlank() && product.isNotBlank(),
        fields = {
            V22Field(name, { name = it }, "اسم المشتري")
            V22Field(phone, { phone = it }, "رقم التليفون", KeyboardType.Phone)
            V22Field(gov, { gov = it }, "المحافظة")
            V22Field(address, { address = it }, "العنوان بالتفصيل")
            V22Field(product, { product = it }, "المنتج")
            V22Field(qty, { qty = it }, "الكمية", KeyboardType.Number)
            V22Field(total, { total = it }, "الإجمالي", KeyboardType.Decimal)
            V22Field(note, { note = it }, "ملاحظات")
        },
        onConfirm = {
            val payload = JSONObject()
                .put("name", name)
                .put("phone", phone)
                .put("gov", gov)
                .put("address", address)
                .put("product", product)
                .put("qty", qty.toIntOrNull()?.coerceAtLeast(1) ?: 1)
                .put("total", total.toDoubleOrNull() ?: 0.0)
                .put("note", note)
                .put("source", "manual")
                .put("date", v22Today())
                .put("state", "pending")
            onSubmit("order", payload, null, null, null)
        }
    )
}

@Composable
private fun V22CustomerCreate(onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var gov by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    V22FormDialog(
        title = "عميل جديد",
        onDismiss = onDismiss,
        enabled = name.isNotBlank() && phone.isNotBlank(),
        fields = {
            V22Field(name, { name = it }, "الاسم")
            V22Field(phone, { phone = it }, "الهاتف", KeyboardType.Phone)
            V22Field(gov, { gov = it }, "المحافظة")
            V22Field(address, { address = it }, "العنوان")
            V22Field(note, { note = it }, "ملاحظة")
        },
        onConfirm = {
            onSubmit(
                "customer",
                JSONObject().put("name", name).put("phone", phone).put("gov", gov).put("address", address).put("note", note),
                null, null, null
            )
        }
    )
}

@Composable
private fun V22ProductCreate(onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var sku by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var cost by remember { mutableStateOf("") }
    var stock by remember { mutableStateOf("0") }
    V22FormDialog(
        title = "منتج جديد",
        onDismiss = onDismiss,
        enabled = name.isNotBlank(),
        fields = {
            V22Field(name, { name = it }, "اسم المنتج")
            V22Field(sku, { sku = it }, "SKU")
            V22Field(category, { category = it }, "التصنيف")
            V22Field(price, { price = it }, "السعر", KeyboardType.Decimal)
            V22Field(cost, { cost = it }, "التكلفة", KeyboardType.Decimal)
            V22Field(stock, { stock = it }, "المخزون", KeyboardType.Decimal)
        },
        onConfirm = {
            val payload = JSONObject()
                .put("name", name).put("sku", sku).put("category", category)
                .put("price", price.toDoubleOrNull() ?: 0.0)
                .put("cost", cost.toDoubleOrNull() ?: 0.0)
                .put("stock", stock.toDoubleOrNull() ?: 0.0)
                .put("lowStockThreshold", 5)
            onSubmit("product", payload, null, null, null)
        }
    )
}

@Composable
private fun V22StockCreate(products: List<ProductUi>, onDismiss: () -> Unit, onSubmit: (String, JSONObject, String?, Double?, String?) -> Unit) {
    var selectedId by remember { mutableStateOf(products.firstOrNull()?.id.orEmpty()) }
    var delta by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تسوية مخزون") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 500.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                products.forEach { product ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = selectedId == product.id, onClick = { selectedId = product.id })
                        Text("${product.name} — ${v22Qty(product.stock)}")
                    }
                }
                if (products.isEmpty()) Text("لا توجد منتجات محملة حاليًا")
                V22Field(delta, { delta = it }, "التغيير (+ أو -)", KeyboardType.Decimal)
                V22Field(note, { note = it }, "السبب")
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit("stock", JSONObject(), selectedId, delta.toDoubleOrNull(), note) },
                enabled = selectedId.isNotBlank() && (delta.toDoubleOrNull() ?: 0.0) != 0.0
            ) { Text("تطبيق") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
private fun V22FormDialog(
    title: String,
    onDismiss: () -> Unit,
    enabled: Boolean,
    fields: @Composable ColumnScope.() -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                content = fields
            )
        },
        confirmButton = { Button(onClick = onConfirm, enabled = enabled) { Text("حفظ") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
private fun V22Field(value: String, onValue: (String) -> Unit, label: String, keyboardType: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        singleLine = true
    )
}

private fun v22JsonRows(array: JSONArray?): List<JSONObject> = buildList {
    if (array == null) return@buildList
    for (i in 0 until array.length()) array.optJSONObject(i)?.let { add(it) }
}

private fun v22JsonSearchText(row: JSONObject): String =
    row.keys().asSequence().mapNotNull { key -> v22Scalar(row.opt(key)) }.joinToString(" ")

private fun v22JsonTitle(row: JSONObject): String {
    val keys = listOf("name", "title", "label", "ref", "email", "code", "id")
    return keys.firstNotNullOfOrNull { key -> row.optString(key).takeIf { it.isNotBlank() } } ?: "عنصر"
}

private fun v22JsonSubtitle(row: JSONObject): String {
    val keys = listOf("status", "state", "type", "role", "channel", "provider")
    return keys.firstNotNullOfOrNull { key -> row.optString(key).takeIf { it.isNotBlank() } }.orEmpty()
}

private fun v22JsonSummary(row: JSONObject): List<Pair<String, String>> {
    val preferred = listOf(
        "phone", "email", "amount", "balance", "total", "storeName", "store", "city",
        "createdAt", "created_at", "updatedAt", "updated_at"
    )
    return preferred.mapNotNull { key ->
        val value = v22Scalar(row.opt(key))?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
        v22FieldLabel(key) to value
    }.take(3)
}

private fun v22JsonFields(row: JSONObject, limit: Int): List<Pair<String, String>> =
    row.keys().asSequence().mapNotNull { key ->
        val value = v22Scalar(row.opt(key)) ?: return@mapNotNull null
        v22FieldLabel(key) to value
    }.take(limit).toList()

private fun v22Scalar(value: Any?): String? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject, is JSONArray -> null
    else -> value.toString()
}

private fun v22FieldLabel(key: String): String = when (key) {
    "name" -> "الاسم"
    "title" -> "العنوان"
    "status", "state" -> "الحالة"
    "phone" -> "الهاتف"
    "email" -> "الإيميل"
    "amount" -> "المبلغ"
    "balance" -> "الرصيد"
    "total" -> "الإجمالي"
    "role" -> "الدور"
    "type" -> "النوع"
    "createdAt", "created_at" -> "تاريخ الإنشاء"
    "updatedAt", "updated_at" -> "آخر تحديث"
    else -> key.replace('_', ' ')
}

private fun v22Copy(context: Context, label: String, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
    Toast.makeText(context, "تم النسخ", Toast.LENGTH_SHORT).show()
}

private fun v22SectionIcon(section: AppSection) = when (section) {
    AppSection.DASHBOARD -> Icons.Outlined.Home
    AppSection.ORDERS -> Icons.Outlined.ShoppingCart
    AppSection.CUSTOMER_SERVICE -> Icons.Outlined.SupportAgent
    AppSection.PRODUCTS -> Icons.Outlined.Inventory2
    else -> Icons.Outlined.MoreHoriz
}

private fun v22BottomLabel(section: AppSection): String = when (section) {
    AppSection.DASHBOARD -> "الرئيسية"
    AppSection.ORDERS -> "الطلبات"
    AppSection.CUSTOMER_SERVICE -> "الخدمة"
    AppSection.PRODUCTS -> "المنتجات"
    else -> section.label
}

private fun v22Status(value: String): String = when (value.lowercase()) {
    "pending", "new" -> "جديد"
    "confirmed" -> "تم التأكيد"
    "shipping", "in_shipping" -> "جاري الشحن"
    "shipped" -> "تم الشحن"
    "collected" -> "تم التحصيل"
    else -> value.ifBlank { "بدون حالة" }
}

private fun v22Money(value: Double): String =
    NumberFormat.getNumberInstance(Locale("ar", "EG")).format(value) + " ج.م"

private fun v22Qty(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

private fun v22Today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
