package com.kunonline.callerid

import org.json.JSONArray
import org.json.JSONObject

data class OrderUi(
    val id: String,
    val ref: String,
    val name: String,
    val phone: String,
    val state: String,
    val checkpoint: String,
    val total: Double,
    val gov: String,
    val address: String,
    val product: String,
    val qty: Int,
    val awb: String,
    val date: String,
    val note: String,
    val source: String
)

data class CustomerUi(
    val id: String,
    val name: String,
    val phone: String,
    val gov: String,
    val address: String,
    val note: String,
    val ordersCount: Int = 0,
    val totalSpend: Double = 0.0
)

data class ProductUi(
    val id: String,
    val name: String,
    val sku: String,
    val category: String,
    val price: Double,
    val cost: Double,
    val stock: Double,
    val lowStockThreshold: Double
)

data class CommerceSnapshot(
    val orders: List<OrderUi> = emptyList(),
    val customers: List<CustomerUi> = emptyList(),
    val products: List<ProductUi> = emptyList(),
    val raw: JSONObject = JSONObject()
) {
    val totalSales: Double get() = orders.sumOf { it.total }
    val pendingOrders: Int get() = orders.count { it.state in setOf("pending", "new", "جديد") }
    val confirmedOrders: Int get() = orders.count { it.state in setOf("confirmed", "تم التأكيد") }
    val shippingOrders: Int get() = orders.count { it.state in setOf("shipping", "in_shipping", "جاري الشحن") || it.checkpoint.contains("shipping", true) }
    val shippedOrders: Int get() = orders.count { it.state in setOf("shipped", "تم الشحن") }
    val collectedOrders: Int get() = orders.count { it.state in setOf("collected", "تم التحصيل") }
    val lowStockProducts: Int get() = products.count { it.stock <= it.lowStockThreshold }
}

object CommerceParser {
    fun parse(root: JSONObject): CommerceSnapshot {
        val orders = parseOrders(root.optJSONArray("orders") ?: JSONArray())
        val products = parseProducts(root.optJSONArray("products") ?: JSONArray())
        val customersArray = root.optJSONArray("customers")
        val customers = if (customersArray != null && customersArray.length() > 0) {
            parseCustomers(customersArray, orders)
        } else {
            customersFromOrders(orders)
        }
        return CommerceSnapshot(orders = orders, customers = customers, products = products, raw = root)
    }

    private fun parseOrders(array: JSONArray): List<OrderUi> = buildList {
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            add(
                OrderUi(
                    id = o.str("id"),
                    ref = o.str("ref").ifBlank { o.str("id") },
                    name = o.str("name"),
                    phone = o.str("phone"),
                    state = o.str("state"),
                    checkpoint = o.str("checkpoint"),
                    total = o.num("total"),
                    gov = o.str("gov"),
                    address = o.str("address"),
                    product = o.str("product"),
                    qty = o.optInt("qty", 1).coerceAtLeast(1),
                    awb = o.str("awb"),
                    date = o.str("date"),
                    note = o.str("note"),
                    source = o.str("source")
                )
            )
        }
    }

    private fun parseProducts(array: JSONArray): List<ProductUi> = buildList {
        for (i in 0 until array.length()) {
            val p = array.optJSONObject(i) ?: continue
            add(
                ProductUi(
                    id = p.str("id"),
                    name = p.str("name"),
                    sku = p.str("sku"),
                    category = p.str("category"),
                    price = p.num("price"),
                    cost = p.num("cost"),
                    stock = p.num("stock"),
                    lowStockThreshold = if (p.has("lowStockThreshold")) p.num("lowStockThreshold") else p.num("low_stock_threshold", 5.0)
                )
            )
        }
    }

    private fun parseCustomers(array: JSONArray, orders: List<OrderUi>): List<CustomerUi> = buildList {
        val orderGroups = orders.filter { it.phone.isNotBlank() }.groupBy { PhoneNormalizer.normalize(it.phone) }
        for (i in 0 until array.length()) {
            val c = array.optJSONObject(i) ?: continue
            val phone = c.str("phone")
            val related = orderGroups[PhoneNormalizer.normalize(phone)].orEmpty()
            add(
                CustomerUi(
                    id = c.str("id"),
                    name = c.str("name"),
                    phone = phone,
                    gov = c.str("gov"),
                    address = c.str("address"),
                    note = c.str("note"),
                    ordersCount = related.size,
                    totalSpend = related.sumOf { it.total }
                )
            )
        }
    }

    private fun customersFromOrders(orders: List<OrderUi>): List<CustomerUi> = orders
        .filter { it.phone.isNotBlank() }
        .groupBy { PhoneNormalizer.normalize(it.phone) }
        .map { (phone, rows) ->
            val latest = rows.first()
            CustomerUi(
                id = phone,
                name = latest.name,
                phone = latest.phone,
                gov = latest.gov,
                address = latest.address,
                note = latest.note,
                ordersCount = rows.size,
                totalSpend = rows.sumOf { it.total }
            )
        }
        .sortedByDescending { it.ordersCount }

    private fun JSONObject.str(key: String): String = optString(key, "").trim()
    private fun JSONObject.num(key: String, fallback: Double = 0.0): Double {
        val value = opt(key) ?: return fallback
        return when (value) {
            is Number -> value.toDouble()
            else -> value.toString().toDoubleOrNull() ?: fallback
        }
    }
}
