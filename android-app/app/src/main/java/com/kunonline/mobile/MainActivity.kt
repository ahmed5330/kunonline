package com.kunonline.mobile

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var pendingPhone: String? = null
    private val callPermissionRequest = 2001
    private val callerIdRoleRequest = 2002

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.scheme.equals("tel", true)) {
                        placeCall(uri.schemeSpecificPart ?: "")
                        return true
                    }
                    return false
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
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.getBooleanExtra(EXTRA_FROM_CALLER_ID, false) == true) {
            webView.loadUrl("${BuildConfig.KUN_BASE_URL}/v2/?view=customers")
        }
    }

    private fun requestCallerIdRoleIfNeeded() {
        val roleManager = getSystemService(RoleManager::class.java)
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) ||
            roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) return

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
        if (requestCode != callPermissionRequest) return
        val phone = pendingPhone.also { pendingPhone = null } ?: return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(phone)}")))
        } else {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")))
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
