package com.kunonline.callerid

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * Displays server-authorized order information in the existing call card.
 * Never show this view on a locked device; callers enforce that boundary.
 * A blank optional field stays hidden rather than being represented as zero.
 */
internal fun renderCallerFullDetails(context: Context, target: LinearLayout, details: JSONObject) {
    target.removeAllViews()
    val order = details.optJSONObject("order") ?: JSONObject()
    val customer = details.optJSONObject("customer") ?: JSONObject()
    val address = details.optJSONObject("address") ?: JSONObject()
    val summary = details.optJSONObject("summary") ?: JSONObject()
    val raw = details.optJSONObject("raw") ?: JSONObject()
    val density = context.resources.displayMetrics.density
    fun dp(value: Int): Int = (value * density).toInt()
    fun line(label: String, value: String, strong: Boolean = false) {
        if (value.isBlank() || value == "null") return
        target.addView(TextView(context).apply {
            text = "$label: $value"
            textSize = if (strong) 14f else 13f
            setTextColor(if (strong) Color.rgb(24, 54, 83) else Color.rgb(70, 90, 109))
            if (strong) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(3), 0, dp(3))
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        })
    }
    fun money(obj: JSONObject, key: String): String =
        if (!obj.has(key) || obj.isNull(key)) "" else obj.optDouble(key, 0.0).toString() + " ج.م"

    line("تفاصيل الطلب كاملة", order.optString("ref").ifBlank { order.optString("id") }, true)
    line("المتجر", raw.optString("storeName").ifBlank { order.optString("storeId") })
    line("الحالة", order.optString("state"))
    line("تاريخ الطلب", order.optString("date").take(16))
    line("اسم العميل", customer.optString("name"))
    line("الهاتف", customer.optString("phone"))
    line("هاتف بديل", customer.optString("phone2"))
    line("مرحلة تجهيز الطلب", order.optString("checkpoint"))
    line("المحافظة", address.optString("government"))
    line("العنوان", address.optString("address"))
    line("المدينة أو المركز", address.optString("city"))
    line("المنطقة", address.optString("area"))
    line("الشارع", address.optString("street"))
    line("البوليصة", order.optString("awb"))
    line("اسم المتجر", order.optString("storeName"))
    val items = details.optJSONArray("items")
    if (items != null && items.length() > 0) {
        line("المنتجات", "${items.length()} بند", true)
        for (index in 0 until minOf(items.length(), 30)) {
            val item = items.optJSONObject(index) ?: continue
            val title = item.optString("productName").ifBlank { item.optString("name") }
            val variant = item.optString("variantName").ifBlank { item.optString("note") }
            val qty = item.optInt("qty", item.optInt("quantity", 1)).coerceAtLeast(1)
            line("${index + 1}", listOfNotNull(
                title.takeIf { it.isNotBlank() },
                variant.takeIf { it.isNotBlank() },
                "الكمية $qty",
                money(item, "unitPrice").takeIf { it.isNotBlank() }
            ).joinToString(" • "))
        }
    }
    line("كمية الطلب", summary.optString("qty"))
    line("الخصم", money(summary, "discountAmount"))
    line("تكلفة الشحن المسجلة", money(summary, "shippingCost"))
    line("مصاريف أخرى", money(summary, "otherCost"))
    line("الإجمالي", money(summary, "total"), true)
    line("كوبون الخصم", order.optString("couponCode"))
    line("المصدر", order.optString("source"))
    line("ملاحظات العميل", order.optString("customerNote"))
}
