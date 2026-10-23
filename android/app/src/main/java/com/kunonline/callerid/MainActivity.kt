package com.kunonline.callerid

import android.Manifest
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {
    var notificationOrderTarget by mutableStateOf<NotificationOrderTarget?>(null)
        private set

    fun clearNotificationOrderTarget() { notificationOrderTarget = null }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        notificationOrderTarget = OrderNotifications.notificationTarget(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        notificationOrderTarget = OrderNotifications.notificationTarget(intent)
        if (KunApi.hasSession(this)) {
            SyncJobService.schedule(this)
        }
        setContent {
            KunNativeAppV26(this)
        }
        maybeRequestContactsForIncomingCallerId()
        AppUpdateManager.checkForUpdate(this)
    }

    override fun onResume() {
        super.onResume()
        AppUpdateManager.resumePending(this)
    }

    fun maybeRequestOrderNotifications() {
        if (!KunApi.hasSession(this) || Build.VERSION.SDK_INT < 33 ||
            OrderNotifications.permissionGranted(this)) return
        val prefs = getSharedPreferences("kun_notification_permission", MODE_PRIVATE)
        if (prefs.getBoolean("asked_once", false)) return
        prefs.edit().putBoolean("asked_once", true).apply()
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_ORDER_NOTIFICATIONS)
    }

    fun requestCallerRole() {
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQUEST_CONTACTS_FOR_CALLER_ID)
            return
        }
        val roleManager = getSystemService(RoleManager::class.java)
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) return
        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) return
        startActivityForResult(
            roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING),
            REQUEST_CALL_SCREENING
        )
    }

    fun requestOverlayPermission() {
        if (Settings.canDrawOverlays(this)) return
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
        )
    }

    fun requestContactsPermission() {
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQUEST_CONTACTS)
    }

    private fun maybeRequestContactsForIncomingCallerId() {
        val roleManager = getSystemService(RoleManager::class.java)
        val holdsRole = roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) &&
            roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
        if (!holdsRole || checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) return

        val prefs = getSharedPreferences("kun_caller_setup", MODE_PRIVATE)
        if (prefs.getBoolean("incoming_contacts_prompt_v231", false)) return
        prefs.edit().putBoolean("incoming_contacts_prompt_v231", true).apply()
        requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQUEST_CONTACTS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CONTACTS_FOR_CALLER_ID && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            requestCallerRole()
        }
    }

    companion object {
        private const val REQUEST_CALL_SCREENING = 100
        private const val REQUEST_ORDER_NOTIFICATIONS = 103
        private const val REQUEST_CONTACTS = 101
        private const val REQUEST_CONTACTS_FOR_CALLER_ID = 102
    }
}
