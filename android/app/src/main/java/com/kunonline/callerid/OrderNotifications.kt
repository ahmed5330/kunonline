package com.kunonline.callerid

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

/** Notification channels are stable per (client, store). Users pick each sound in Android settings. */
object OrderNotifications {
    private const val BASE_URL = "https://app.kun-online.com"
    private const val PREFS = "kun_order_alerts"
    private const val PREFIX = "kun_orders_"
    private const val MAX_PAGES = 4

    internal fun channelId(clientId: String, storeId: String): String {
        val bytes = MessageDigest.getInstance("SHA-256")
            .digest("$clientId:\u0000$storeId".toByteArray(Charsets.UTF_8))
        return PREFIX + bytes.take(12).joinToString("") { "%02x".format(it) }
    }

    fun permissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun openPermissionSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun channel(context: Context, clientId: String, storeId: String, storeName: String): String {
        val id = channelId(clientId, storeId)
        val manager = context.getSystemService(NotificationManager::class.java)
        // createNotificationChannel never overwrites the user's chosen sound, vibration or enabled state.
        manager?.createNotificationChannel(
            NotificationChannel(id, "الطلبات الجديدة · $storeName", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "تنبيهات الطلبات الجديدة لمتجر $storeName — يمكن تخصيص صوت مختلف من إعدادات القناة."
                enableVibration(true)
            }
        )
        return id
    }

    fun openStoreSoundSettings(context: Context, store: MobileStoreOption) {
        val id = channel(context, store.clientId, store.storeId, store.storeName)
        val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            putExtra(Settings.EXTRA_CHANNEL_ID, id)
            if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun sendTest(context: Context, store: MobileStoreOption) {
        show(context, store.clientId, store.storeId, store.storeName, "اختبار صوت إشعار المتجر", "اختبار")
    }

    private fun show(context: Context, clientId: String, storeId: String, storeName: String, message: String, orderId: String) {
        val id = channel(context, clientId, storeId, storeName)
        if (!permissionGranted(context)) return
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, id)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(storeName)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        val key = "$clientId:$storeId:$orderId"
        val identifier = key.hashCode().and(0x7fffffff)
        context.getSystemService(NotificationManager::class.java)?.notify(identifier, notification)
    }

    /** Run from either a foreground coroutine (on IO) or existing 15-minute background job. */
    @Synchronized fun poll(context: Context): Boolean {
        val cookie = KunApi.sessionCookie(context) ?: return false
        val session = sha(cookie).take(20)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var after = prefs.getString("after_$session", null)
        var afterId = prefs.getString("id_$session", "").orEmpty()
        for (page in 0 until MAX_PAGES) {
            val path = if (after == null) "/api/mobile/order-alerts" else
                "/api/mobile/order-alerts?after=${enc(after)}&afterId=${enc(afterId)}"
            val response = runCatching {
                val connection = (URL(BASE_URL + path).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 10_000
                    readTimeout = 15_000
                    setRequestProperty("Cookie", cookie)
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("X-Kun-Mobile", "native-android/${BuildConfig.VERSION_NAME}")
                }
                try {
                    if (connection.responseCode != 200) return@runCatching null
                    JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                } finally { connection.disconnect() }
            }.getOrNull() ?: return false
            if (!response.optBoolean("ok") || KunApi.sessionCookie(context) != cookie) return false
            val nextAfter = response.optString("nextAfter")
            val nextId = response.optString("nextId", "")
            if (nextAfter.isBlank()) return false
            val orders = response.optJSONArray("orders")
            if (orders != null) {
                for (i in 0 until orders.length()) {
                    val row = orders.optJSONObject(i) ?: continue
                    val orderId = row.optString("id")
                    val clientId = row.optString("clientId")
                    val storeId = row.optString("storeId")
                    if (orderId.isBlank() || clientId.isBlank() || storeId.isBlank()) continue
                    val storeName = row.optString("storeName").ifBlank { "متجر" }
                    val ref = row.optString("ref").take(50)
                    show(context, clientId, storeId, storeName,
                        if (ref.isBlank()) "وصل طلب جديد إلى $storeName" else "طلب جديد #$ref في $storeName", orderId)
                }
            }
            // Commit only after a successfully authenticated server response.
            prefs.edit().putString("after_$session", nextAfter).putString("id_$session", nextId).apply()
            after = nextAfter
            afterId = nextId
            if (!response.optBoolean("hasMore", false)) return true
        }
        return true
    }

    fun clearForLogout(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        context.getSystemService(NotificationManager::class.java)?.notificationChannels
            ?.filter { it.id.startsWith(PREFIX) }
            ?.forEach { context.getSystemService(NotificationManager::class.java)?.deleteNotificationChannel(it.id) }
    }

    private fun sha(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun enc(value: String) = URLEncoder.encode(value, "UTF-8")
}
