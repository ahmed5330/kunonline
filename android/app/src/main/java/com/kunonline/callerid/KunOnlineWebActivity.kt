package com.kunonline.callerid

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class KunOnlineWebActivity : Activity() {
    companion object {
        const val SYSTEM_URL = "https://app.kun-online.com/v2/"
        private const val ALLOWED_HOST = "app.kun-online.com"
    }

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    return handleNavigation(uri)
                }

                @Deprecated("Deprecated in Java")
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    val uri = url?.let(Uri::parse) ?: return false
                    return handleNavigation(uri)
                }
            }
        }

        val cookies = CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        KunApi.sessionCookie(this)?.takeIf { it.isNotBlank() }?.let {
            cookies.setCookie("https://$ALLOWED_HOST", it)
            cookies.flush()
        }

        setContentView(webView)
        webView.loadUrl(resolveStartUrl(intent?.data))
    }

    private fun resolveStartUrl(uri: Uri?): String {
        if (uri == null) return SYSTEM_URL
        val isAllowed = uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(ALLOWED_HOST, ignoreCase = true) &&
            (uri.path ?: "/").startsWith("/v2")
        return if (isAllowed) uri.toString() else SYSTEM_URL
    }

    private fun handleNavigation(uri: Uri): Boolean {
        val isAllowed = uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(ALLOWED_HOST, ignoreCase = true)
        if (isAllowed) return false

        return runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        }.getOrDefault(true)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.destroy()
        }
        super.onDestroy()
    }
}
