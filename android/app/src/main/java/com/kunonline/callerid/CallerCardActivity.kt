package com.kunonline.callerid

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

class CallerCardActivity : Activity() {
    private fun stateText(state: String?): String = when (state) {
        "pending" -> "جاري التأكيد"
        "confirmed" -> "تم تأكيد الطلب"
        "preparing" -> "جاري الشحن"
        "shipped" -> "تم الشحن"
        "signed" -> "تم التسليم — تحصيل منتظر"
        "collected" -> "تم التحصيل"
        "returned" -> "مرتجع"
        "cancelled" -> "ملغي"
        "deferred" -> "مؤجل"
        else -> state.orEmpty()
    }

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
        fun addLine(textValue: String, size: Float = 14f, color: Int = Color.DKGRAY) {
            if (textValue.isBlank()) return
            box.addView(TextView(this).apply { text = textValue; textSize = size; setTextColor(color) })
        }
        addLine(customer.name.ifBlank { "عميل كن أونلاين" }, 20f, Color.BLACK)
        addLine(customer.phone, 16f)
        addLine(listOfNotNull(customer.orderRef?.let { "طلب $it" }, stateText(customer.status).takeIf { it.isNotBlank() }).joinToString(" • "))
        addLine(listOfNotNull(customer.product, customer.total?.let { "الإجمالي ${it.toInt()}" }).joinToString(" • "))
        addLine(listOfNotNull(customer.gov, customer.address).joinToString(" — "), 13f, Color.GRAY)
        customer.note?.let { addLine("ملاحظة: $it", 13f, Color.GRAY) }
        if (customer.previousOrders > 0) addLine("له ${customer.previousOrders} طلب سابق", 13f, Color.GRAY)
        setContentView(box)
    }
}
