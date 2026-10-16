package com.kunonline.callerid

import android.Manifest
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

private const val V25_FOREGROUND_SYNC_MS = 15_000L
private const val V25_CONTACT_REFRESH_MS = 15_000L
private const val V25_CONTACT_WINDOW_MS = 5L * 60L * 1000L

private enum class MobileV25Tab(val label: String) {
    HOME("الرئيسية"),
    ORDERS("الطلبات"),
    CUSTOMER_SERVICE("خدمة العملاء"),
    SETTINGS("الإعدادات")
}

private enum class V25OrderFilter(val label: String, val states: Set<String>) {
    ALL("الكل", emptySet()),
    PENDING("انتظار التأكيد", setOf("pending", "new")),
    CONTACT("لا يرد", setOf("no_answer")),
    CONFIRMED("تم التأكيد", setOf("confirmed", "preparing")),
    SHIPPING("الشحن", setOf("shipping", "in_shipping", "shipped", "signed")),
    COLLECTED("تم التحصيل", setOf("collected")),
    CLOSED("ملغي / مرتجع", setOf("cancelled", "returned"))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KunNativeAppV25(
    activity: MainActivity,
    onOpenCollaboration: () -> Unit = {},
    onOpenSystemSections: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loggedIn by remember { mutableStateOf(KunApi.hasSession(context)) }
    var snapshot by remember { mutableStateOf<CommerceSnapshot?>(null) }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(MobileV25Tab.HOME) }
    var newOrdersNotice by remember { mutableStateOf("") }
    var lastSyncAt by remember { mutableLongStateOf(CustomerCache.lastSyncedAt(context)) }
    var storeOptions by remember { mutableStateOf<List<MobileStoreOption>>(emptyList()) }
    var currentStore by remember { mutableStateOf(ScopeInfo()) }
    var storeOptionsLoading by remember { mutableStateOf(false) }
    var storeOptionsError by remember { mutableStateOf("") }
    val dateRevision = MobileDateFilterState.revision

    fun rawOrderIds(value: CommerceSnapshot?): Set<String> {
        val array = value?.raw?.optJSONArray("orders") ?: return emptySet()
        return buildSet {
            for (index in 0 until array.length()) {
                val id = array.optJSONObject(index)?.optString("id").orEmpty()
                if (id.isNotBlank()) add(id)
            }
        }
    }

    suspend fun performRefresh(manual: Boolean = false) {
        if (!loggedIn || loading) return
        loading = true
        val previousIds = rawOrderIds(snapshot)
        val hadSnapshot = snapshot != null
        val result = try {
            withContext(Dispatchers.IO) { KunApi.fetchState(context, forceFull = manual) }
        } finally {
            loading = false
        }
        if (result.ok) {
            val next = result.snapshot ?: CommerceSnapshot()
            snapshot = next
            lastSyncAt = CustomerCache.lastSyncedAt(context)
            val nextIds = rawOrderIds(next)
            val added = if (hadSnapshot) nextIds.count { it !in previousIds } else 0
            newOrdersNotice = when {
                added > 0 -> if (added == 1) "وصل أوردر جديد وتمت مزامنته مع المكالمات" else "وصل $added أوردر جديد وتمت مزامنتهم مع المكالمات"
                manual -> "تم تحديث الطلبات وCaller ID"
                else -> ""
            }
            if (manual) message = result.message
        } else {
            if (manual) message = result.message
            if (!KunApi.hasSession(context)) loggedIn = false
        }
    }

    fun refresh(manual: Boolean = false) {
        if (!loggedIn || loading) return
        scope.launch { performRefresh(manual) }
    }

    LaunchedEffect(loggedIn) {
        if (!loggedIn) {
            storeOptions = emptyList()
            currentStore = ScopeInfo()
            storeOptionsError = ""
            return@LaunchedEffect
        }
        SyncJobService.schedule(context)
        storeOptionsLoading = true
        val result = withContext(Dispatchers.IO) { KunApi.loadStoreOptions(context) }
        storeOptionsLoading = false
        if (!loggedIn) return@LaunchedEffect
        storeOptions = result.stores
        currentStore = result.current
        storeOptionsError = if (result.ok) result.message else result.message
        // Show real data immediately after sign-in, rather than waiting for the
        // next 15-second foreground poll to populate the dashboard.
        if (snapshot == null) performRefresh(false)
    }
    // A period switch does one immediate delta refresh. It does not create a new
    // recurring timer, so normal Cloudflare request cadence stays unchanged.
    LaunchedEffect(loggedIn, dateRevision) {
        if (loggedIn && dateRevision > 0) performRefresh(false)
    }
    // Keep the caller-ID cache current while customer service is visible too.
    ForegroundPolling(loggedIn, enabled = loggedIn && selected != MobileV25Tab.SETTINGS, intervalMillis = V25_FOREGROUND_SYNC_MS) {
        performRefresh(false)
    }

