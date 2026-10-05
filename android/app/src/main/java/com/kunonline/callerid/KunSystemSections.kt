package com.kunonline.callerid

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject

private const val SYSTEM_URL = "https://app.kun-online.com/v2/"
private const val SYSTEM_ORIGIN = "https://app.kun-online.com"

private data class SystemSection(
    val view: String,
    val label: String,
    val group: String
)

private val SYSTEM_SECTIONS = listOf(
    SystemSection("dashboard", "الداشبورد", "الرئيسية والتحكم"),
    SystemSection("intelligence", "مركز الذكاء", "الرئيسية والتحكم"),
    SystemSection("onboarding", "بدء الاستخدام", "الرئيسية والتحكم"),
    SystemSection("readiness", "جاهزية النظام", "الرئيسية والتحكم"),
    SystemSection("stores", "المتاجر والفروع", "الرئيسية والتحكم"),
    SystemSection("store-access", "صلاحيات الفروع", "الرئيسية والتحكم"),
    SystemSection("control", "الحساب والتكاملات", "الرئيسية والتحكم"),
    SystemSection("settings", "الإعدادات", "الرئيسية والتحكم"),

    SystemSection("pos", "نقطة البيع POS", "المبيعات والعملاء"),
    SystemSection("orders", "الطلبات", "المبيعات والعملاء"),
    SystemSection("customer-service", "خدمة العملاء", "المبيعات والعملاء"),
    SystemSection("customers", "إدارة العملاء", "المبيعات والعملاء"),
    SystemSection("inbox", "صندوق الرسائل", "المبيعات والعملاء"),

    SystemSection("products", "المنتجات", "المنتجات والمخزون"),
    SystemSection("inventory", "المخزون", "المنتجات والمخزون"),
    SystemSection("suppliers", "الموردون", "المنتجات والمخزون"),
    SystemSection("procurement", "المشتريات", "المنتجات والمخزون"),
    SystemSection("supplier-finance", "حسابات الموردين", "المنتجات والمخزون"),

    SystemSection("printing", "الطباعة", "الشحن والمرتجعات"),
    SystemSection("post-shipping", "متابعة الشحن", "الشحن والمرتجعات"),
    SystemSection("shipping", "إعدادات الشحن", "الشحن والمرتجعات"),
    SystemSection("returns-exchanges", "المرتجعات والاستبدالات", "الشحن والمرتجعات"),
    SystemSection("cod", "تسويات COD", "الشحن والمرتجعات"),

    SystemSection("campaigns", "الحملات", "التسويق والذكاء"),
    SystemSection("marketing", "التسويق", "التسويق والذكاء"),
    SystemSection("ad-studio", "AI Ad Studio", "التسويق والذكاء"),
    SystemSection("analytics", "التحليلات", "التسويق والذكاء"),
    SystemSection("automation", "الأتمتة", "التسويق والذكاء"),
    SystemSection("ai", "kun AI", "التسويق والذكاء"),

    SystemSection("finance", "المالية", "المالية والحسابات"),
    SystemSection("accounting", "الحسابات والحركات", "المالية والحسابات"),
    SystemSection("profit", "Profit Intelligence", "المالية والحسابات"),
    SystemSection("wallet", "المحفظة", "المالية والحسابات"),

    SystemSection("integrations", "مركز التكاملات", "التشغيل والإدارة"),
    SystemSection("access", "الفريق والصلاحيات", "التشغيل والإدارة"),
    SystemSection("approvals", "مركز الموافقات", "التشغيل والإدارة"),
    SystemSection("ops", "مركز التشغيل", "التشغيل والإدارة"),
    SystemSection("audit", "سجل النشاط", "التشغيل والإدارة"),
    SystemSection("admin-clients", "Kun Admin", "التشغيل والإدارة")
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileSystemSectionsDialog(onDismiss: () -> Unit) {
    var selected by remember { mutableStateOf<SystemSection?>(null) }
    var query by remember { mutableStateOf("") }

    BackHandler {
        if (selected != null) selected = null else onDismiss()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnClickOutside = false
        )
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = KunColors.Ground) {
            if (selected == null) {
                Column(Modifier.fillMaxSize()) {
                    TopAppBar(
                        title = {
                            Column {
                                Text("كل أقسام كن أونلاين", fontWeight = FontWeight.ExtraBold)
                                Text(
                                    "${SYSTEM_SECTIONS.size} قسمًا من النظام الكامل",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = Color.White.copy(alpha = .72f)
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

                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                        label = { Text("ابحث عن قسم") },
                        singleLine = true,
                        shape = RoundedCornerShape(16.dp)
                    )

                    val normalized = query.trim()
                    val filtered = remember(normalized) {
                        if (normalized.isBlank()) SYSTEM_SECTIONS
                        else SYSTEM_SECTIONS.filter {
                            it.label.contains(normalized, ignoreCase = true) ||
                                it.group.contains(normalized, ignoreCase = true) ||
                                it.view.contains(normalized, ignoreCase = true)
                        }
                    }

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 2.dp, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(filtered, key = { it.view }) { section ->
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { selected = section },
                                shape = RoundedCornerShape(18.dp),
                                colors = CardDefaults.cardColors(containerColor = KunColors.Surface)
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(13.dp),
                                        color = KunColors.PineSoft
                                    ) {
                                        Box(
                                            modifier = Modifier.size(42.dp),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Icon(
                                                Icons.Outlined.GridView,
                                                contentDescription = null,
                                                tint = KunColors.Pine
                                            )
                                        }
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            section.label,
                                            fontWeight = FontWeight.Bold,
                                            color = KunColors.Ink
                                        )
                                        Text(
                                            section.group,
                                            style = MaterialTheme.typography.labelMedium,
                                            color = KunColors.Ink2
                                        )
                                    }
                                    Icon(
                                        Icons.Outlined.OpenInNew,
                                        contentDescription = null,
                                        tint = KunColors.Ink3
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                SystemSectionWebView(
                    section = selected!!,
                    onBack = { selected = null }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SystemSectionWebView(section: SystemSection, onBack: () -> Unit) {
    val context = LocalContext.current
    val sessionCookie = remember { KunApi.sessionCookie(context).orEmpty() }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

    val filePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    DisposableEffect(Unit) {
        onDispose {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            webView?.stopLoading()
            webView?.destroy()
            webView = null
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text(section.label, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        "نسخة النظام الكاملة داخل التطبيق",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = .72f)
                    )
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Outlined.ArrowBack, contentDescription = "العودة للأقسام")
                }
            },
            actions = {
                IconButton(onClick = { webView?.reload() }) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "تحديث")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = KunColors.Chrome,
                titleContentColor = Color.White,
                navigationIconContentColor = Color.White,
                actionIconContentColor = Color.White
            )
        )

        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { androidContext ->
                WebView(androidContext).apply {
                    webView = this

                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.databaseEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = true
                    settings.setSupportZoom(false)
                    settings.builtInZoomControls = false
                    settings.displayZoomControls = false
                    settings.mediaPlaybackRequiresUserGesture = true
                    settings.userAgentString = settings.userAgentString + " KunOnlineNative/2.7.0"

                    val cookies = CookieManager.getInstance()
                    cookies.setAcceptCookie(true)
                    cookies.setAcceptThirdPartyCookies(this, true)
                    if (sessionCookie.isNotBlank()) {
                        cookies.setCookie(
                            SYSTEM_ORIGIN,
                            "$sessionCookie; Path=/; Secure; SameSite=Lax"
                        )
                        cookies.flush()
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onShowFileChooser(
                            webView: WebView?,
                            callback: ValueCallback<Array<Uri>>?,
                            fileChooserParams: FileChooserParams?
                        ): Boolean {
                            fileCallback?.onReceiveValue(null)
                            fileCallback = callback
                            val accept = fileChooserParams?.acceptTypes
                                ?.map { it.trim() }
                                ?.filter { it.isNotBlank() }
                                ?.distinct()
                                ?.toTypedArray()
                                ?.takeIf { it.isNotEmpty() }
                                ?: arrayOf("*/*")
                            filePicker.launch(accept)
                            return true
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val uri = request?.url ?: return false
                            if (uri.host.equals("app.kun-online.com", ignoreCase = true)) return false
                            return runCatching {
                                androidContext.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                true
                            }.getOrDefault(false)
                        }

                        override fun onPageFinished(view: WebView, url: String?) {
                            super.onPageFinished(view, url)
                            view.evaluateJavascript(openSectionScript(section.view), null)
                        }
                    }

                    setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                        if (url.isNullOrBlank()) return@setDownloadListener
                        val ok = runCatching {
                            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                            val request = DownloadManager.Request(Uri.parse(url)).apply {
                                setTitle(fileName)
                                setDescription("تنزيل من كن أونلاين")
                                if (!mimeType.isNullOrBlank()) setMimeType(mimeType)
                                addRequestHeader("User-Agent", userAgent.orEmpty())
                                if (sessionCookie.isNotBlank()) addRequestHeader("Cookie", sessionCookie)
                                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                            }
                            val manager = androidContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                            manager.enqueue(request)
                            true
                        }.getOrDefault(false)
                        Toast.makeText(
                            androidContext,
                            if (ok) "بدأ التنزيل" else "تعذر بدء التنزيل",
                            Toast.LENGTH_SHORT
                        ).show()
                    }

                    loadUrl(SYSTEM_URL)
                }
            },
            update = { current ->
                webView = current
            }
        )
    }
}

private fun openSectionScript(viewKey: String): String {
    val key = JSONObject.quote(viewKey)
    return """
        (function(){
          var key=$key;
          var tries=0;
          function openSection(){
            var btn=document.querySelector('[data-view="'+key+'"]');
            var download=document.getElementById('androidDownload');
            if(download) download.style.display='none';
            if(!btn) return false;
            btn.click();
            return true;
          }
          if(!openSection()){
            var timer=setInterval(function(){
              tries++;
              if(openSection() || tries>=24) clearInterval(timer);
            },250);
          }
        })();
    """.trimIndent()
}
