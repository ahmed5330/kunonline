package com.kunonline.callerid

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SupportAgent
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
        MaterialTheme {
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
                    topBar = {
                        TopAppBar(
                            title = { Text(selected.label) },
                            actions = {
                                if (selected == MobileV23Tab.DASHBOARD) {
                                    IconButton(onClick = { refresh() }, enabled = !loading) {
                                        Icon(Icons.Outlined.Dashboard, contentDescription = "تحديث الداشبورد")
                                    }
                                }
                            }
                        )
                    },
                    bottomBar = {
                        NavigationBar {
                            NavigationBarItem(
                                selected = selected == MobileV23Tab.DASHBOARD,
                                onClick = { selected = MobileV23Tab.DASHBOARD },
                                icon = { Icon(Icons.Outlined.Dashboard, contentDescription = null) },
                                label = { Text("الرئيسية") }
                            )
                            NavigationBarItem(
                                selected = selected == MobileV23Tab.CUSTOMER_SERVICE,
                                onClick = { selected = MobileV23Tab.CUSTOMER_SERVICE },
                                icon = { Icon(Icons.Outlined.SupportAgent, contentDescription = null) },
                                label = { Text("خدمة العملاء") }
                            )
                            NavigationBarItem(
                                selected = selected == MobileV23Tab.SETTINGS,
                                onClick = { selected = MobileV23Tab.SETTINGS },
                                icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                                label = { Text("الإعدادات") }
                            )
                        }
                    }
                ) { padding ->
                    Box(Modifier.fillMaxSize().padding(padding)) {
                        when (selected) {
                            MobileV23Tab.DASHBOARD -> V23Dashboard(
                                snapshot = snapshot ?: CommerceSnapshot(),
                                onQuickCreate = {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.kun-online.com/v2/")))
                                }
                            )
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
                        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
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
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center
    ) {
        Text("Kun Online", fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Commerce OS — Android", style = MaterialTheme.typography.titleMedium)
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
private fun MobileV23Settings(
    activity: MainActivity,
    snapshot: CommerceSnapshot,
    onRefresh: () -> Unit,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("إعدادات التطبيق", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("الإصدار 2.3.0", style = MaterialTheme.typography.bodyMedium)
        FilledTonalButton(onClick = { activity.requestCallerRole() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            Text("تفعيل Caller ID")
        }
        FilledTonalButton(onClick = { activity.requestOverlayPermission() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            Text("السماح بالظهور فوق التطبيقات")
        }
        FilledTonalButton(onClick = { activity.requestContactsPermission() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            Text("السماح بقراءة جهات الاتصال")
        }
        OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("مزامنة الآن") }
        Text("الطلبات المحملة: ${snapshot.orders.size} • العملاء في الكاش: ${CustomerCache.count(context)}")
        OutlinedButton(
            onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.kun-online.com/v2/"))) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
        ) {
            Icon(Icons.Outlined.OpenInNew, contentDescription = null)
            Spacer(Modifier.width(6.dp))
            Text("فتح نسخة الويب الكاملة")
        }
        HorizontalDivider()
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("تسجيل الخروج") }
    }
}