    LaunchedEffect(newOrdersNotice) {
        if (newOrdersNotice.isNotBlank()) {
            delay(5_000)
            newOrdersNotice = ""
        }
    }

    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        KunTheme {
            if (!loggedIn) {
                V25Login(
                    busy = loading,
                    message = message,
                    onLogin = { email, password ->
                        if (loading) return@V25Login
                        loading = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { KunApi.loginAndSync(context, email, password) }
                            loading = false
                            message = result.message
                            if (result.ok) {
                                loggedIn = true
                                lastSyncAt = CustomerCache.lastSyncedAt(context)
                                SyncJobService.schedule(context)
                            }
                        }
                    }
                )
            } else {
                Scaffold(
                    containerColor = KunColors.Ground,
                    topBar = {
                        TopAppBar(
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = KunColors.Surface,
                                titleContentColor = KunColors.Ink,
                                actionIconContentColor = KunColors.Chrome
                            ),
                            title = {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                    KunBrandMark(Modifier.size(50.dp))
                                    Column {
                                        Text(selected.label, color = KunColors.Chrome, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                                        val selectedStoreName = storeOptions.firstOrNull {
                                            it.clientId == currentStore.clientId && it.storeId == currentStore.storeId
                                        }?.storeName
                                        Text(
                                            selectedStoreName ?: "كن أونلاين • إدارة المتاجر",
                                            fontSize = 11.sp,
                                            color = KunColors.Ink2,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            },
                            actions = {
                                if (selected != MobileV25Tab.SETTINGS) {
                                    IconButton(onClick = { selected = MobileV25Tab.HOME }, enabled = !loading) {
                                        Icon(Icons.Outlined.Storefront, contentDescription = "اختيار المتجر")
                                    }
                                    IconButton(onClick = { refresh(true) }, enabled = !loading) {
                                        Icon(Icons.Outlined.Refresh, contentDescription = "تحديث البيانات")
                                    }
                                }
                            }
                        )
                    },
                    bottomBar = {
                        NavigationBar(containerColor = KunColors.Surface, tonalElevation = 2.dp) {
                            val colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = KunColors.Chrome,
                                selectedTextColor = KunColors.Chrome,
                                indicatorColor = KunColors.ChromeSoft,
                                unselectedIconColor = KunColors.Ink3,
                                unselectedTextColor = KunColors.Ink2
                            )
                            NavigationBarItem(
                                selected = selected == MobileV25Tab.HOME,
                                onClick = { selected = MobileV25Tab.HOME },
                                icon = { Icon(Icons.Outlined.Home, contentDescription = null) },
                                label = { Text("الرئيسية") },
                                colors = colors
                            )
                            NavigationBarItem(
                                selected = selected == MobileV25Tab.ORDERS,
                                onClick = { selected = MobileV25Tab.ORDERS },
                                icon = { Icon(Icons.Outlined.Inventory2, contentDescription = null) },
                                label = { Text("الطلبات") },
                                colors = colors
                            )
                            NavigationBarItem(
                                selected = selected == MobileV25Tab.CUSTOMER_SERVICE,
                                onClick = { selected = MobileV25Tab.CUSTOMER_SERVICE },
                                icon = { Icon(Icons.Outlined.SupportAgent, contentDescription = null) },
                                label = { Text("العملاء") },
                                colors = colors
                            )
                            NavigationBarItem(
                                selected = false,
                                onClick = onOpenSystemSections,
                                icon = { Icon(Icons.Outlined.GridView, contentDescription = null) },
                                label = { Text("الأقسام") },
                                colors = colors
                            )
                            NavigationBarItem(
                                selected = selected == MobileV25Tab.SETTINGS,
                                onClick = { selected = MobileV25Tab.SETTINGS },
                                icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                                label = { Text("الإعدادات") },
                                colors = colors
                            )
                        }
                    }
                ) { padding ->
                    Column(Modifier.fillMaxSize().padding(padding)) {
                        MobileDateFilterBar()
                        Box(Modifier.fillMaxWidth().weight(1f)) {
                            when (selected) {
                                MobileV25Tab.HOME -> V25Home(
                                    snapshot = snapshot ?: CommerceSnapshot(),
                                    newOrdersNotice = newOrdersNotice,
                                    storeOptions = storeOptions,
                                    currentStore = currentStore,
                                    storeOptionsLoading = storeOptionsLoading,
                                    storeOptionsError = storeOptionsError,
                                    storeSwitching = loading,
                                    onSelectStore = { option ->
                                        if (!loading) {
                                            loading = true
                                            scope.launch {
                                                val result = withContext(Dispatchers.IO) {
                                                    KunApi.selectStore(context, option)
                                                }
                                                if (result.ok) {
                                                    snapshot = null
                                                    newOrdersNotice = ""
                                                    lastSyncAt = 0L
                                                    currentStore = ScopeInfo(option.clientId, option.storeId)
                                                    message = result.message
                                                    loading = false
                                                    performRefresh(true)
                                                } else {
                                                    loading = false
                                                    storeOptionsError = result.message
                                                    val latest = withContext(Dispatchers.IO) {
                                                        KunApi.loadStoreOptions(context)
                                                    }
                                                    if (latest.ok) {
                                                        storeOptions = latest.stores
                                                        currentStore = latest.current
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    onOpenSections = onOpenSystemSections,
                                    onOpenOrders = { selected = MobileV25Tab.ORDERS },
                                    onOpenCustomerService = { selected = MobileV25Tab.CUSTOMER_SERVICE }
                                )
                                MobileV25Tab.ORDERS -> V25Orders(
                                    snapshot = snapshot ?: CommerceSnapshot(),
                                    onRefresh = { refresh(false) }
                                )
                                MobileV25Tab.CUSTOMER_SERVICE -> V25CustomerServiceHub(
                                    snapshot = snapshot ?: CommerceSnapshot(),
                                    onGlobalRefresh = { refresh(false) }
                                )
                                MobileV25Tab.SETTINGS -> V25Settings(
                                    activity = activity,
                                    snapshot = snapshot ?: CommerceSnapshot(),
                                    lastSyncAt = lastSyncAt,
                                    onRefresh = { refresh(true) },
                                    onLogout = {
                                        KunApi.logout(context)
                                        CallActivityStore.clear(context)
                                        SyncJobService.cancel(context)
                                        loggedIn = false
                                        snapshot = null
                                        selected = MobileV25Tab.HOME
                                    }
                                )
                            }
                            if (loading) {
                                LinearProgressIndicator(
                                    modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter),
                                    color = KunColors.Pine,
                                    trackColor = KunColors.PineSoft
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
private fun V25Login(busy: Boolean, message: String, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    Box(
        Modifier.fillMaxSize().background(KunColors.Ground).padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.fillMaxWidth().widthIn(max = 460.dp),
            shape = RoundedCornerShape(26.dp),
            colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
        ) {
            Column(
                Modifier.padding(horizontal = 24.dp, vertical = 28.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(15.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                KunBrandMark(Modifier.size(156.dp))
                Text("كن أونلاين", style = MaterialTheme.typography.headlineMedium, color = KunColors.Ink)
                Text("إدارة متاجرك وكل عملياتك من مكان واحد", color = KunColors.Ink2, style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريد الإلكتروني") },
                    leadingIcon = { Icon(Icons.Outlined.Email, null) },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    shape = KunRadius
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("كلمة المرور") },
                    leadingIcon = { Icon(Icons.Outlined.Lock, null) },
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, null)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    singleLine = true,
                    shape = KunRadius
                )
                Button(
                    onClick = { onLogin(email.trim(), password) },
                    enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
                    shape = KunRadius
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                    else Text("دخول إلى النظام", fontWeight = FontWeight.Bold)
                }
                if (message.isNotBlank()) {
                    Surface(color = if (message.contains("تم")) KunColors.PineSoft else KunColors.BrickSoft, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
                        Text(message, color = if (message.contains("تم")) KunColors.Pine else KunColors.Brick, modifier = Modifier.padding(12.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun V25Home(
    snapshot: CommerceSnapshot,
    newOrdersNotice: String,
    storeOptions: List<MobileStoreOption>,
    currentStore: ScopeInfo,
    storeOptionsLoading: Boolean,
    storeOptionsError: String,
    storeSwitching: Boolean,
    onSelectStore: (MobileStoreOption) -> Unit,
    onOpenSections: () -> Unit,
    onOpenOrders: () -> Unit,
    onOpenCustomerService: () -> Unit
) {
    val orders = snapshot.orders
    val periodLabel = MobileDateFilterState.periodLabel
    val pending = orders.count { it.state in setOf("pending", "new") }
    val confirmed = orders.count { it.state in setOf("confirmed", "preparing") }
    val total = orders.sumOf { it.total }
    val activeLocal = CallActivityStore.active(LocalContext.current).size
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        contentPadding = PaddingValues(top = 16.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("أهلاً بك في كن أونلاين 👋", style = MaterialTheme.typography.headlineSmall, color = KunColors.Chrome, fontWeight = FontWeight.ExtraBold)
                Text("نظرة عامة على متجرك • $periodLabel", color = KunColors.Ink2, style = MaterialTheme.typography.bodyMedium)
            }
        }
        item {
            KunSectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Storefront, contentDescription = null, tint = KunColors.Chrome)
                    Spacer(Modifier.width(8.dp))
                    Text("اختيار المتجر", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                    if (storeOptions.isNotEmpty()) Text("${storeOptions.size} متجر", color = KunColors.Ink3, style = MaterialTheme.typography.labelMedium)
                }
                if (storeOptionsLoading) {
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = KunColors.Chrome)
                    Text("جاري تحميل المتاجر المتاحة…", color = KunColors.Ink2)
                } else if (storeOptions.isEmpty()) {
                    Text(storeOptionsError.ifBlank { "لا توجد متاجر متاحة للحساب" }, color = KunColors.Ink2)
                } else {
                    if (storeOptionsError.isNotBlank()) Text(storeOptionsError, color = KunColors.Brick, style = MaterialTheme.typography.bodySmall)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(storeOptions, key = { "${it.clientId}:${it.storeId}" }) { option ->
                            val active = currentStore.clientId == option.clientId && currentStore.storeId == option.storeId
                            OutlinedCard(
                                onClick = { if (!active) onSelectStore(option) },
                                enabled = !storeSwitching,
                                modifier = Modifier.widthIn(min = 185.dp, max = 250.dp),
                                shape = KunRadius,
                                colors = CardDefaults.outlinedCardColors(containerColor = if (active) KunColors.ChromeSoft else KunColors.Surface)
                            ) {
                                Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(if (active) Icons.Outlined.CheckCircle else Icons.Outlined.Storefront, contentDescription = null, tint = KunColors.Chrome, modifier = Modifier.size(19.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text(option.storeName, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                                    }
                                    Text(option.clientName, style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(if (active) "المتجر النشط" else "اضغط للتبديل", color = if (active) KunColors.Pine else KunColors.Ink3, style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                    if (storeOptions.size > 1) Text("كل متجر يعرض بياناته وصلاحياته بشكل مستقل.", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (newOrdersNotice.isNotBlank()) {
            item {
                Surface(color = KunColors.PineSoft, shape = KunRadius) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.NotificationsActive, contentDescription = null, tint = KunColors.Pine)
                        Spacer(Modifier.width(8.dp))
                        Text(newOrdersNotice, color = KunColors.Pine, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KunInfoCard("إجمالي قيمة الطلبات", v25Money(total), Modifier.weight(1f), KunColors.Chrome)
                KunInfoCard("إجمالي الطلبات", orders.size.toString(), Modifier.weight(1f), KunColors.Pine)
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KunInfoCard("بانتظار التأكيد", pending.toString(), Modifier.weight(1f), KunColors.Gold)
                KunInfoCard("تم التأكيد", confirmed.toString(), Modifier.weight(1f), KunColors.Pine)
            }
        }
        item {
            KunSevenDayOrdersTrend(snapshot.raw)
        }
        item {
            KunSectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Apps, contentDescription = null, tint = KunColors.Chrome)
                    Spacer(Modifier.width(7.dp))
                    Text("إجراءات سريعة", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onOpenOrders, modifier = Modifier.weight(1f).heightIn(min = 50.dp), shape = KunRadius) {
                        Icon(Icons.Outlined.ShoppingBag, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("الطلبات", maxLines = 1)
                    }
                    OutlinedButton(onClick = onOpenCustomerService, modifier = Modifier.weight(1f).heightIn(min = 50.dp), shape = KunRadius) {
                        Icon(Icons.Outlined.SupportAgent, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("العملاء", maxLines = 1)
                    }
                }
                OutlinedButton(onClick = onOpenSections, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = KunRadius) {
                    Icon(Icons.Outlined.GridView, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("المخزون • الطباعة • المالية • الحملات وباقي الأقسام")
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KunInfoCard("Caller ID", CustomerCache.count(LocalContext.current).toString(), Modifier.weight(1f), KunColors.Chrome)
                KunInfoCard("جاري التواصل", activeLocal.toString(), Modifier.weight(1f), KunColors.Gold)
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("أحدث الطلبات • $periodLabel", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                TextButton(onClick = onOpenOrders) { Text("عرض الكل") }
            }
        }
        if (orders.isEmpty()) {
            item { V25Empty("لا توجد طلبات في الفترة المختارة") }
        } else {
            items(orders.take(6), key = { it.id }) { order -> V25CompactOrder(order) }
        }
    }
}

@Composable
private fun V25Orders(snapshot: CommerceSnapshot, onRefresh: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(V25OrderFilter.ALL) }
    val orders = remember(snapshot.orders, query, filter) {
        snapshot.orders.filter { order ->
            val stateOk = filter == V25OrderFilter.ALL || order.state in filter.states
            val q = query.trim().lowercase()
            val queryOk = q.isBlank() || listOf(order.ref, order.name, order.phone, order.gov, order.product, order.awb)
                .any { it.lowercase().contains(q) }
            stateOk && queryOk
        }
    }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().background(KunColors.Surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            KunPageIntro("الطلبات", "بطاقات أوضح وإجراءات أسرع للمكالمة والمتابعة")
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("ابحث بالعميل أو الهاتف أو رقم الطلب") },
                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                singleLine = true,
                shape = KunRadius
            )
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                V25OrderFilter.entries.forEach { item ->
                    FilterChip(
                        selected = filter == item,
                        onClick = { filter = item },
                        label = { Text(item.label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = KunColors.PineSoft,
                            selectedLabelColor = KunColors.Pine
                        )
                    )
                }
            }
            Text("${orders.size} طلب • ${MobileDateFilterState.periodLabel}", color = KunColors.Ink2, style = MaterialTheme.typography.labelLarge)
        }
        if (orders.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) { V25Empty("لا توجد طلبات مطابقة") }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 16.dp),
                contentPadding = PaddingValues(vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp)
            ) {
                items(orders, key = { it.id }) { order ->
                    V25OrderCard(
                        order = order,
                        onCall = {
                            CallActivityStore.mark(context, order.id, order.phone, false)
                            scope.launch(Dispatchers.IO) {
                                KunCustomerServiceApi.logContact(context, order.id, "phone", "call")
                                withContext(Dispatchers.Main) { onRefresh() }
                            }
                            v25Dial(context, order.phone)
                        },
                        onWhatsApp = { v25WhatsApp(context, order.phone) }
                    )
                }
            }
        }
    }
}

@Composable
private fun V25CustomerServiceHub(snapshot: CommerceSnapshot, onGlobalRefresh: () -> Unit) {
    var contacting by remember { mutableStateOf(false) }
    val dateRevision = MobileDateFilterState.revision
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().background(KunColors.Surface).padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(
                selected = !contacting,
                onClick = { contacting = false },
                label = { Text("لوحة خدمة العملاء") },
                leadingIcon = { Icon(Icons.Outlined.SupportAgent, null, Modifier.size(18.dp)) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = KunColors.PineSoft, selectedLabelColor = KunColors.Pine)
            )
            FilterChip(
                selected = contacting,
                onClick = { contacting = true },
                label = { Text("جاري التواصل") },
                leadingIcon = { Icon(Icons.Outlined.PhoneInTalk, null, Modifier.size(18.dp)) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = KunColors.GoldSoft, selectedLabelColor = KunColors.Gold)
            )
        }
        key(dateRevision) {
            if (contacting) V25Contacting(onGlobalRefresh)
            else V23CustomerService(snapshot = snapshot, onGlobalRefresh = onGlobalRefresh)
        }
    }
}

@Composable
private fun V25Contacting(onGlobalRefresh: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var board by remember { mutableStateOf(CustomerServiceBoardResult(false, "جاري التحميل…")) }
    var loading by remember { mutableStateOf(true) }
    var tick by remember { mutableLongStateOf(System.currentTimeMillis()) }

    suspend fun loadBoard() {
        val result = withContext(Dispatchers.IO) { KunCustomerServiceApi.fetchBoard(context) }
        board = result
        loading = false
        tick = System.currentTimeMillis()
    }

    ForegroundPolling(Unit, intervalMillis = V25_CONTACT_REFRESH_MS) {
        loadBoard()
    }

    val local = remember(tick) { CallActivityStore.active(context, tick).associateBy { it.orderId } }
    val rows = remember(board.orders, local, tick) {
        board.orders.filter { order ->
            local.containsKey(order.id) || v25RecentCallAt(order, tick) > 0L
        }.sortedByDescending { order -> maxOf(local[order.id]?.startedAt ?: 0L, v25RecentCallAt(order, tick)) }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        contentPadding = PaddingValues(top = 14.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp)
    ) {
        item {
            Surface(color = KunColors.GoldSoft, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(9.dp).background(KunColors.Gold, CircleShape))
                        Spacer(Modifier.width(8.dp))
                        Text("جاري التواصل", fontWeight = FontWeight.ExtraBold, color = KunColors.Ink)
                        Spacer(Modifier.weight(1f))
                        Text(rows.size.toString(), color = KunColors.Gold, fontWeight = FontWeight.ExtraBold)
                    }
                    Text("أي مكالمة مرتبطة بأوردر تظهر هنا تلقائيًا أثناء المتابعة", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (loading && board.orders.isEmpty()) {
            item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = KunColors.Pine) }
        }
        if (!board.ok && !loading) {
            item {
                Surface(color = KunColors.BrickSoft, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
                    Text(board.message, color = KunColors.Brick, modifier = Modifier.padding(14.dp))
                }
            }
        } else if (!loading && rows.isEmpty()) {
            item { V25Empty("لا يوجد أوردر جاري التواصل عليه الآن") }
        } else {
            items(rows, key = { it.id }) { order ->
                val activity = local[order.id]
                V25ContactCard(
                    order = order,
                    direction = when {
                        activity?.incoming == true -> "مكالمة واردة"
                        activity != null -> "مكالمة صادرة"
                        else -> "مكالمة مسجلة"
                    },
                    onCall = {
                        CallActivityStore.mark(context, order.id, order.phone, false)
                        scope.launch(Dispatchers.IO) {
                            KunCustomerServiceApi.logContact(context, order.id, "phone", "call")
                            loadBoard()
                            withContext(Dispatchers.Main) { onGlobalRefresh() }
                        }
                        v25Dial(context, order.phone)
                    },
                    onWhatsApp = { v25WhatsApp(context, order.phone) }
                )
            }
        }
    }
}

@Composable
private fun V25ContactCard(order: CsOrderUi, direction: String, onCall: () -> Unit, onWhatsApp: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = KunRadiusLarge,
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).background(KunColors.GoldSoft, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.PhoneInTalk, null, tint = KunColors.Gold)
                }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text(order.name.ifBlank { "عميل" }, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("#${order.ref} • $direction", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
                }
                V25StatusPill(order.state)
            }
            Text(order.phone.ifBlank { "بدون رقم هاتف" }, color = KunColors.Chrome, fontWeight = FontWeight.Bold)
            if (order.product.isNotBlank()) Text("${order.product} × ${order.qty}", color = KunColors.Ink2)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(v25Money(order.total), fontWeight = FontWeight.ExtraBold, color = KunColors.Ink, modifier = Modifier.weight(1f))
                if (order.contactCount > 0) Text("${order.contactCount} تواصل", color = KunColors.Ink3, style = MaterialTheme.typography.bodySmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCall, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.Call, null)
                    Spacer(Modifier.width(6.dp))
                    Text("اتصال")
                }
                OutlinedButton(onClick = onWhatsApp, modifier = Modifier.weight(1f)) {
                    Text("واتساب")
                }
            }
        }
    }
}

@Composable
private fun V25OrderCard(order: OrderUi, onCall: () -> Unit, onWhatsApp: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = KunRadiusLarge,
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("#${order.ref}", color = KunColors.Ink3, style = MaterialTheme.typography.labelMedium)
                    Text(order.name.ifBlank { "عميل" }, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                V25StatusPill(order.state)
            }
            HorizontalDivider(color = KunColors.Line)
            V25Line(Icons.Outlined.Call, order.phone.ifBlank { "بدون رقم هاتف" })
            if (order.gov.isNotBlank() || order.address.isNotBlank()) V25Line(Icons.Outlined.LocationOn, listOf(order.gov, order.address).filter { it.isNotBlank() }.joinToString(" — "))
            if (order.product.isNotBlank()) V25Line(Icons.Outlined.Inbox, "${order.product} × ${order.qty}")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("الإجمالي", color = KunColors.Ink3, style = MaterialTheme.typography.bodySmall)
                    Text(v25Money(order.total), color = KunColors.Ink, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
                }
                Column(horizontalAlignment = Alignment.End) {
                    if (order.date.isNotBlank()) Text(order.date.take(10), color = KunColors.Ink3, style = MaterialTheme.typography.bodySmall)
                    if (order.source.isNotBlank()) Text(order.source, color = KunColors.Ink3, style = MaterialTheme.typography.bodySmall)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCall, enabled = order.phone.isNotBlank(), modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.Call, null)
                    Spacer(Modifier.width(6.dp))
                    Text("اتصال")
                }
                OutlinedButton(onClick = onWhatsApp, enabled = order.phone.isNotBlank(), modifier = Modifier.weight(1f)) {
                    Text("واتساب")
                }
            }
        }
    }
}

@Composable
private fun V25CompactOrder(order: OrderUi) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
        shape = KunRadius
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).background(KunColors.Surface2, CircleShape), contentAlignment = Alignment.Center) {
                Text(order.name.take(1).ifBlank { "ع" }, color = KunColors.Chrome, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(order.name.ifBlank { "عميل" }, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("#${order.ref} • ${v25State(order.state)}", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
            }
            Text(v25Money(order.total), fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun V25Line(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(icon, null, tint = KunColors.Ink3, modifier = Modifier.size(18.dp))
        Text(text, color = KunColors.Ink2, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun V25StatusPill(state: String) {
    val tone = when (state) {
        "pending", "new", "no_answer", "deferred" -> KunColors.Gold
        "cancelled", "returned" -> KunColors.Brick
        else -> KunColors.Pine
    }
    val bg = when (tone) {
        KunColors.Gold -> KunColors.GoldSoft
        KunColors.Brick -> KunColors.BrickSoft
        else -> KunColors.PineSoft
    }
    Surface(color = bg, shape = CircleShape) {
        Text(v25State(state), color = tone, fontWeight = FontWeight.Bold, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp))
    }
}

@Composable
private fun V25Empty(text: String) {
    Surface(color = KunColors.Surface, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 28.dp, horizontal = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Inbox, null, tint = KunColors.Ink3, modifier = Modifier.size(36.dp))
            Spacer(Modifier.height(8.dp))
            Text(text, color = KunColors.Ink2)
        }
    }
}

@Composable
private fun V25Settings(
    activity: MainActivity,
    snapshot: CommerceSnapshot,
    lastSyncAt: Long,
    onRefresh: () -> Unit,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val roleManager = remember { context.getSystemService(RoleManager::class.java) }
    val callerRole = runCatching { roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) && roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) }.getOrDefault(false)
    val overlay = Settings.canDrawOverlays(context)
    val contacts = context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        KunPageIntro("إعدادات التطبيق", "المكالمات والمزامنة تعمل في الخلفية تلقائيًا")
        KunSectionCard(Modifier.fillMaxWidth()) {
            Text("Caller ID", style = MaterialTheme.typography.titleLarge)
            KunStatusDot(callerRole, if (callerRole) "Caller ID مفعّل" else "فعّل دور Caller ID")
            KunStatusDot(overlay, if (overlay) "الظهور فوق التطبيقات مفعّل" else "اسمح بالظهور فوق التطبيقات")
            KunStatusDot(contacts, if (contacts) "جهات الاتصال مسموحة" else "اسمح بقراءة جهات الاتصال")
            if (!callerRole) Button(onClick = activity::requestCallerRole, modifier = Modifier.fillMaxWidth()) { Text("تفعيل Caller ID") }
            if (!overlay) OutlinedButton(onClick = activity::requestOverlayPermission, modifier = Modifier.fillMaxWidth()) { Text("تفعيل الظهور فوق التطبيقات") }
            if (!contacts) OutlinedButton(onClick = activity::requestContactsPermission, modifier = Modifier.fillMaxWidth()) { Text("السماح بجهات الاتصال") }
        }
        KunSectionCard(Modifier.fillMaxWidth()) {
            Text("المزامنة", style = MaterialTheme.typography.titleLarge)
            Text("• كل 15 ثانية أثناء فتح التطبيق\n• كل 15 دقيقة تقريبًا في الخلفية حسب Android\n• مزامنة فورية عند ورود/فحص مكالمة\n• تغيير المدة يعمل بتحديث Delta واحد فقط", color = KunColors.Ink2)
            Row {
                Column(Modifier.weight(1f)) {
                    Text("الطلبات (${MobileDateFilterState.periodLabel})", color = KunColors.Ink3, style = MaterialTheme.typography.bodySmall)
                    Text(snapshot.orders.size.toString(), fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
                }
                Column(Modifier.weight(1f)) {
                    Text("Caller ID — كامل", color = KunColors.Ink3, style = MaterialTheme.typography.bodySmall)
                    Text(CustomerCache.count(context).toString(), fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
                }
            }
            Text("آخر مزامنة: ${v25RelativeSync(lastSyncAt)}", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
            Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                Icon(Icons.Outlined.Sync, null)
                Spacer(Modifier.width(7.dp))
                Text("مزامنة الآن")
            }
        }
        KunSectionCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("كن أونلاين Android", style = MaterialTheme.typography.titleMedium)
                    Text("الإصدار ${BuildConfig.VERSION_NAME}", color = KunColors.Ink2)
                }
                Surface(color = KunColors.PineSoft, shape = CircleShape) {
                    Text("Native", color = KunColors.Pine, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp), fontWeight = FontWeight.Bold)
                }
            }
        }
        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = KunColors.Brick)
        ) {
            Icon(Icons.Outlined.Logout, null)
            Spacer(Modifier.width(7.dp))
            Text("تسجيل الخروج")
        }
        Spacer(Modifier.height(8.dp))
    }
}

