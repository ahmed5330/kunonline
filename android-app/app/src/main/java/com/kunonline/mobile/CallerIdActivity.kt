package com.kunonline.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.text.NumberFormat
import java.util.Locale

class CallerIdActivity : Activity() {
    private lateinit var kickerView: TextView
    private lateinit var nameView: TextView
    private lateinit var phoneView: TextView
    private lateinit var metaView: TextView
    private lateinit var addressView: TextView
    private lateinit var openButton: Button
    private var phone: String = ""
    private var direction: Int = Call.Details.DIRECTION_INCOMING

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.setGravity(Gravity.TOP)

        phone = intent.getStringExtra(EXTRA_PHONE).orEmpty()
        direction = intent.getIntExtra(EXTRA_DIRECTION, Call.Details.DIRECTION_INCOMING)
        setContentView(buildCard())
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        phoneView.text = phone
        updateDirectionLabel()
        lookup()
        Handler(Looper.getMainLooper()).postDelayed({ if (!isFinishing) finish() }, 25000)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        phone = intent?.getStringExtra(EXTRA_PHONE).orEmpty()
        direction = intent?.getIntExtra(EXTRA_DIRECTION, Call.Details.DIRECTION_INCOMING) ?: Call.Details.DIRECTION_INCOMING
        phoneView.text = phone
        updateDirectionLabel()
        lookup()
    }

    private fun updateDirectionLabel() {
        if (!::kickerView.isInitialized) return
        kickerView.text = if (direction == Call.Details.DIRECTION_OUTGOING) {
            "Kun Online · أنت تتصل بالعميل"
        } else {
            "Kun Online · عميل بيتصل بك"
        }
    }

    private fun buildCard(): LinearLayout {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(14), dp(12), dp(8))
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1), Color.rgb(229, 231, 235))
            }
            elevation = dp(12).toFloat()
        }
        kickerView = TextView(this).apply {
            setTextColor(Color.rgb(75, 85, 99))
            textSize = 12f
        }
        nameView = TextView(this).apply {
            text = getString(R.string.caller_loading)
            setTextColor(Color.rgb(17, 24, 39))
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(5), 0, 0)
        }
        phoneView = TextView(this).apply {
            setTextColor(Color.rgb(55, 65, 81))
            textSize = 16f
            textDirection = TextView.TEXT_DIRECTION_LTR
        }
        metaView = TextView(this).apply {
            setTextColor(Color.rgb(31, 41, 55))
            textSize = 14f
            setPadding(0, dp(8), 0, 0)
        }
        addressView = TextView(this).apply {
            setTextColor(Color.rgb(107, 114, 128))
            textSize = 13f
            setPadding(0, dp(5), 0, 0)
        }
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(10), 0, 0)
        }
        val close = Button(this).apply {
            text = "إغلاق"
            setOnClickListener { finish() }
        }
        openButton = Button(this).apply {
            text = "فتح العميل"
            isEnabled = false
            setOnClickListener {
                startActivity(Intent(this@CallerIdActivity, MainActivity::class.java).apply {
                    putExtra(MainActivity.EXTRA_FROM_CALLER_ID, true)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                })
                finish()
            }
        }
        actions.addView(close)
        actions.addView(openButton)
        card.addView(kickerView)
        card.addView(nameView)
        card.addView(phoneView)
        card.addView(metaView)
        card.addView(addressView)
        card.addView(actions)
        outer.addView(card)
        return outer
    }

    private fun lookup() {
        nameView.text = getString(R.string.caller_loading)
        metaView.text = ""
        addressView.text = ""
        openButton.isEnabled = false
        Thread {
            val info = KunApi.lookupCaller(phone)
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                when {
                    info.needsLogin -> {
                        nameView.text = "سجل الدخول في Kun Online"
                        metaView.text = "افتح التطبيق وسجل الدخول مرة واحدة لتفعيل معرفة العملاء وقت الاتصال."
                    }
                    !info.found -> {
                        nameView.text = getString(R.string.caller_unknown)
                        metaView.text = "الرقم غير موجود حاليًا في Customer 360."
                    }
                    else -> {
                        nameView.text = info.name.ifBlank { "عميل Kun Online" }
                        phoneView.text = info.phone.ifBlank { phone }
                        val money = NumberFormat.getNumberInstance(Locale("ar", "EG")).format(info.totalSpent)
                        metaView.text = "${info.totalOrders} طلب · إجمالي تعامل $money ج" +
                            if (info.lastOrderDate.isNotBlank()) " · آخر طلب ${info.lastOrderDate.take(10)}" else ""
                        addressView.text = listOf(info.gov, info.address).filter { it.isNotBlank() }.joinToString(" · ")
                        openButton.isEnabled = true
                    }
                }
            }
        }.start()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PHONE = "callerPhone"
        const val EXTRA_DIRECTION = "callerDirection"
    }
}
