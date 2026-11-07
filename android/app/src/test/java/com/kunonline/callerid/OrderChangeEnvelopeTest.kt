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

    @Test fun outOfOrderResponsesCannotRegressPersistedJournalCursor() {
        val seq12 = "v1.12." + "a".repeat(64)
        val seq13 = "v1.13." + "b".repeat(64)
        val seq11 = "v1.11." + "c".repeat(64)
        assertTrue(OrderChangeEnvelope.mayAcknowledge("", seq12, false))
        assertTrue(OrderChangeEnvelope.mayAcknowledge(seq12, seq13, false))
        assertFalse(OrderChangeEnvelope.mayAcknowledge(seq13, seq12, false))
        assertTrue(OrderChangeEnvelope.mayAcknowledge(seq13, seq13, false))
        assertFalse(OrderChangeEnvelope.mayAcknowledge(seq13, "v1.0.invalid", false))
        // Restored/rebuilt journal or rotated HMAC key: only an explicit
        // server reset, followed by a successful snapshot, may go backwards.
        assertTrue(OrderChangeEnvelope.mayAcknowledge(seq13, seq11, true))
        assertFalse(OrderChangeEnvelope.mayAcknowledge(seq13, seq11, false))
        assertFalse(OrderChangeEnvelope.mayAcknowledge(seq13,
            "v1." + "9".repeat(40) + "." + "a".repeat(64), false))
    }

    @Test fun resetDecisionIsExplicitAndNormalUpdatesAreNot() {
        val reset = OrderChangeEnvelope.parse(JSONObject()
            .put("ok", true).put("protocol", 1).put("mode", "reset")
            .put("cursor", cursor).put("resetRequired", true))
        assertTrue(reset.reset)
        val changed = OrderChangeEnvelope.parse(JSONObject()
            .put("ok", true).put("protocol", 1).put("mode", "changes")
            .put("cursor", cursor).put("changes", org.json.JSONArray().put(JSONObject()
                .put("seq", 12).put("orderId", "order-12"))))
        assertFalse(changed.reset)
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
