package com.kunonline.callerid

import org.json.JSONArray
import org.json.JSONObject

/** Applies a complete snapshot or an ordered delta atomically. */
class MobileSyncAccumulator {
    var cursor: String = ""
        private set
    var state: JSONObject? = null
        private set

    fun accept(envelope: JSONObject): Boolean {
        require(envelope.getInt("protocol") == 1)
        val nextCursor = envelope.getString("cursor")
        require(nextCursor.isNotBlank())
        val mode = envelope.getString("mode")
        if (mode == "unchanged") {
            require(state != null && cursor == nextCursor)
            return false
        }
        val next = when (mode) {
            "reset" -> JSONObject(envelope.getJSONObject("state").toString())
            "delta" -> {
                val root = JSONObject(requireNotNull(state).toString())
                val orders = envelope.getJSONObject("orders")
                val rows = linkedMapOf<String, JSONObject>()
                val existing = root.optJSONArray("orders") ?: JSONArray()
                for (i in 0 until existing.length()) {
                    val row = existing.getJSONObject(i)
                    rows[row.getString("id")] = row
                }
                val removed = orders.getJSONArray("removed")
                for (i in 0 until removed.length()) rows.remove(removed.getString(i))
                val upsert = orders.getJSONArray("upsert")
                for (i in 0 until upsert.length()) {
                    val row = upsert.getJSONObject(i)
                    rows[row.getString("id")] = row
                }
                val ids = orders.getJSONArray("ids")
                val ordered = JSONArray()
                val seen = mutableSetOf<String>()
                for (i in 0 until ids.length()) {
                    val id = ids.getString(i)
                    require(seen.add(id))
                    ordered.put(requireNotNull(rows[id]))
                }
                root.put("orders", ordered)
                val fields = envelope.getJSONObject("fields")
                for (key in fields.keys()) root.put(key, fields.get(key))
                val removedFields = envelope.getJSONArray("removedFields")
                for (i in 0 until removedFields.length()) root.remove(removedFields.getString(i))
                root
            }
            else -> error("Unknown sync mode")
        }
        state = next
        cursor = nextCursor
        return true
    }
}
