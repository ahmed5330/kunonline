package com.kunonline.mobile

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var pendingPhone: String? = null
    private val callPermissionRequest = 2001
    private val callerIdRoleRequest = 2002
    private val contactsPermissionRequest = 2003
    private val kunBaseUri by lazy { Uri.parse(BuildConfig.KUN_BASE_URL) }

    private inner class LoginCookieBridge {
        @JavascriptInterface
        fun onLoginResponse() {
            runOnUiThread {
                CookieManager.getInstance().flush()
            }
        }

        @JavascriptInterface
        fun requestAppUpdate() {
            runOnUiThread { AppUpdateManager.check(this@MainActivity, userInitiated = true) }
        }

        @JavascriptInterface
        fun appVersionCode(): Int = BuildConfig.VERSION_CODE
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            flush()
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            addJavascriptInterface(LoginCookieBridge(), "KunNative")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.scheme.equals("tel", true)) {
                        placeCall(uri.schemeSpecificPart ?: "")
                        return true
                    }
                    if ((uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) && !isKunOrigin(uri)) {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        return true
                    }
                    return false
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (view == null || !isKunUrl(url)) return
                    installLoginCookieGuard(view)
                }
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        setContentView(webView)

        val target = if (intent.getBooleanExtra(EXTRA_FROM_CALLER_ID, false)) {
            "${BuildConfig.KUN_BASE_URL}/v2/?view=customers"
        } else {
            "${BuildConfig.KUN_BASE_URL}/v2/"
        }
        webView.loadUrl(target)
        requestCallerIdRoleIfNeeded()
        Handler(Looper.getMainLooper()).postDelayed({
            if (!isFinishing) AppUpdateManager.check(this, userInitiated = false)
        }, 2500)
    }

    override fun onResume() {
        super.onResume()
        AppUpdateManager.resumePendingInstall(this)
    }

    private fun installLoginCookieGuard(view: WebView) {
        val script = """
            (function(){
              if(window.__kunNativeLoginCookieGuard)return;
              window.__kunNativeLoginCookieGuard=true;
              var upstream=window.fetch.bind(window);
              window.fetch=async function(input,init){
                var response=await upstream(input,init);
                try{
                  var raw=typeof input==='string'?input:(input&&input.url)||'';
                  var target=new URL(raw,location.href);
                  if(target.origin===location.origin&&target.pathname==='/api/login'&&response.ok){
                    if(window.KunNative&&typeof window.KunNative.onLoginResponse==='function')window.KunNative.onLoginResponse();
                    await new Promise(function(resolve){setTimeout(resolve,550);});
                  }
                }catch(e){}
                return response;
              };
            })();
        """.trimIndent()
        view.evaluateJavascript(script, null)
    }

    private fun isKunUrl(url: String?): Boolean {
        val uri = runCatching { Uri.parse(url ?: "") }.getOrNull() ?: return false
        return isKunOrigin(uri)
    }

    private fun isKunOrigin(uri: Uri): Boolean {
        return uri.scheme.equals(kunBaseUri.scheme, true) && uri.host.equals(kunBaseUri.host, true)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.getBooleanExtra(EXTRA_FROM_CALLER_ID, false) == true) {
            webView.loadUrl("${BuildConfig.KUN_BASE_URL}/v2/?view=customers")
        }
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    private fun requestCallerIdRoleIfNeeded() {
        val roleManager = getSystemService(RoleManager::class.java)
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) return
        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            requestContactsCoverageIfNeeded()
            return
        }

        AlertDialog.Builder(this)
            .setTitle("تفعيل معرفة العميل المتصل")
            .setMessage("اختار Kun Online كتطبيق Caller ID علشان يظهر اسم العميل وبياناته وقت المكالمة.")
            .setPositiveButton("تفعيل") { _, _ ->
                startActivityForResult(
                    roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING),
                    callerIdRoleRequest
                )
            }
            .setNegativeButton("لاحقًا", null)
            .show()
    }

    private fun requestContactsCoverageIfNeeded() {
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("kun_mobile", MODE_PRIVATE)
        if (prefs.getBoolean("contactsCoverageAsked", false)) return
        prefs.edit().putBoolean("contactsCoverageAsked", true).apply()
        AlertDialog.Builder(this)
            .setTitle("إظهار Kun Online لكل المكالمات")
            .setMessage("Android يحتاج إذن جهات الاتصال فقط لكي يرسل لتطبيق Caller ID المكالمات من أرقام محفوظة عندك. Kun Online لا يقرأ أو يرفع دفتر جهات الاتصال؛ المطابقة تتم مع عملاء المتجر داخل النظام.")
            .setPositiveButton("السماح") { _, _ ->
                requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), contactsPermissionRequest)
            }
            .setNegativeButton("تخطي", null)
            .show()
    }

    private fun placeCall(raw: String) {
        val phone = raw.trim()
        if (phone.isEmpty()) return
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(phone)}")))
        } else {
            pendingPhone = phone
            requestPermissions(arrayOf(Manifest.permission.CALL_PHONE), callPermissionRequest)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == contactsPermissionRequest) return
        if (requestCode != callPermissionRequest) return
        val phone = pendingPhone.also { pendingPhone = null } ?: return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(phone)}")))
        } else {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")))
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == callerIdRoleRequest && resultCode == RESULT_OK) {
            requestContactsCoverageIfNeeded()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        const val EXTRA_FROM_CALLER_ID = "fromCallerId"
    }
}
