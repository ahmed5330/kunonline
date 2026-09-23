package com.kunonline.callerid

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

object CallerOverlay {
    private var currentView: View? = null
    private var currentManager: WindowManager? = null
    private val handler = Handler(Looper.getMainLooper())

    private const val CHROME = 0xFF0E5095.toInt()
    private const val PINE = 0xFF3F8F2B.toInt()
    private const val INK = 0xFF12212B.toInt()
    private const val INK2 = 0xFF3D5563.toInt()
    private const val LINE = 0xFFD3DEDA.toInt()
    private const val SURFACE = 0xFFFFFFFF.toInt()
    private const val SURFACE2 = 0xFFF5F8F7.toInt()

    private fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radiusDp: Float, context: Context, strokeColor: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = radiusDp * context.resources.displayMetrics.density
            strokeColor?.let { setStroke(context.dp(1), it) }
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

    fun show(context: Context, customer: CallerCustomer, incoming: Boolean) {
        val app = context.applicationContext
        handler.post {
            if (!Settings.canDrawOverlays(app)) {
                runCatching {
                    app.startActivity(Intent(app, CallerCardActivity::class.java).apply {
                        putExtra("phone", customer.phone)
                        putExtra("incoming", incoming)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                }
                return@post
            }
            dismiss()
            val locked = (app.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
            val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager

            val card = LinearLayout(app).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                background = rounded(SURFACE, 18f, app, LINE)
                elevation = app.dp(12).toFloat()
                clipToOutline = true
            }

            val header = LinearLayout(app).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(app.dp(18), app.dp(14), app.dp(18), app.dp(12))
                background = rounded(CHROME, 18f, app)
            }
            header.addView(TextView(app).apply {
                text = if (incoming) "مكالمة واردة" else "مكالمة صادرة"
                textSize = 12f
                setTextColor(Color.WHITE)
                alpha = .78f
            })
            header.addView(TextView(app).apply {
                text = customer.name.ifBlank { "عميل كن أونلاين" }
                textSize = 21f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(Color.WHITE)
                setPadding(0, app.dp(2), 0, 0)
            })
            card.addView(header)

            val body = LinearLayout(app).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(app.dp(18), app.dp(14), app.dp(18), app.dp(8))
            }
            fun line(textValue: String, size: Float = 14f, color: Int = INK2, bold: Boolean = false) {
                if (textValue.isBlank()) return
                body.addView(TextView(app).apply {
                    text = textValue
                    textSize = size
                    setTextColor(color)
                    if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
                    setPadding(0, app.dp(3), 0, app.dp(3))
                })
            }
            line(customer.phone, 15f, INK, true)
            val orderBits = listOfNotNull(
                customer.orderRef?.takeUnless { locked }?.let { "طلب $it" },
                stateText(customer.status).takeIf { it.isNotBlank() }
            ).joinToString(" • ")
            line(orderBits, 13f, CHROME, true)
            if (!locked) {
                line(listOfNotNull(customer.product, customer.total?.let { "الإجمالي ${it.toInt()} ج.م" }).joinToString(" • "), 14f, INK)
                line(listOfNotNull(customer.gov, customer.address).filter { it.isNotBlank() }.joinToString(" — "), 13f)
                customer.note?.takeIf { it.isNotBlank() }?.let { line("ملاحظة: $it", 13f) }
                if (customer.previousOrders > 0) line("له ${customer.previousOrders} طلب سابق", 12f)
            }
            card.addView(body)

            val actions = LinearLayout(app).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
                setPadding(app.dp(12), app.dp(4), app.dp(12), app.dp(12))
            }
            fun actionButton(label: String, fill: Int?, textColor: Int, onClick: () -> Unit): Button = Button(app).apply {
                text = label
                isAllCaps = false
                setTextColor(textColor)
                textSize = 13f
                minHeight = app.dp(44)
                minimumHeight = app.dp(44)
                setPadding(app.dp(12), 0, app.dp(12), 0)
                backgroundTintList = ColorStateList.valueOf(fill ?: SURFACE2)
                setOnClickListener { onClick() }
            }
            if (!locked) {
                customer.orderId?.takeIf { it.isNotBlank() }?.let { orderId ->
                    actions.addView(actionButton("تعديل بيانات J&T", PINE, Color.WHITE) {
                        dismiss()
                        runCatching {
                            app.startActivity(Intent(app, CallerJntOrderEditActivity::class.java).apply {
                                putExtra(CallerJntOrderEditActivity.EXTRA_ORDER_ID, orderId)
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                            })
                        }
                    })
                }
                actions.addView(actionButton("فتح التطبيق", CHROME, Color.WHITE) {
                    dismiss()
                    runCatching {
                        app.startActivity(Intent(app, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                        })
                    }
                })
            }
            actions.addView(actionButton("إغلاق", null, INK2) { dismiss() })
            card.addView(actions)

            val maxWidth = app.resources.displayMetrics.widthPixels - app.dp(24)
            val params = WindowManager.LayoutParams(
                maxWidth,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = app.dp(18)
            }
            runCatching {
                wm.addView(card, params)
                currentView = card
                currentManager = wm
            }
        }
    }

    fun dismiss() {
        val view = currentView ?: return
        runCatching { currentManager?.removeView(view) }
        currentView = null
        currentManager = null
    }
}
