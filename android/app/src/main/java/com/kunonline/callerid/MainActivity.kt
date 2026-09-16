package com.kunonline.callerid

import android.Manifest
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
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
        try {
            buildUi()
            updateStatus()
            val hasSession = runCatching { KunApi.hasSession(this) }.getOrDefault(false)
            if (hasSession) {
                runCatching { SyncJobService.schedule(this) }
                syncNow()
            }
        } catch (t: Throwable) {
            showStartupRecovery(t)
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 48, 36, 48)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(TextView(this).apply {
            text = "Kun Online Caller ID"
            textSize = 24f
        })
        root.addView(TextView(this).apply {
            text = "يعرض بيانات عميل كن أونلاين تلقائيًا عند المكالمات الواردة والصادرة."
            textSize = 15f
        })

        status = TextView(this).apply { textSize = 14f; setPadding(0, 24, 0, 24) }
        root.addView(status)

        root.addView(Button(this).apply {
            text = "1) تفعيل Kun Online كـ Caller ID"
            setOnClickListener { requestCallerRole() }
        })
        root.addView(Button(this).apply {
            text = "2) السماح بالظهور فوق التطبيقات"
            setOnClickListener { requestOverlayPermission() }
        })
        root.addView(Button(this).apply {
            text = "3) السماح بقراءة جهات الاتصال"
            setOnClickListener { requestContactsPermission() }
        })
        root.addView(TextView(this).apply {
            text = "صلاحية جهات الاتصال لازمة فقط عشان يظهر العميل حتى لو رقمه محفوظ عندك. التطبيق لا يرفع دفتر جهات الاتصال."
            textSize = 12f
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
            text = "إصلاح كلمة مرور الحساب من الجلسة الحالية"
            setOnClickListener { repairPasswordFromSession() }
        })
        root.addView(TextView(this).apply {
            text = "استخدم الزر ده فقط لو التطبيق عنده جلسة شغالة لكن السيرفر بيرفض كلمة المرور الجديدة. اكتب الإيميل والباسورد المطلوب أولاً."
            textSize = 12f
        })
        root.addView(Button(this).apply {
            text = "مزامنة الآن"
            setOnClickListener { syncNow() }
        })
        root.addView(Button(this).apply {
            text = "فتح كن أونلاين"
            setOnClickListener {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.kun-online.com"))) }
                    .onFailure { updateStatus("تعذر فتح رابط كن أونلاين") }
            }
        })
        root.addView(Button(this).apply {
            text = "تسجيل الخروج ومسح بيانات العملاء"
            setOnClickListener {
                runCatching { KunApi.logout(this@MainActivity) }
                runCatching { SyncJobService.cancel(this@MainActivity) }
                password.setText("")
                updateStatus("تم تسجيل الخروج ومسح الكاش المحلي")
            }
        })
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun roleManager(): RoleManager? = runCatching {
        getSystemService(RoleManager::class.java)
    }.getOrNull()

    private fun requestCallerRole() {
        val manager = roleManager()
        if (manager == null || !runCatching { manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) }.getOrDefault(false)) {
            updateStatus("الجهاز لا يدعم دور Call Screening أو تعذر الوصول إليه")
            return
        }
        if (runCatching { manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) }.getOrDefault(false)) {
            updateStatus("Caller ID مفعّل بالفعل")
            return
        }
        runCatching {
            startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), 100)
        }.onFailure { updateStatus("تعذر فتح إعداد Caller ID على هذا الجهاز") }
    }

    private fun requestOverlayPermission() {
        val enabled = runCatching { Settings.canDrawOverlays(this) }.getOrDefault(false)
        if (enabled) {
            updateStatus("صلاحية الظهور فوق التطبيقات مفعّلة بالفعل")
            return
        }
        runCatching {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }.onFailure { updateStatus("تعذر فتح إعداد الظهور فوق التطبيقات") }
    }

    private fun requestContactsPermission() {
        val granted = runCatching {
            checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
        }.getOrDefault(false)
        if (granted) {
            updateStatus("صلاحية جهات الاتصال مفعّلة بالفعل")
            return
        }
        runCatching { requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), 101) }
            .onFailure { updateStatus("تعذر طلب صلاحية جهات الاتصال") }
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
            val result = runCatching { KunApi.loginAndSync(this, mail, pass) }
                .getOrElse { SyncResult(false, "تعذر تسجيل الدخول") }
            runOnUiThread {
                if (result.ok) {
                    password.setText("")
                    runCatching { SyncJobService.schedule(this) }
                }
                updateStatus(result.message + if (result.ok) " — ${result.customerCount} عميل" else "")
            }
        }
    }

    private fun repairPasswordFromSession() {
        val mail = email.text.toString().trim()
        val pass = password.text.toString()
        if (mail.isBlank() || pass.isBlank()) {
            updateStatus("اكتب الإيميل وكلمة المرور الجديدة المطلوبة أولاً")
            return
        }
        updateStatus("جاري إصلاح كلمة المرور باستخدام الجلسة الحالية…")
        thread(name = "kun-password-repair") {
            val result = runCatching { KunApi.repairPasswordWithStoredAdminSession(this, mail, pass) }
                .getOrElse { SyncResult(false, "تعذر إصلاح كلمة المرور") }
            runOnUiThread {
                if (result.ok) {
                    password.setText("")
                    runCatching { SyncJobService.schedule(this) }
                }
                updateStatus(result.message + if (result.ok) " — ${result.customerCount} عميل" else "")
            }
        }
    }

    private fun syncNow() {
        updateStatus("جاري مزامنة بيانات العملاء…")
        thread(name = "kun-manual-sync") {
            val result = runCatching { KunApi.syncWithStoredSession(this) }
                .getOrElse { SyncResult(false, "تعذر المزامنة") }
            runOnUiThread { updateStatus(result.message + if (result.ok) " — ${result.customerCount} عميل" else "") }
        }
    }

    private fun updateStatus(message: String? = null) {
        if (!::status.isInitialized) return
        val manager = roleManager()
        val callerEnabled = manager != null &&
            runCatching { manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) }.getOrDefault(false) &&
            runCatching { manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) }.getOrDefault(false)
        val overlayEnabled = runCatching { Settings.canDrawOverlays(this) }.getOrDefault(false)
        val contactsEnabled = runCatching {
            checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
        }.getOrDefault(false)
        val count = runCatching { CustomerCache.count(this) }.getOrDefault(0)
        val syncAt = runCatching { CustomerCache.lastSyncedAt(this) }.getOrDefault(0L)
        val syncedText = if (syncAt > 0) {
            runCatching { DateFormat.getDateTimeInstance().format(Date(syncAt)) }.getOrDefault("تمت مزامنة سابقة")
        } else "لم تتم مزامنة بعد"
        status.text = listOfNotNull(
            message,
            "Caller ID: ${if (callerEnabled) "مفعّل" else "غير مفعّل"}",
            "الظهور فوق التطبيقات: ${if (overlayEnabled) "مفعّل" else "غير مفعّل"}",
            "جهات الاتصال: ${if (contactsEnabled) "مفعّلة" else "غير مفعّلة"}",
            "الكاش: $count عميل",
            "آخر مزامنة: $syncedText"
        ).joinToString("\n")
    }

    private fun showStartupRecovery(t: Throwable) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 48, 36, 48)
        }
        root.addView(TextView(this).apply {
            text = "Kun Online Caller ID"
            textSize = 24f
        })
        root.addView(TextView(this).apply {
            text = "تم منع إغلاق التطبيق أثناء بدء التشغيل.\nرمز التشخيص: ${t.javaClass.simpleName}"
            textSize = 15f
            setPadding(0, 24, 0, 24)
        })
        root.addView(Button(this).apply {
            text = "تنظيف بيانات التطبيق المحلية وإعادة المحاولة"
            setOnClickListener {
                runCatching { getSharedPreferences("kun_auth", MODE_PRIVATE).edit().clear().apply() }
                runCatching { CustomerCache.clear(this@MainActivity) }
                recreate()
            }
        })
        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) runCatching { updateStatus() }
    }
}
