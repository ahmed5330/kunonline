package com.kunonline.callerid

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

class CallerCardActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        val phone = intent.getStringExtra("phone").orEmpty()
        val customer = CustomerCache.lookup(this, phone) ?: run { finish(); return }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(40, 24, 40, 24)
            setBackgroundColor(Color.WHITE)
        }
        box.addView(TextView(this).apply { text = customer.name; textSize = 20f; setTextColor(Color.BLACK) })
        box.addView(TextView(this).apply { text = customer.phone; textSize = 16f; setTextColor(Color.DKGRAY) })
        customer.orderRef?.takeIf { it.isNotBlank() }?.let { ref ->
            box.addView(TextView(this).apply { text = "Order: $ref  ${customer.status.orEmpty()}"; textSize = 14f; setTextColor(Color.DKGRAY) })
        }
        setContentView(box)
    }
}
