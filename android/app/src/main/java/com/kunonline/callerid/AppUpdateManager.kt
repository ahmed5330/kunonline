package com.kunonline.callerid

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
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
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipFile

/**
 * Stable in-app updater for Kun Online.
 *
 * The installer must only be launched once for a completed download. Android resumes
 * MainActivity while the package installer is working/cancelled, so reopening the same
 * installer immediately from onResume causes the repeated "Do you want to update" loop.
 * A persisted launch guard below prevents that loop while keeping the downloaded APK
 * available for a later retry.
 */
object AppUpdateManager {
    private const val UPDATE_FEED = "https://app.kun-online.com/api/mobile/app-update"
    private const val FALLBACK_APK = "https://app.kun-online.com/api/mobile/app-update/apk"
    private const val PREFS = "kun_app_update"
    private const val KEY_PENDING_URL = "pending_apk_url"
    private const val KEY_PENDING_CODE = "pending_version_code"
    private const val KEY_EXPECTED_SHA256 = "expected_sha256"
    private const val KEY_DOWNLOAD_ID = "download_id"
    private const val KEY_DOWNLOAD_URL = "download_url"
    private const val KEY_TARGET_CODE = "target_version_code"
    private const val KEY_RETRY_COUNT = "retry_count"
    private const val KEY_INSTALL_LAUNCHED_AT = "install_launched_at"
    private const val KEY_INSTALL_LAUNCHED_CODE = "install_launched_code"
    private const val APK_NAME = "Kun-Online-Mobile-update.apk"
    private const val INSTALL_RELAUNCH_COOLDOWN_MS = 120_000L

    private val monitoredDownloads = ConcurrentHashMap.newKeySet<Long>()

    private data class UpdateInfo(
        val versionCode: Long,
        val versionName: String,
        val apkUrl: String,
        val sha256: String,
        val required: Boolean,
        val notes: String
    )

    fun checkForUpdate(activity: Activity) {
        Thread {
            runCatching {
                val currentCode = installedVersionCode(activity)
                val currentName = installedVersionName(activity)
                val connection = (URL(UPDATE_FEED).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8_000
                    readTimeout = 12_000
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
                if (latestCode <= currentCode) {
                    clearFinishedUpdate(activity, currentCode)
                    return@runCatching
                }

                val latestName = root.optString("versionName").ifBlank { latestCode.toString() }
                val apkUrl = root.optString("apkUrl").ifBlank { FALLBACK_APK }
                val sha256 = root.optString("sha256")
                    .trim()
                    .lowercase()
                    .removePrefix("sha256:")
                    .takeIf { it.matches(Regex("^[0-9a-f]{64}$")) }
                    .orEmpty()
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

                val update = UpdateInfo(latestCode, latestName, apkUrl, sha256, required, notes)
                activity.runOnUiThread {
                    if (!activity.isFinishing && !activity.isDestroyed) {
                        startOrResumeAutomaticUpdate(activity, update)
                    }
                }
            }.onFailure {
                // Update checks must never prevent normal use of the application.
            }
        }.start()
    }

    fun resumePending(activity: Activity) {
        val currentCode = installedVersionCode(activity)
        clearFinishedUpdate(activity, currentCode)

        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pendingUrl = prefs.getString(KEY_PENDING_URL, "").orEmpty()
        val pendingCode = prefs.getLong(KEY_PENDING_CODE, -1L)
        if (pendingUrl.isNotBlank() && pendingCode > currentCode && canInstallPackages(activity)) {
            prefs.edit().remove(KEY_PENDING_URL).remove(KEY_PENDING_CODE).apply()
            startDownload(activity, pendingUrl, pendingCode, isRetry = false)
            return
        }

        val downloadId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (downloadId > 0) {
            if (!installIfReady(activity, downloadId)) {
                monitorDownload(activity, downloadId)
            }
        }
    }

    private fun startOrResumeAutomaticUpdate(activity: Activity, update: UpdateInfo) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existingId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        val existingTarget = prefs.getLong(KEY_TARGET_CODE, -1L)

        val editor = prefs.edit()
            .putLong(KEY_TARGET_CODE, update.versionCode)
            .putString(KEY_EXPECTED_SHA256, update.sha256)
            .putString(KEY_DOWNLOAD_URL, update.apkUrl)
        if (existingTarget != update.versionCode) {
            editor.remove(KEY_INSTALL_LAUNCHED_AT).remove(KEY_INSTALL_LAUNCHED_CODE)
        }
        editor.apply()

        if (existingId > 0 && existingTarget == update.versionCode) {
            if (!installIfReady(activity, existingId)) {
                monitorDownload(activity, existingId)
            }
            return
        }

        if (!canInstallPackages(activity)) {
            prefs.edit()
                .putString(KEY_PENDING_URL, update.apkUrl)
                .putLong(KEY_PENDING_CODE, update.versionCode)
                .apply()

            val message = buildString {
                append("لتثبيت تحديثات كن أونلاين تلقائيًا، فعّل السماح بالتثبيت من هذا التطبيق مرة واحدة فقط.")
                if (update.notes.isNotBlank()) append("\n\n").append(update.notes)
            }
            AlertDialog.Builder(activity)
                .setTitle("تحديث كن أونلاين ${update.versionName}")
                .setMessage(message)
                .setCancelable(!update.required)
                .setPositiveButton("السماح والمتابعة") { _, _ -> openUnknownSourcesSettings(activity) }
                .apply { if (!update.required) setNegativeButton("لاحقًا", null) }
                .show()
            return
        }

        Toast.makeText(
            activity,
            "يتوفر تحديث كن أونلاين ${update.versionName} — جارٍ تنزيله تلقائيًا.",
            Toast.LENGTH_LONG
        ).show()
        startDownload(activity, update.apkUrl, update.versionCode, isRetry = false)
    }

