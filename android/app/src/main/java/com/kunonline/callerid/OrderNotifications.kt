package com.kunonline.callerid

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.text.NumberFormat
import java.util.Locale

internal data class NotificationOrderTarget(val orderId: String, val clientId: String, val storeId: String)

internal data class NewOrderAlert(
    val orderId: String,
    val customerName: String = "",
    val customerPhone: String = "",
    val productName: String = "",
    val productNote: String = "",
    val quantity: Int = 1,
    val total: Double? = null,
    val governorate: String = "",
    val isTest: Boolean = false
)

/** Notification channels are stable per (client, store). Users pick each sound in Android settings. */
object OrderNotifications {
    private const val BASE_URL = "https://app.kun-online.com"
    private const val PREFS = "kun_order_alerts"
    private const val PREFIX = "kun_orders_"
    private const val MAX_PAGES = 4
    private const val ACTION_OPEN_ORDER = "com.kunonline.callerid.OPEN_ORDER_NOTIFICATION"
    const val EXTRA_ORDER_ID = "kun_notification_order_id"
    const val EXTRA_CLIENT_ID = "kun_notification_client_id"
    const val EXTRA_STORE_ID = "kun_notification_store_id"

    fun notificationTarget(intent: Intent?): NotificationOrderTarget? {
        if (intent?.action != ACTION_OPEN_ORDER) return null
        val orderId = intent.getStringExtra(EXTRA_ORDER_ID).orEmpty()
        val clientId = intent.getStringExtra(EXTRA_CLIENT_ID).orEmpty()
        val storeId = intent.getStringExtra(EXTRA_STORE_ID).orEmpty()
        return if (orderId.isBlank() || clientId.isBlank() || storeId.isBlank()) null
        else NotificationOrderTarget(orderId, clientId, storeId)
    }

    internal fun displayText(alert: NewOrderAlert): String {
        if (alert.isTest) return "اختبار صوت إشعار المتجر"
        val lines = mutableListOf<String>()
        lines += "العميل: ${alert.customerName.trim().ifBlank { "عميل جديد" }}"
        if (alert.productName.isNotBlank())
            lines += "المنتج: ${alert.productName.trim()} × ${alert.quantity.coerceAtLeast(1)}"
        if (alert.productNote.isNotBlank()) lines += "التفاصيل: ${alert.productNote.trim()}"
        if (alert.total != null && alert.total.isFinite())
            lines += "الإجمالي: ${NumberFormat.getNumberInstance(Locale("ar", "EG")).format(alert.total)} ج.م"
        if (alert.governorate.isNotBlank()) lines += "المحافظة: ${alert.governorate.trim()}"
        return lines.joinToString("\\n")
    }

    private fun safeDialNumber(value: String): String {
        val phone = value.trim().replace(Regex("[\\\\s()\\\\-]"), "")
        return phone.takeIf { it.matches(Regex("\\\\+?[0-9]{7,15}")) }.orEmpty()
    }

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
        show(context, store.clientId, store.storeId, store.storeName,
            NewOrderAlert(orderId = "test", isTest = true))
    }

    private fun show(
        context: Context, clientId: String, storeId: String, storeName: String, alert: NewOrderAlert
    ) {
        val channel = channel(context, clientId, storeId, storeName)
        if (!permissionGranted(context)) return
        val key = "$clientId:$storeId:${alert.orderId}"
        val title = if (alert.isTest) "اختبار الإشعارات • $storeName" else "طلب جديد • $storeName"
        val preview = if (alert.isTest) "اختبار صوت إشعار المتجر" else
            listOf(alert.customerName.ifBlank { "عميل جديد" }, alert.productName)
                .filter { it.isNotBlank() }.joinToString(" • ").take(160)
        val reviewIntent = Intent(context, MainActivity::class.java).apply {
            action = ACTION_OPEN_ORDER
            data = Uri.parse("kunonline://order-notification/${Uri.encode(key)}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_ORDER_ID, alert.orderId)
            putExtra(EXTRA_CLIENT_ID, clientId)
            putExtra(EXTRA_STORE_ID, storeId)
        }
        val review = PendingIntent.getActivity(
            context, (key + ":review").hashCode().and(0x7fffffff), reviewIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(title)
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(displayText(alert)))
            .setSubText(storeName)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(review)
        if (!alert.isTest) {
            val phone = safeDialNumber(alert.customerPhone)
            if (phone.isNotBlank()) {
                val dialIntent = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone, null)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val call = PendingIntent.getActivity(
                    context, (key + ":call").hashCode().and(0x7fffffff), dialIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                builder.addAction(android.R.drawable.ic_menu_call, "اتصال", call)
            }
            builder.addAction(android.R.drawable.ic_menu_view, "مراجعة", review)
        }
        val identifier = key.hashCode().and(0x7fffffff)
        val notification = builder.build()
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
                    val total = row.optDouble("total", Double.NaN).takeIf { it.isFinite() }
                    show(context, clientId, storeId, storeName,
                        NewOrderAlert(
                            orderId = orderId,
                            customerName = row.optString("customerName").take(80),
                            customerPhone = row.optString("customerPhone").take(32),
                            productName = row.optString("productName").take(110),
                            productNote = row.optString("productNote").take(100),
                            quantity = row.optInt("quantity", 1).coerceIn(1, 9999),
                            total = total,
                            governorate = row.optString("governorate").take(70)
                        ))
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
