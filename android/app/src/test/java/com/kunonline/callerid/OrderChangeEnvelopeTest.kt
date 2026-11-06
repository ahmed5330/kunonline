package com.kunonline.callerid

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OrderChangeEnvelopeTest {
    private val cursor = "v1.12." + "a".repeat(64)

    @Test fun firstOrInvalidCursorDemandsVerifiedFullReset() {
        val reset = OrderChangeEnvelope.parse(JSONObject()
            .put("ok", true).put("protocol", 1).put("mode", "reset")
            .put("cursor", cursor).put("resetRequired", true))
        assertTrue(reset.refresh)
        assertEquals(cursor, reset.cursor)
    }

    @Test fun changedOrderForcesRefreshAndUnchangedDoesNot() {
        val changed = OrderChangeEnvelope.parse(JSONObject("""{
          "ok":true,"protocol":1,"mode":"changes",
          "cursor":"$cursor","changes":[{"seq":12,"orderId":"o1","operation":"remove"}],
          "hasMore":true
        }"""))
        assertTrue(changed.refresh)
        assertTrue(changed.hasMore)
        val same = OrderChangeEnvelope.parse(JSONObject()
            .put("ok", true).put("protocol", 1).put("mode", "unchanged")
            .put("cursor", cursor))
        assertFalse(same.refresh)
    }

    @Test fun invalidCursorAndMalformedResponseCannotBeAcknowledged() {
        for (invalid in listOf("client1:12", "v1.7.invalid", "v2.3." + "a".repeat(64))) {
            try {
                OrderChangeEnvelope.parse(JSONObject().put("ok", true)
                    .put("protocol", 1).put("mode", "unchanged").put("cursor", invalid))
                fail("Invalid cursor must be rejected")
            } catch (_: IllegalArgumentException) {
                // required
            }
        }
        try {
            OrderChangeEnvelope.parse(JSONObject().put("ok", false)
                .put("protocol", 1).put("mode", "unchanged").put("cursor", cursor))
            fail("Rejected authorization result must not be treated as unchanged")
        } catch (_: IllegalArgumentException) {
            // required
        }
    }
}
