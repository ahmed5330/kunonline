package com.kunonline.callerid

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlin.concurrent.thread

/**
 * Registers only this Firebase installation. The server derives every
 * authorized client/store grant itself; no tenant IDs are submitted by Android.
 * Without an owner-supplied google-services.json the integration stays inert.
 */
internal object MobilePushRegistration {
    private const val PREFS = "kun_fcm_installation_v1"
    private const val KEY = "installation_id"
    private const val ENDPOINT = "https://app.kun-online.com/api/mobile/push-devices"

    @Synchronized private fun installationId(context: Context): String {
        SecureStore.get(context, PREFS, KEY)?.takeIf { it.length in 20..128 }?.let { return it }
        val created = UUID.randomUUID().toString()
        SecureStore.put(context, PREFS, KEY, created)
        return created
    }

    internal fun isConfigured(context: Context): Boolean =
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    fun refreshAsync(context: Context) {
        if (!KunApi.hasSession(context) || !isConfigured(context)) return
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                thread(name = "kun-fcm-register") { register(context.applicationContext, token) }
            }
            .addOnFailureListener { Log.w("KunFCM", "Firebase token unavailable") }
    }

    fun onTokenRotated(context: Context, token: String) {
        if (!KunApi.hasSession(context) || token.isBlank()) return
        thread(name = "kun-fcm-rotate") { register(context.applicationContext, token) }
    }

    private fun register(context: Context, token: String) {
        val cookie = KunApi.sessionCookie(context) ?: return
        val id = installationId(context)
        val request = JSONObject().put("installationId", id).put("token", token)
        val success = request("POST", cookie, request)
        if (success && KunApi.sessionCookie(context) != cookie) {
            // Login switched while network was pending: best effort to revoke
            // the old session's installation without using the new credentials.
            request("DELETE", cookie, JSONObject().put("installationId", id))
        }
    }

    fun revokeAsync(context: Context) {
        val cookie = KunApi.sessionCookie(context) ?: return
        val id = installationId(context)
        thread(name = "kun-fcm-revoke") {
            request("DELETE", cookie, JSONObject().put("installationId", id))
        }
    }

    private fun request(method: String, cookie: String, payload: JSONObject): Boolean {
        return runCatching {
            val connection = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 6_000
                readTimeout = 8_000
                doOutput = true
                setRequestProperty("Cookie", cookie)
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
            }
            try {
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                connection.responseCode in 200..299
            } finally {
                connection.disconnect()
            }
        }.getOrDefault(false)
    }
}
