package com.kunonline.callerid

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var email: EditText
    private lateinit var password: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        updateStatus()
        if (KunApi.hasSession(this)) {
            SyncJobService.schedule(this)
            syncNow()
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 48, 36, 36)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(TextView(this).apply {
            text = "Kun Online Caller ID"
            textSize = 24f
        })
        root.addView(TextView(this).apply {
            text = "اعرض بيانات عميل كن أونلاين تلقائيًا عند المكالمات الواردة والصادرة."
            textSize = 15f
        })

        status = TextView(this).apply { textSize = 14f; setPadding(0, 24, 0, 24) }
        root.addView(status)

        root.addView(Button(this).apply {
            text = "1) تفعيل Caller ID"
            setOnClickListener { requestCallerRole() }
        })
        root.addView(Button(this).apply {
            text = "2) السماح بالظهور فوق التطبيقات"
            setOnClickListener { requestOverlayPermission() }
        })

        email = EditText(this).apply {
            hint = "إيميل كن أونلاين"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        password = EditText(this).apply {
            hint = "كلمة المرور"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        root.addView(email)
        root.addView(password)

        root.addView(Button(this).apply {
            text = "تسجيل الدخول ومزامنة العملاء"
            setOnClickListener { loginAndSync() }
        })
        root.addView(Button(this).apply {
            text = "مزامنة الآن"
            setOnClickListener { syncNow() }
        })
        root.addView(Button(this).apply {
            text = "فتح كن أونلاين"
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.kun-online.com")))
            }
        })
        root.addView(Button(this).apply {
            text = "تسجيل الخروج ومسح بيانات العملاء"
            setOnClickListener {
                KunApi.logout(this@MainActivity)
                password.setText("")
                updateStatus("تم تسجيل الخروج ومسح الكاش المحلي")
            }
        })
        setContentView(root)
    }

    private fun requestCallerRole() {
        val roleManager = getSystemService(RoleManager::class.java)
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            updateStatus("الجهاز لا يدعم دور Call Screening")
            return
        }
        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            updateStatus("Caller ID مفعّل بالفعل")
            return
        }
        startActivityForResult(roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), 100)
    }

    private fun requestOverlayPermission() {
        if (Settings.canDrawOverlays(this)) {
            updateStatus("صلاحية الظهور فوق التطبيقات مفعّلة بالفعل")
            return
        }
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun loginAndSync() {
        val mail = email.text.toString().trim()
        val pass = password.text.toString()
        if (mail.isBlank() || pass.isBlank()) {
            updateStatus("اكتب الإيميل وكلمة المرور")
            return
        }
        updateStatus("جاري تسجيل الدخول والمزامنة…")
        thread(name = "kun-login-sync") {
            val result = KunApi.loginAndSync(this, mail, pass)
            runOnUiThread {
                if (result.ok) {
                    password.setText("")
                    SyncJobService.schedule(this)
                }
                updateStatus(result.message + if (result.ok) " — ${result.customerCount} عميل" else "")
            }
        }
    }

    private fun syncNow() {
        updateStatus("جاري مزامنة بيانات العملاء…")
        thread(name = "kun-manual-sync") {
            val result = KunApi.syncWithStoredSession(this)
            runOnUiThread { updateStatus(result.message + if (result.ok) " — ${result.customerCount} عميل" else "") }
        }
    }

    private fun updateStatus(message: String? = null) {
        val roleManager = getSystemService(RoleManager::class.java)
        val callerEnabled = roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) && roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
        val overlayEnabled = Settings.canDrawOverlays(this)
        val count = CustomerCache.count(this)
        val syncAt = CustomerCache.lastSyncedAt(this)
        val syncedText = if (syncAt > 0) DateFormat.getDateTimeInstance().format(Date(syncAt)) else "لم تتم مزامنة بعد"
        status.text = listOfNotNull(
            message,
            "Caller ID: ${if (callerEnabled) "مفعّل" else "غير مفعّل"}",
            "الظهور فوق التطبيقات: ${if (overlayEnabled) "مفعّل" else "غير مفعّل"}",
            "الكاش: $count عميل",
            "آخر مزامنة: $syncedText"
        ).joinToString("\n")
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) updateStatus()
    }
}
