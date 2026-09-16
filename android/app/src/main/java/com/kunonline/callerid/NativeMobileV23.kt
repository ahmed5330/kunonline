package com.kunonline.callerid

import android.Manifest
import android.app.role.RoleManager
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale

private enum class MobileV23Tab(val label: String) {
    DASHBOARD("الداشبورد"),
    CUSTOMER_SERVICE("خدمة العملاء"),
    SETTINGS("الإعدادات")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KunNativeAppV23(activity: MainActivity) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loggedIn by remember { mutableStateOf(KunApi.hasSession(context)) }
    var snapshot by remember { mutableStateOf<CommerceSnapshot?>(null) }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(MobileV23Tab.DASHBOARD) }

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
        KunTheme {
            if (!loggedIn) {
                MobileV23Login(
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
            } else {
                Scaffold(
                    containerColor = KunColors.Ground,
                    topBar = {
                        TopAppBar(
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = KunColors.Chrome,
                                titleContentColor = Color.White,
                                actionIconContentColor = Color.White,
                                navigationIconContentColor = Color.White
                            ),
                            title = {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    KunBrandMark(Modifier.size(32.dp))
                                    Column {
                                        Text(selected.label, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                        Text("كن أونلاين", fontSize = 11.sp, color = Color.White.copy(alpha = .72f))
                                    }
                                }
                            },
                            actions = {
                                if (selected != MobileV23Tab.SETTINGS) {
                                    IconButton(onClick = { refresh() }, enabled = !loading) {
                                        Icon(Icons.Outlined.Refresh, contentDescription = "تحديث")
                                    }
                                }
                            }
                        )
                    },
                    bottomBar = {
                        NavigationBar(containerColor = KunColors.Surface, tonalElevation = 8.dp) {
                            val colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = KunColors.Pine,
                                selectedTextColor = KunColors.Pine,
                                indicatorColor = KunColors.PineSoft,
                                unselectedIconColor = KunColors.Ink3,
                                unselectedTextColor = KunColors.Ink2
                            )
                            NavigationBarItem(
                                selected = selected == MobileV23Tab.DASHBOARD,
                                onClick = { selected = MobileV23Tab.DASHBOARD },
                                icon = { Icon(Icons.Outlined.Dashboard, contentDescription = null) },
                                label = { Text("الرئيسية") },
                                colors = colors
                            )
                            NavigationBarItem(
                                selected = selected == MobileV23Tab.CUSTOMER_SERVICE,
                                onClick = { selected = MobileV23Tab.CUSTOMER_SERVICE },
                                icon = { Icon(Icons.Outlined.SupportAgent, contentDescription = null) },
                                label = { Text("خدمة العملاء") },
                                colors = colors
                            )
                            NavigationBarItem(
                                selected = selected == MobileV23Tab.SETTINGS,
                                onClick = { selected = MobileV23Tab.SETTINGS },
                                icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                                label = { Text("الإعدادات") },
                                colors = colors
                            )
                        }
                    }
                ) { padding ->
                    Box(Modifier.fillMaxSize().padding(padding)) {
                        when (selected) {
                            MobileV23Tab.DASHBOARD -> V24Dashboard(snapshot ?: CommerceSnapshot())
                            MobileV23Tab.CUSTOMER_SERVICE -> V23CustomerService(
                                snapshot = snapshot ?: CommerceSnapshot(),
                                onGlobalRefresh = { refresh() }
                            )
                            MobileV23Tab.SETTINGS -> MobileV23Settings(
                                activity = activity,
                                snapshot = snapshot ?: CommerceSnapshot(),
                                onRefresh = { refresh() },
                                onLogout = {
                                    KunApi.logout(context)
                                    SyncJobService.cancel(context)
                                    loggedIn = false
                                    snapshot = null
                                }
                            )
                        }
                        if (loading) LinearProgressIndicator(
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

@Composable
private fun MobileV23Login(
    busy: Boolean,
    message: String,
    onLogin: (String, String) -> Unit
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier.fillMaxSize().background(KunColors.Ground).padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.fillMaxWidth().widthIn(max = 460.dp),
            shape = KunRadiusLarge,
            colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(Modifier.size(62.dp).clip(CircleShape).background(KunColors.Chrome), contentAlignment = Alignment.Center) {
                    Text("كُن", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                }
                Text("كن أونلاين", style = MaterialTheme.typography.headlineMedium, color = KunColors.Ink)
                Text("نظام تشغيل وإدارة التجارة الإلكترونية", style = MaterialTheme.typography.bodyMedium, color = KunColors.Ink2)
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريد الإلكتروني") },
                    leadingIcon = { Icon(Icons.Outlined.Email, contentDescription = null) },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    shape = KunRadius
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("كلمة المرور") },
                    leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, contentDescription = null)
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
                    else Text("تسجيل الدخول", fontWeight = FontWeight.Bold)
                }
                if (message.isNotBlank()) {
                    Surface(color = KunColors.BrickSoft, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
                        Text(message, color = KunColors.Brick, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun V24Dashboard(snapshot: CommerceSnapshot) {
    var range by remember { mutableStateOf(DashboardRange.TODAY) }
    val orders = remember(snapshot.orders, range) { v23FilterOrders(snapshot.orders, range) }
    val total = orders.sumOf { it.total }
    val aov = if (orders.isEmpty()) 0.0 else total / orders.size
    val pending = orders.count { it.state in setOf("pending", "new") }
    val noAnswer = orders.count { it.state == "no_answer" }
    val confirmed = orders.count { it.state in setOf("confirmed", "preparing", "shipped", "signed", "collected") }
    val shipped = orders.count { it.state in setOf("shipped", "signed", "collected") }
    val collected = orders.count { it.state == "collected" }
    val returned = orders.count { it.state == "returned" }
    val cancelled = orders.count { it.state == "cancelled" }
    val confirmRate = if (orders.isEmpty()) 0.0 else confirmed * 100.0 / orders.size
    val collectionRate = if (orders.isEmpty()) 0.0 else collected * 100.0 / orders.size

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        KunPageIntro("لوحة التحكم", "مؤشرات التشغيل والمبيعات حسب الفترة المختارة")
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            DashboardRange.entries.forEach { item ->
                FilterChip(
                    selected = range == item,
                    onClick = { range = item },
                    label = { Text(item.label) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = KunColors.PineSoft,
                        selectedLabelColor = KunColors.Pine
                    )
                )
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = KunRadiusLarge,
            colors = CardDefaults.cardColors(containerColor = KunColors.Chrome)
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("إجمالي المبيعات", color = Color.White.copy(alpha = .72f), style = MaterialTheme.typography.labelLarge)
                Text(v24Money(total), color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(color = Color.White.copy(alpha = .10f), shape = CircleShape) {
                        Text("${orders.size} طلب", color = Color.White, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                    Surface(color = Color.White.copy(alpha = .10f), shape = CircleShape) {
                        Text("تأكيد ${v24Percent(confirmRate)}", color = Color.White, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KunInfoCard("متوسط الطلب", v24Money(aov), Modifier.weight(1f), KunColors.Pine)
            KunInfoCard("نسبة التحصيل", v24Percent(collectionRate), Modifier.weight(1f), KunColors.Gold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KunInfoCard("لا يرد", noAnswer.toString(), Modifier.weight(1f), KunColors.Gold)
            KunInfoCard("إلغاء / مرتجع", (cancelled + returned).toString(), Modifier.weight(1f), KunColors.Brick)
        }

        KunSectionCard(Modifier.fillMaxWidth()) {
            Text("حركة الطلبات", style = MaterialTheme.typography.titleLarge)
            V24FlowRow("جديد / انتظار التأكيد", pending, orders.size, KunColors.Gold)
            V24FlowRow("تم التأكيد وما بعده", confirmed, orders.size, KunColors.Pine)
            V24FlowRow("دخل الشحن", shipped, orders.size, KunColors.Chrome)
            V24FlowRow("تم التحصيل", collected, orders.size, KunColors.Pine)
            V24FlowRow("مرتجع", returned, orders.size, KunColors.Brick)
            V24FlowRow("ملغي", cancelled, orders.size, KunColors.Brick)
        }

        KunSectionCard(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("أحدث الطلبات", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Text("${orders.size}", color = KunColors.Ink3, style = MaterialTheme.typography.labelLarge)
            }
            if (orders.isEmpty()) {
                Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Outlined.Inbox, contentDescription = null, tint = KunColors.Ink3, modifier = Modifier.size(38.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("لا توجد طلبات في الفترة المختارة", color = KunColors.Ink2)
                }
            } else {
                orders.take(8).forEachIndexed { index, order ->
                    if (index > 0) HorizontalDivider(color = KunColors.Line)
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(38.dp).background(KunColors.Surface2, CircleShape), contentAlignment = Alignment.Center) {
                            Text(order.name.take(1).ifBlank { "ع" }, color = KunColors.Chrome, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(order.name.ifBlank { "عميل" }, fontWeight = FontWeight.Bold, color = KunColors.Ink)
                            Text("#${order.ref} • ${v24State(order.state)}", style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                        }
                        Text(v24Money(order.total), fontWeight = FontWeight.Bold, color = KunColors.Ink)
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun V24FlowRow(label: String, value: Int, total: Int, tone: Color) {
    val fraction = if (total <= 0) 0f else (value.toFloat() / total.toFloat()).coerceIn(0f, 1f)
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, modifier = Modifier.weight(1f), color = KunColors.Ink2)
            Text(value.toString(), fontWeight = FontWeight.Bold, color = KunColors.Ink)
        }
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
            color = tone,
            trackColor = KunColors.Surface2
        )
    }
}

@Composable
private fun MobileV23Settings(
    activity: MainActivity,
    snapshot: CommerceSnapshot,
    onRefresh: () -> Unit,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val roleManager = remember { context.getSystemService(RoleManager::class.java) }
    val callerRole = runCatching {
        roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) && roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
    }.getOrDefault(false)
    val overlay = Settings.canDrawOverlays(context)
    val contacts = context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        KunPageIntro("إعدادات التطبيق", "Caller ID والمزامنة وإدارة الجلسة")

        KunSectionCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).background(KunColors.ChromeSoft, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.PhoneInTalk, contentDescription = null, tint = KunColors.Chrome)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("جاهزية Caller ID", style = MaterialTheme.typography.titleMedium)
                    Text(if (callerRole && overlay && contacts) "جاهز للمكالمات الواردة والصادرة" else "أكمل الخطوات الناقصة", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
                }
            }
            KunStatusDot(callerRole, if (callerRole) "Kun Online هو تطبيق فحص المكالمات" else "تفعيل دور Caller ID")
            KunStatusDot(overlay, if (overlay) "الظهور فوق التطبيقات مسموح" else "السماح بالظهور فوق التطبيقات")
            KunStatusDot(contacts, if (contacts) "جهات الاتصال مسموحة — مهم للوارد" else "السماح بجهات الاتصال — مطلوب للوارد المحفوظ")
            if (!callerRole) Button(onClick = { activity.requestCallerRole() }, modifier = Modifier.fillMaxWidth()) { Text("تفعيل Caller ID") }
            if (!overlay) OutlinedButton(onClick = { activity.requestOverlayPermission() }, modifier = Modifier.fillMaxWidth()) { Text("تفعيل الظهور فوق التطبيقات") }
            if (!contacts) OutlinedButton(onClick = { activity.requestContactsPermission() }, modifier = Modifier.fillMaxWidth()) { Text("السماح بجهات الاتصال") }
        }

        KunSectionCard(Modifier.fillMaxWidth()) {
            Text("المزامنة المحلية", style = MaterialTheme.typography.titleMedium)
            Row(Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("الطلبات المحملة", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
                    Text(snapshot.orders.size.toString(), style = MaterialTheme.typography.titleLarge)
                }
                Column(Modifier.weight(1f)) {
                    Text("عملاء Caller ID", color = KunColors.Ink2, style = MaterialTheme.typography.bodySmall)
                    Text(CustomerCache.count(context).toString(), style = MaterialTheme.typography.titleLarge)
                }
            }
            Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                Icon(Icons.Outlined.Sync, contentDescription = null)
                Spacer(Modifier.width(7.dp))
                Text("مزامنة الآن")
            }
        }

        KunSectionCard(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("كن أونلاين Android", style = MaterialTheme.typography.titleMedium)
                    Text("الإصدار 2.4.0", color = KunColors.Ink2)
                }
                Surface(color = KunColors.PineSoft, shape = CircleShape) {
                    Text("Native", color = KunColors.Pine, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp), fontWeight = FontWeight.Bold)
                }
            }
        }

        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = KunColors.Brick),
            border = ButtonDefaults.outlinedButtonBorder.copy(brush = androidx.compose.ui.graphics.SolidColor(KunColors.Brick))
        ) {
            Icon(Icons.Outlined.Logout, contentDescription = null)
            Spacer(Modifier.width(7.dp))
            Text("تسجيل الخروج")
        }
        Spacer(Modifier.height(8.dp))
    }
}

private fun v24Money(value: Double): String = NumberFormat.getNumberInstance(Locale("ar", "EG")).format(value) + " ج.م"
private fun v24Percent(value: Double): String = String.format(Locale.US, "%.1f%%", value)
private fun v24State(state: String): String = when (state) {
    "pending", "new" -> "في انتظار التأكيد"
    "no_answer" -> "لا يرد"
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