private fun v25RecentCallAt(order: CsOrderUi, now: Long): Long {
    for (index in order.contactLog.length() - 1 downTo 0) {
        val event = order.contactLog.optJSONObject(index) ?: continue
        if (event.optString("type") != "contact" || event.optString("intent") != "call") continue
        val at = runCatching { Instant.parse(event.optString("at")).toEpochMilli() }.getOrNull() ?: continue
        return if (now - at in 0..V25_CONTACT_WINDOW_MS) at else 0L
    }
    return 0L
}

private fun v25Dial(context: android.content.Context, phone: String) {
    val clean = phone.trim()
    if (clean.isBlank()) return
    runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(clean)}"))) }
        .onFailure { Toast.makeText(context, "تعذر فتح الاتصال", Toast.LENGTH_SHORT).show() }
}

private fun v25WhatsApp(context: android.content.Context, phone: String) {
    var digits = phone.filter { it.isDigit() }
    if (digits.startsWith("0020")) digits = digits.drop(2)
    if (digits.startsWith("0") && digits.length == 11) digits = "20${digits.drop(1)}"
    if (digits.isBlank()) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))) }
        .onFailure { Toast.makeText(context, "تعذر فتح واتساب", Toast.LENGTH_SHORT).show() }
}

private fun v25State(state: String): String = when (state) {
    "pending", "new" -> "في انتظار التأكيد"
    "no_answer" -> "العميل لا يرد"
    "confirmed" -> "تم التأكيد"
    "preparing" -> "التجهيز"
    "shipping", "in_shipping", "shipped" -> "جاري الشحن"
    "signed" -> "تم التسليم"
    "collected" -> "تم التحصيل"
    "returned" -> "مرتجع"
    "cancelled" -> "ملغي"
    "deferred" -> "مؤجل"
    else -> state.ifBlank { "بدون حالة" }
}

private fun v25Money(value: Double): String = NumberFormat.getNumberInstance(Locale("ar", "EG")).format(value) + " ج.م"

private fun v25RelativeSync(value: Long): String {
    if (value <= 0L) return "لم تتم بعد"
    val seconds = ((System.currentTimeMillis() - value) / 1000L).coerceAtLeast(0L)
    return when {
        seconds < 10 -> "الآن"
        seconds < 60 -> "منذ $seconds ثانية"
        seconds < 3600 -> "منذ ${seconds / 60} دقيقة"
        else -> "منذ ${seconds / 3600} ساعة"
    }
}
