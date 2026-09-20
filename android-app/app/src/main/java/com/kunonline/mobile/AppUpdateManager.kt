package com.kunonline.mobile

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object AppUpdateManager {
    private const val PREFS = "kun_mobile"
    private const val PENDING_APK = "pendingUpdateApk"
    private const val ENDPOINT = "/api/mobile/app-update"
    @Volatile private var checking = false
    @Volatile private var downloading = false

    data class UpdateInfo(
        val versionCode: Int,
        val versionName: String,
        val apkUrl: String,
        val required: Boolean,
        val notes: List<String>
    )

    fun check(activity: Activity, userInitiated: Boolean = false) {
        if (checking) return
        checking = true
        Thread {
            val info = runCatching { fetchInfo() }.getOrNull()
            activity.runOnUiThread {
                checking = false
                if (activity.isFinishing) return@runOnUiThread
                if (info == null) {
                    if (userInitiated) Toast.makeText(activity, "تعذر التحقق من تحديث التطبيق", Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                if (info.versionCode <= BuildConfig.VERSION_CODE) {
                    if (userInitiated) Toast.makeText(activity, "أنت تستخدم أحدث إصدار ${BuildConfig.VERSION_NAME}", Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                showUpdateDialog(activity, info)
            }
        }.start()
    }

    fun resumePendingInstall(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) return
        val prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
        val raw = prefs.getString(PENDING_APK, null) ?: return
        val file = File(raw)
        if (!file.exists() || file.length() == 0L) {
            prefs.edit().remove(PENDING_APK).apply()
            return
        }
        prefs.edit().remove(PENDING_APK).apply()
        install(activity, file)
    }

    private fun fetchInfo(): UpdateInfo {
        val base = BuildConfig.KUN_BASE_URL.trimEnd('/')
        val connection = (URL(base + ENDPOINT).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 7000
            readTimeout = 7000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-cache")
        }
        val code = connection.responseCode
        if (code !in 200..299) {
            connection.disconnect()
            error("HTTP $code")
        }
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        connection.disconnect()
        val json = JSONObject(body)
        val notesJson = json.optJSONArray("notes")
        val notes = buildList {
            if (notesJson != null) for (i in 0 until notesJson.length()) add(notesJson.optString(i))
        }.filter { it.isNotBlank() }
        return UpdateInfo(
            versionCode = json.optInt("versionCode", 0),
            versionName = json.optString("versionName"),
            apkUrl = json.optString("apkUrl"),
            required = json.optBoolean("required", false),
            notes = notes
        ).also { if (it.versionCode <= 0 || it.apkUrl.isBlank()) error("Invalid update metadata") }
    }

    private fun showUpdateDialog(activity: Activity, info: UpdateInfo) {
        val message = buildString {
            append("إصدار جديد ${info.versionName} متاح الآن.")
            if (info.notes.isNotEmpty()) {
                append("\n\n")
                info.notes.forEach { append("• ").append(it).append('\n') }
            }
            append("\nسيتم تنزيل التحديث من كن أونلاين ثم يطلب Android موافقتك على التثبيت.")
        }.trim()
        val builder = AlertDialog.Builder(activity)
            .setTitle("تحديث Kun Online")
            .setMessage(message)
            .setPositiveButton("تنزيل وتحديث") { _, _ -> download(activity, info) }
        if (!info.required) builder.setNegativeButton("لاحقًا", null)
        builder.setCancelable(!info.required).show()
    }

    private fun download(activity: Activity, info: UpdateInfo) {
        if (downloading) {
            Toast.makeText(activity, "التحديث قيد التنزيل بالفعل", Toast.LENGTH_SHORT).show()
            return
        }
        downloading = true
        val progress = AlertDialog.Builder(activity)
            .setTitle("جاري تنزيل التحديث")
            .setMessage("سيتم فتح شاشة التثبيت تلقائيًا بعد اكتمال التنزيل.")
            .setCancelable(false)
            .show()
        Thread {
            val result = runCatching {
                val target = File(activity.cacheDir, "kun-online-${info.versionCode}.apk")
                downloadFile(info.apkUrl, target)
                target
            }
            activity.runOnUiThread {
                downloading = false
                progress.dismiss()
                if (activity.isFinishing) return@runOnUiThread
                result.onSuccess { requestInstall(activity, it) }
                    .onFailure { Toast.makeText(activity, "فشل تنزيل التحديث: ${it.message ?: "خطأ غير معروف"}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun downloadFile(rawUrl: String, target: File) {
        var current = rawUrl
        repeat(6) {
            val connection = (URL(current).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 12000
                readTimeout = 30000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "KunOnline-Android/${BuildConfig.VERSION_NAME}")
                setRequestProperty("Accept", "application/vnd.android.package-archive,application/octet-stream,*/*")
            }
            val code = connection.responseCode
            if (code in 300..399) {
                val next = connection.getHeaderField("Location") ?: error("Redirect without location")
                current = URL(URL(current), next).toString()
                connection.disconnect()
                return@repeat
            }
            if (code !in 200..299) {
                connection.disconnect()
                error("HTTP $code")
            }
            target.outputStream().use { output -> connection.inputStream.use { input -> input.copyTo(output) } }
            connection.disconnect()
            if (target.length() < 100_000) error("ملف التحديث غير مكتمل")
            return
        }
        error("عدد تحويلات رابط التحديث كبير")
    }

    private fun requestInstall(activity: Activity, file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE).edit().putString(PENDING_APK, file.absolutePath).apply()
            Toast.makeText(activity, "اسمح لـ Kun Online بتثبيت التحديث ثم ارجع للتطبيق", Toast.LENGTH_LONG).show()
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        install(activity, file)
    }

    private fun install(activity: Activity, file: File) {
        runCatching {
            val installer = activity.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                file.inputStream().use { input ->
                    session.openWrite("base.apk", 0, file.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                val resultIntent = Intent(activity, UpdateInstallReceiver::class.java).apply {
                    action = UpdateInstallReceiver.ACTION_INSTALL_RESULT
                }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                val pending = PendingIntent.getBroadcast(activity, sessionId, resultIntent, flags)
                session.commit(pending.intentSender)
            }
        }.onFailure {
            Toast.makeText(activity, "تعذر بدء تثبيت التحديث: ${it.message ?: "خطأ"}", Toast.LENGTH_LONG).show()
        }
    }
}
