package com.kunonline.callerid

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

class CallerCardActivity : Activity() {
    private val chrome = 0xFF0E5095.toInt()
    private val pine = 0xFF3F8F2B.toInt()
    private val ink = 0xFF12212B.toInt()
    private val ink2 = 0xFF3D5563.toInt()
    private val ground = 0xFFE9EFEC.toInt()
    private val surface = 0xFFFFFFFF.toInt()

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun rounded(color: Int, radiusDp: Float): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radiusDp * resources.displayMetrics.density
    }

    private fun stateText(state: String?): String = when (state) {
        "pending" -> "جاري التأكيد"
        "no_answer" -> "العميل لا يرد"
        "confirmed" -> "تم تأكيد الطلب"
        "preparing" -> "التجهيز والتغليف"
        "shipped" -> "جاري الشحن"
        "signed" -> "تم التسليم — تحصيل منتظر"
        "collected" -> "تم التحصيل"
        "returned" -> "مرتجع"
        "cancelled" -> "ملغي"
        "deferred" -> "مؤجل"
        else -> state.orEmpty()
    }

    private fun showCancelReason(orderId: String, clientId: String = "") {
        val field = EditText(this).apply {
            hint = "اكتب سبب الإلغاء (إجباري)"
            minLines = 2
            maxLines = 5
            setPadding(dp(18), dp(12), dp(18), dp(12))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("إلغاء طلب العميل")
            .setMessage("لا يمكن إلغاء الطلب دون تسجيل السبب في سجل الموظف.")
            .setView(field)
            .setNegativeButton("رجوع", null)
            .setPositiveButton("تأكيد الإلغاء", null)
            .create()
        dialog.setOnShowListener {
            val confirm = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            confirm.setOnClickListener {
                val reason = field.text.toString().trim()
                if (reason.isEmpty()) {
                    field.error = "سبب الإلغاء مطلوب"
                    return@setOnClickListener
                }
                confirm.isEnabled = false
                thread(name = "kun-call-cancel-with-note") {
                    val result = KunCustomerServiceApi.updateState(this, orderId, "cancelled", cancelReason = reason, selectedClientId = clientId)
                    runOnUiThread {
                        Toast.makeText(this, result.message, Toast.LENGTH_LONG).show()
                        if (result.ok) { dialog.dismiss(); finish() }
                        else {
                            // Keep the typed reason in place. Show the actual server
                            // rejection inside the dialog rather than losing it in a toast.
                            dialog.setMessage("تعذر إلغاء الطلب: ${result.message}\nسبب الإلغاء لن يُفقد، صحّح المشكلة واضغط تأكيد مجددًا.")
                            confirm.isEnabled = true
                        }
                    }
                }
            }
        }
        dialog.show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        window.statusBarColor = chrome
        window.navigationBarColor = ground

        val phone = intent.getStringExtra("phone").orEmpty()
        val incoming = intent.getBooleanExtra("incoming", false)
        val customer = CallerPayload.decode(intent.getStringExtra("kun_caller_payload"))
            ?: CustomerCache.lookup(this, phone) ?: run { finish(); return }
        val locked = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(24), dp(16), dp(24))
            setBackgroundColor(ground)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(surface, 20f)
            elevation = dp(8).toFloat()
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(14))
            background = rounded(chrome, 20f)
        }
        header.addView(TextView(this).apply {
            text = if (incoming) "مكالمة واردة" else "مكالمة صادرة"
            textSize = 12f
            setTextColor(Color.WHITE)
            alpha = .78f
        })
        header.addView(TextView(this).apply {
            text = customer.name.ifBlank { "عميل كن أونلاين" }
            textSize = 22f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dp(3), 0, 0)
        })
        card.addView(header)

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(14), dp(20), dp(10))
        }
        fun addLine(textValue: String, size: Float = 14f, color: Int = ink2, bold: Boolean = false) {
            if (textValue.isBlank()) return
            body.addView(TextView(this).apply {
                text = textValue
                textSize = size
                setTextColor(color)
                if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(0, dp(4), 0, dp(4))
            })
        }
        addLine(customer.phone, 15f, ink, true)
        if (!locked && customer.storeName.isNotBlank()) addLine("المتجر: ${customer.storeName}", 13f, chrome, true)
        addLine(listOfNotNull(customer.orderRef?.takeUnless { locked }?.let { "طلب $it" }, stateText(customer.status).takeIf { it.isNotBlank() }).joinToString(" • "), 13f, chrome, true)
        if (!locked) {
            addLine(listOfNotNull(customer.product, customer.total?.let { "الإجمالي ${it.toInt()} ج.م" }).joinToString(" • "), 14f, ink)
            addLine(listOfNotNull(customer.gov, customer.address).filter { !it.isNullOrBlank() }.joinToString(" — "), 13f)
            customer.note?.takeIf { it.isNotBlank() }?.let { addLine("ملاحظة: $it", 13f) }
            if (customer.previousOrders > 0) addLine("له ${customer.previousOrders} طلب سابق", 12f)
        }
        val detailsHost = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, dp(8))
        }
        if (!locked && !customer.orderId.isNullOrBlank()) {
            detailsHost.addView(TextView(this).apply {
                text = "جاري تحميل تفاصيل الطلب الكاملة…"
                textSize = 12f
                setTextColor(ink2)
            })
            body.addView(detailsHost)
        }
        card.addView(ScrollView(this).apply {
            addView(body)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(280)))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(6), dp(12), dp(12))
        }
        fun action(label: String, bg: Int, fg: Int, click: (Button) -> Unit): Button =
            Button(this).apply {
                text = label
                isAllCaps = false
                textSize = 11f
                maxLines = 2
                setTextColor(fg)
                backgroundTintList = ColorStateList.valueOf(bg)
                minWidth = 0
                minimumWidth = 0
                minHeight = dp(52)
                setPadding(dp(3), 0, dp(3), 0)
                setOnClickListener { click(this) }
            }
        fun decision(button: Button, orderId: String, target: String) {
            if (target == "cancelled") {
                showCancelReason(orderId, customer.clientId)
                return
            }
            button.isEnabled = false
            thread(name = "kun-fallback-call-decision") {
                val result = KunCustomerServiceApi.updateState(this, orderId, target, selectedClientId = customer.clientId)
                runOnUiThread {
                    Toast.makeText(this, if (result.ok) {
                        when (target) {
                            "confirmed" -> "تم تأكيد الطلب"
                            "cancelled" -> "تم إلغاء الطلب بواسطة العميل"
                            else -> "تم نقل الأوردر إلى العميل لا يرد"
                        }
                    } else result.message, Toast.LENGTH_LONG).show()
                    if (result.ok) finish() else button.isEnabled = true
                }
            }
        }
        if (!locked) {
            customer.orderId?.takeIf { it.isNotBlank() }?.let { orderId ->
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                }
                val buttons = listOf(
                    action("العميل\nلا يرد", 0xFFB45309.toInt(), Color.WHITE) { decision(it, orderId, "no_answer") },
                    action("تم\nالتأكيد", pine, Color.WHITE) { decision(it, orderId, "confirmed") },
                    action("العميل\nلغى", 0xFFAE3446.toInt(), Color.WHITE) { decision(it, orderId, "cancelled") },
                    action("تعديل بيانات\nالشحن J&T", chrome, Color.WHITE) {
                        startActivity(Intent(this@CallerCardActivity, CallerJntOrderEditActivity::class.java).apply {
                            putExtra(CallerJntOrderEditActivity.EXTRA_ORDER_ID, orderId)
                            putExtra(CallerJntOrderEditActivity.EXTRA_CLIENT_ID, customer.clientId)
                            putExtra(CallerJntOrderEditActivity.EXTRA_STORE_ID, customer.storeId)
                            putExtra(CallerJntOrderEditActivity.EXTRA_SHIPPING_ONLY, true)
                        })
                        finish()
                    }
                )
                buttons.forEach { row.addView(it, LinearLayout.LayoutParams(0, dp(54), 1f).apply { setMargins(dp(2), 0, dp(2), 0) }) }
                actions.addView(row)
            }
        }
        val secondary = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        secondary.addView(action("إغلاق", ground, ink2) { finish() })
        actions.addView(secondary)
        card.addView(actions)
        root.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        if (!locked && !customer.orderId.isNullOrBlank()) {
            thread(name = "kun-call-card-details") {
                val result = KunCustomerServiceApi.fetchOrderDetails(this, customer.orderId,
                    selectedClientId = customer.clientId, selectedStoreId = customer.storeId)
                runOnUiThread {
                    val stillUnlocked = !(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
                    if (!isFinishing && stillUnlocked) {
                        if (result.ok) renderCallerFullDetails(this, detailsHost, result.data)
                        else detailsHost.addView(TextView(this).apply {
                            text = "تعذر تحميل التفاصيل: ${result.message}"
                            textSize = 12f
                            setTextColor(ink2)
                        })
                    }
                }
            }
        }
        if (!locked && intent.getBooleanExtra("start_cancel", false)) {
            customer.orderId?.takeIf { it.isNotBlank() }?.let { showCancelReason(it, customer.clientId) }
        }
    }
}
