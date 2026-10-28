package com.kunonline.callerid

import org.json.JSONObject

/** Activity-private handoff used when SYSTEM_ALERT_WINDOW is unavailable. */
internal object CallerPayload {
    fun encode(customer: CallerCustomer): String = JSONObject().apply {
        put("name", customer.name)
        put("phone", customer.phone)
        put("orderId", customer.orderId)
        put("orderRef", customer.orderRef)
        put("status", customer.status)
        put("product", customer.product)
        put("total", customer.total)
        put("gov", customer.gov)
        put("address", customer.address)
        put("note", customer.note)
        put("previousOrders", customer.previousOrders)
        put("clientId", customer.clientId)
        put("storeId", customer.storeId)
        put("storeName", customer.storeName)
    }.toString()

    fun decode(raw: String?): CallerCustomer? = runCatching {
        if (raw.isNullOrBlank()) return null
        val value = JSONObject(raw)
        val phone = PhoneNormalizer.normalize(value.optString("phone"))
        val id = value.optString("orderId")
        val clientId = value.optString("clientId")
        val storeId = value.optString("storeId")
        if (phone.isBlank() || id.isBlank() || clientId.isBlank() || storeId.isBlank()) return null
        CallerCustomer(
            name = value.optString("name"),
            phone = phone,
            orderId = id,
            orderRef = value.optString("orderRef").takeIf { it.isNotBlank() },
            status = value.optString("status").takeIf { it.isNotBlank() },
            product = value.optString("product").takeIf { it.isNotBlank() },
            total = value.optDouble("total", 0.0).takeIf { it > 0 },
            gov = value.optString("gov").takeIf { it.isNotBlank() },
            address = value.optString("address").takeIf { it.isNotBlank() },
            note = value.optString("note").takeIf { it.isNotBlank() },
            previousOrders = value.optInt("previousOrders", 0),
            clientId = clientId,
            storeId = storeId,
            storeName = value.optString("storeName")
        )
    }.getOrNull()
}