    private fun openUnknownSourcesSettings(activity: Activity) {
        activity.startActivity(
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}")
            )
        )
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

    private fun startDownload(activity: Activity, apkUrl: String, targetCode: Long, isRetry: Boolean) {
        val downloads = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        val previousId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (previousId > 0) runCatching { downloads.remove(previousId) }

        val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        if (dir == null) {
            Toast.makeText(activity, "تعذر تجهيز مساحة تنزيل تحديث كن أونلاين.", Toast.LENGTH_LONG).show()
            return
        }
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
        val editor = prefs.edit()
            .putLong(KEY_DOWNLOAD_ID, id)
            .putLong(KEY_TARGET_CODE, targetCode)
            .putString(KEY_DOWNLOAD_URL, apkUrl)
            .remove(KEY_PENDING_URL)
            .remove(KEY_PENDING_CODE)
            .remove(KEY_INSTALL_LAUNCHED_AT)
            .remove(KEY_INSTALL_LAUNCHED_CODE)
        if (!isRetry) editor.putInt(KEY_RETRY_COUNT, 0)
        editor.apply()

        monitorDownload(activity, id)
    }

    private fun monitorDownload(activity: Activity, downloadId: Long) {
        if (!monitoredDownloads.add(downloadId)) return
        Thread {
            try {
                val downloads = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                repeat(1800) {
                    val state = queryDownload(downloads, downloadId)
                    when (state?.first) {
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            activity.runOnUiThread {
                                if (!activity.isFinishing && !activity.isDestroyed) {
                                    installIfReady(activity, downloadId)
                                }
                            }
                            return@Thread
                        }
                        DownloadManager.STATUS_FAILED -> {
                            clearDownloadId(activity, downloadId)
                            activity.runOnUiThread {
                                if (!activity.isFinishing && !activity.isDestroyed) {
                                    Toast.makeText(
                                        activity,
                                        "تعذر تنزيل تحديث كن أونلاين (رمز ${state.second}). سيُعاد المحاولة عند فتح التطبيق.",
                                        Toast.LENGTH_LONG
                                    ).show()
                                }
                            }
                            return@Thread
                        }
                    }
                    Thread.sleep(1000)
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } finally {
                monitoredDownloads.remove(downloadId)
            }
        }.start()
    }

    private fun queryDownload(downloads: DownloadManager, downloadId: Long): Pair<Int, Int>? {
        val cursor = downloads.query(DownloadManager.Query().setFilterById(downloadId)) ?: return null
        cursor.use {
            if (!it.moveToFirst()) return null
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            return status to reason
        }
    }

    /** Returns true when the completed download has already been handled. */
    private fun installIfReady(activity: Activity, downloadId: Long): Boolean {
        val downloads = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val state = queryDownload(downloads, downloadId) ?: return false
        if (state.first == DownloadManager.STATUS_FAILED) {
            clearDownloadId(activity, downloadId)
            return true
        }
        if (state.first != DownloadManager.STATUS_SUCCESSFUL) return false

        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val targetCode = prefs.getLong(KEY_TARGET_CODE, -1L)
        val currentCode = installedVersionCode(activity)
        if (targetCode > 0 && currentCode >= targetCode) {
            clearFinishedUpdate(activity, currentCode)
            return true
        }

        val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return false
        val file = File(dir, APK_NAME)
        if (!isValidApk(activity, file, targetCode, currentCode)) {
            retryInvalidDownloadOnce(activity, file)
            return true
        }

        val expectedSha = prefs.getString(KEY_EXPECTED_SHA256, "").orEmpty()
        if (expectedSha.isNotBlank() && !sha256(file).equals(expectedSha, ignoreCase = true)) {
            retryInvalidDownloadOnce(activity, file)
            return true
        }

        val launchedCode = prefs.getLong(KEY_INSTALL_LAUNCHED_CODE, -1L)
        val launchedAt = prefs.getLong(KEY_INSTALL_LAUNCHED_AT, 0L)
        val now = System.currentTimeMillis()
        if (
            targetCode > 0 && launchedCode == targetCode && launchedAt > 0L &&
            now - launchedAt in 0 until INSTALL_RELAUNCH_COOLDOWN_MS
        ) {
            return true
        }

        prefs.edit()
            .putLong(KEY_INSTALL_LAUNCHED_CODE, targetCode)
            .putLong(KEY_INSTALL_LAUNCHED_AT, now)
            .apply()

        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val installIntent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            data = uri
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        return try {
            activity.startActivity(installIntent)
            true
        } catch (_: ActivityNotFoundException) {
            val fallback = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runCatching { activity.startActivity(fallback) }
                .onFailure { clearInstallLaunchGuard(activity) }
                .isSuccess
        } catch (_: Throwable) {
            clearInstallLaunchGuard(activity)
            false
        }
    }

    private fun isValidApk(activity: Activity, file: File, targetCode: Long, currentCode: Long): Boolean {
        if (!file.exists() || file.length() < 1_000_000L) return false
        val hasManifest = runCatching {
            ZipFile(file).use { it.getEntry("AndroidManifest.xml") != null }
        }.getOrDefault(false)
        if (!hasManifest) return false

        val archiveInfo = activity.packageManager.getPackageArchiveInfo(
            file.absolutePath,
            PackageManager.GET_SIGNING_CERTIFICATES
        ) ?: return false
        if (archiveInfo.packageName != activity.packageName) return false

        val archiveCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) archiveInfo.longVersionCode
        else {
            @Suppress("DEPRECATION")
            archiveInfo.versionCode.toLong()
        }
        if (targetCode > 0 && archiveCode != targetCode) return false
        if (archiveCode <= currentCode) return false

        val installedInfo = activity.packageManager.getPackageInfo(
            activity.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES
        )
        val installedSigners = signingDigests(installedInfo)
        val archiveSigners = signingDigests(archiveInfo)
        if (installedSigners.isNotEmpty() && archiveSigners.isNotEmpty() && installedSigners.intersect(archiveSigners).isEmpty()) {
            return false
        }
        return true
    }

    private fun signingDigests(info: PackageInfo): Set<String> {
        val signingInfo = info.signingInfo ?: return emptySet()
        val signatures = if (signingInfo.hasMultipleSigners()) {
            signingInfo.apkContentsSigners
        } else {
            signingInfo.signingCertificateHistory
        }
        return signatures.mapTo(linkedSetOf()) { signature -> sha256(signature.toByteArray()) }
    }

    private fun retryInvalidDownloadOnce(activity: Activity, file: File) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val retries = prefs.getInt(KEY_RETRY_COUNT, 0)
        val targetCode = prefs.getLong(KEY_TARGET_CODE, -1L)
        val retryUrl = prefs.getString(KEY_DOWNLOAD_URL, "").orEmpty().ifBlank { FALLBACK_APK }
        file.delete()
        clearInstallLaunchGuard(activity)

        if (retries < 1) {
            prefs.edit().putInt(KEY_RETRY_COUNT, retries + 1).apply()
            Toast.makeText(activity, "تم اكتشاف ملف تحديث غير صالح أو غير مكتمل — جارٍ إعادة تنزيله مرة واحدة.", Toast.LENGTH_LONG).show()
            startDownload(activity, retryUrl, targetCode, isRetry = true)
        } else {
            clearDownloadId(activity, prefs.getLong(KEY_DOWNLOAD_ID, -1L))
            Toast.makeText(
                activity,
                "تعذر التحقق من ملف التحديث. لن يُفتح ملف غير صالح، وسيُعاد التحقق عند فتح التطبيق لاحقًا.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun sha256(bytes: ByteArray): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun clearInstallLaunchGuard(activity: Activity) {
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_INSTALL_LAUNCHED_AT)
            .remove(KEY_INSTALL_LAUNCHED_CODE)
            .apply()
    }

    private fun clearDownloadId(activity: Activity, downloadId: Long) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getLong(KEY_DOWNLOAD_ID, -1L) == downloadId) {
            prefs.edit().remove(KEY_DOWNLOAD_ID).apply()
        }
    }

    private fun clearFinishedUpdate(activity: Activity, currentCode: Long) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val target = prefs.getLong(KEY_TARGET_CODE, -1L)
        if (target > 0 && target <= currentCode) {
            prefs.edit()
                .remove(KEY_DOWNLOAD_ID)
                .remove(KEY_DOWNLOAD_URL)
                .remove(KEY_TARGET_CODE)
                .remove(KEY_EXPECTED_SHA256)
                .remove(KEY_RETRY_COUNT)
                .remove(KEY_PENDING_URL)
                .remove(KEY_PENDING_CODE)
                .remove(KEY_INSTALL_LAUNCHED_AT)
                .remove(KEY_INSTALL_LAUNCHED_CODE)
                .apply()
            activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let {
                File(it, APK_NAME).delete()
            }
        }
    }
}
