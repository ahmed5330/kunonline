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
    line("المحافظة", address.optString("government"))
    line("العنوان", address.optString("address"))
    line("المدينة أو المركز", address.optString("city"))
    line("المنطقة", address.optString("area"))
    line("الشارع", address.optString("street"))
    line("البوليصة", order.optString("awb"))
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

/**
 * Compact product-only summary for the live call overlay.
 * Never expose raw order UUIDs or store IDs in this small window.
 */
internal fun renderCallerProductSummary(context: Context, target: LinearLayout, details: JSONObject) {
    target.removeAllViews()
    val items = details.optJSONArray("items") ?: return
    if (items.length() == 0) return
    val density = context.resources.displayMetrics.density
    fun dp(value: Int): Int = (value * density).toInt()
    fun add(textValue: String, bold: Boolean = false) {
        target.addView(TextView(context).apply {
            text = textValue
            textSize = if (bold) 13f else 12f
            setTextColor(if (bold) Color.rgb(24, 54, 83) else Color.rgb(70, 90, 109))
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(3), 0, dp(3))
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        })
    }
    add("تفاصيل المنتجات (${items.length()})", true)
    for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val product = item.optString("name").ifBlank { item.optString("productName") }.ifBlank { "منتج" }
        val quantity = item.optInt("quantity", item.optInt("qty", 1)).coerceAtLeast(1)
        add("${index + 1}. $product × $quantity", true)
        val options = item.optJSONArray("options")
        val attributes = buildList<String> {
            item.optString("variantName").takeIf { it.isNotBlank() }?.let { add(it) }
            if (options != null) {
                for (optionIndex in 0 until options.length()) {
                    val option = options.optJSONObject(optionIndex) ?: continue
                    val name = option.optString("name")
                    val value = option.optString("value")
                    if (name.isNotBlank() && value.isNotBlank()) add("$name: $value")
                }
            }
            if (options == null || options.length() == 0) {
                item.optString("note").takeIf { it.isNotBlank() }?.let { add(it) }
            }
            item.optString("sku").takeIf { it.isNotBlank() }?.let { add("كود المنتج: $it") }
            val price = item.optDouble("price", item.optDouble("unitPrice", Double.NaN))
            if (price.isFinite()) add("سعر القطعة: $price ج.م")
        }
        if (attributes.isNotEmpty()) add(attributes.joinToString(" • "))
    }
}
