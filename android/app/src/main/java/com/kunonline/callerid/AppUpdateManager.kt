package com.kunonline.callerid

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Stable in-app updater for Kun Online.
 *
 * The app never stores a version-specific APK URL. It always checks the permanent
 * Kun Online system endpoint and downloads from the permanent system download path.
 */
object AppUpdateManager {
    private const val UPDATE_FEED = "https://app.kun-online.com/api/mobile/app-update"
    private const val FALLBACK_APK = "https://app.kun-online.com/api/mobile/app-update/apk"
    private const val PREFS = "kun_app_update"
    private const val KEY_PENDING_URL = "pending_apk_url"
    private const val KEY_DOWNLOAD_ID = "download_id"
    private const val APK_NAME = "Kun-Online-Mobile.apk"

    @Volatile private var receiverRegistered = false

    fun checkForUpdate(activity: Activity) {
        Thread {
            runCatching {
                val currentCode = installedVersionCode(activity)
                val currentName = installedVersionName(activity)
                val connection = (URL(UPDATE_FEED).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8000
                    readTimeout = 12000
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Cache-Control", "no-cache")
                    setRequestProperty("X-Kun-Mobile", "native-android/$currentName")
                }
                val code = connection.responseCode
                val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                connection.disconnect()
                if (code !in 200..299) return@runCatching

                val root = JSONObject(body)
                val latestCode = root.optLong("versionCode", currentCode)
                if (latestCode <= currentCode) return@runCatching

                val latestName = root.optString("versionName").ifBlank { latestCode.toString() }
                val apkUrl = root.optString("apkUrl").ifBlank { FALLBACK_APK }
                val required = root.optBoolean("required", false)
                val notesArray = root.optJSONArray("notes")
                val notes = buildString {
                    if (notesArray != null) {
                        for (i in 0 until notesArray.length()) {
                            val line = notesArray.optString(i).trim()
                            if (line.isNotBlank()) append("• ").append(line).append('\n')
                        }
                    }
                }.trim()

                activity.runOnUiThread {
                    if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                    AlertDialog.Builder(activity)
                        .setTitle("تحديث كن أونلاين $latestName")
                        .setMessage(if (notes.isBlank()) "يتوفر إصدار أحدث من التطبيق." else notes)
                        .setCancelable(!required)
                        .setPositiveButton("تحديث الآن") { _, _ -> prepareDownload(activity, apkUrl) }
                        .apply { if (!required) setNegativeButton("لاحقًا", null) }
                        .show()
                }
            }
        }.start()
    }

    fun resumePending(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pendingUrl = prefs.getString(KEY_PENDING_URL, "").orEmpty()
        if (pendingUrl.isNotBlank() && canInstallPackages(activity)) {
            prefs.edit().remove(KEY_PENDING_URL).apply()
            startDownload(activity, pendingUrl)
            return
        }

        val downloadId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (downloadId > 0) {
            registerReceiver(activity)
            installIfReady(activity, downloadId)
        }
    }

    private fun prepareDownload(activity: Activity, apkUrl: String) {
        if (!canInstallPackages(activity)) {
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_PENDING_URL, apkUrl).apply()
            Toast.makeText(activity, "فعّل السماح بتثبيت التطبيقات من كن أونلاين، وسيكمل التحديث تلقائيًا عند الرجوع.", Toast.LENGTH_LONG).show()
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
            )
            return
        }
        startDownload(activity, apkUrl)
    }

    private fun canInstallPackages(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    private fun installedVersionCode(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
        else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    }

    private fun installedVersionName(context: Context): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return info.versionName.orEmpty().ifBlank { installedVersionCode(context).toString() }
    }

    private fun startDownload(activity: Activity, apkUrl: String) {
        val downloads = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        File(dir, APK_NAME).delete()

        val request = DownloadManager.Request(Uri.parse(apkUrl))
            .setTitle("تحديث كن أونلاين")
            .setDescription("جارٍ تنزيل أحدث إصدار من التطبيق")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, APK_NAME)

        val id = downloads.enqueue(request)
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong(KEY_DOWNLOAD_ID, id).remove(KEY_PENDING_URL).apply()
        registerReceiver(activity)
        Toast.makeText(activity, "بدأ تنزيل التحديث من كن أونلاين.", Toast.LENGTH_SHORT).show()
    }

    private fun registerReceiver(activity: Activity) {
        if (receiverRegistered) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                val expected = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getLong(KEY_DOWNLOAD_ID, -1L)
                if (id > 0 && id == expected) installIfReady(activity, id)
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            activity.registerReceiver(receiver, filter)
        }
        receiverRegistered = true
    }

    private fun installIfReady(activity: Activity, downloadId: Long) {
        val downloads = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor = downloads.query(DownloadManager.Query().setFilterById(downloadId)) ?: return
        cursor.use {
            if (!it.moveToFirst()) return
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            if (status != DownloadManager.STATUS_SUCCESSFUL) return
        }

        val file = File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_NAME)
        if (!file.exists() || file.length() < 1_000_000L) return

        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_DOWNLOAD_ID).apply()
        activity.startActivity(installIntent)
    }
}
