package com.kunonline.callerid

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
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
            val box = LinearLayout(app).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(32, 24, 32, 24)
                setBackgroundColor(Color.argb(247, 255, 255, 255))
                elevation = 18f
            }
            box.addView(TextView(app).apply {
                text = if (incoming) "مكالمة واردة — Kun Online" else "مكالمة صادرة — Kun Online"
                textSize = 13f
                setTextColor(Color.rgb(36, 99, 235))
            })
            box.addView(TextView(app).apply {
                text = customer.name.ifBlank { "عميل كن أونلاين" }
                textSize = 20f
                setTextColor(Color.BLACK)
            })
            box.addView(TextView(app).apply {
                text = customer.phone
                textSize = 15f
                setTextColor(Color.DKGRAY)
            })
            val orderBits = listOfNotNull(
                customer.orderRef?.takeUnless { locked }?.let { "طلب $it" },
                stateText(customer.status).takeIf { it.isNotBlank() }
            ).joinToString(" • ")
            if (orderBits.isNotBlank()) box.addView(TextView(app).apply {
                text = orderBits
                textSize = 14f
                setTextColor(Color.DKGRAY)
            })
            if (!locked) {
                val productBits = listOfNotNull(
                    customer.product,
                    customer.total?.let { "الإجمالي ${it.toInt()}" }
                ).joinToString(" • ")
                if (productBits.isNotBlank()) box.addView(TextView(app).apply {
                    text = productBits
                    textSize = 14f
                    setTextColor(Color.DKGRAY)
                })
                val address = listOfNotNull(customer.gov, customer.address)
                    .filter { it.isNotBlank() }
                    .joinToString(" — ")
                if (address.isNotBlank()) box.addView(TextView(app).apply {
                    text = address
                    textSize = 13f
                    setTextColor(Color.GRAY)
                })
                customer.note?.takeIf { it.isNotBlank() }?.let { note ->
                    box.addView(TextView(app).apply {
                        text = "ملاحظة: $note"
                        textSize = 13f
                        setTextColor(Color.GRAY)
                    })
                }
                if (customer.previousOrders > 0) box.addView(TextView(app).apply {
                    text = "له ${customer.previousOrders} طلب سابق"
                    textSize = 13f
                    setTextColor(Color.GRAY)
                })
                box.addView(TextView(app).apply {
                    text = "النافذة ستظل مفتوحة حتى تضغط إغلاق"
                    textSize = 11f
                    setTextColor(Color.GRAY)
                })
            }

            val actions = LinearLayout(app).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
            }
            if (!locked) {
                customer.orderId?.takeIf { it.isNotBlank() }?.let { orderId ->
                    actions.addView(Button(app).apply {
                        text = "تعديل الطلب"
                        setOnClickListener {
                            runCatching {
                                app.startActivity(
                                    Intent(app, CallerOrderEditActivity::class.java).apply {
                                        putExtra(CallerOrderEditActivity.EXTRA_ORDER_ID, orderId)
                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                                    }
                                )
                            }
                        }
                    })
                }
                actions.addView(Button(app).apply {
                    text = "فتح التطبيق"
                    setOnClickListener {
                        runCatching {
                            app.startActivity(
                                Intent(app, MainActivity::class.java).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                                }
                            )
                        }
                    }
                })
            }
            actions.addView(Button(app).apply {
                text = "إغلاق"
                setOnClickListener { dismiss() }
            })
            box.addView(actions)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP
                y = 80
            }
            runCatching {
                wm.addView(box, params)
                currentView = box
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
