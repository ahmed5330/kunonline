package com.kunonline.callerid

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class CommerceParserDateFallbackTest {
    @Test fun nullDateUsesValidCreatedAtOnTodayFilter() {
        val today = LocalDate.now(ZoneId.of("Africa/Cairo"))
        val payload = JSONObject().put("orders", JSONArray().put(
            JSONObject().put("id", "valid-today")
                .put("date", JSONObject.NULL)
                .put("created_at", today.toString())
        ))
        MobileDateFilterState.select(MobileDatePreset.TODAY)
        val parsed = CommerceParser.parse(payload)
        assertEquals(listOf("valid-today"), parsed.orders.map { it.id })
        assertEquals(today.toString(), parsed.orders.single().date)
        MobileDateFilterState.select(MobileDatePreset.ALL)
    }

    @Test fun invalidPrimaryDateDoesNotOverrideParseableCreationDate() {
        val today = LocalDate.now(ZoneId.of("Africa/Cairo"))
        val payload = JSONObject().put("orders", JSONArray().put(
            JSONObject().put("id", "fallback-today")
                .put("date", "not-a-date")
                .put("createdAt", today.toString())
        ))
        MobileDateFilterState.select(MobileDatePreset.TODAY)
        assertEquals(listOf("fallback-today"), CommerceParser.parse(payload).orders.map { it.id })
        MobileDateFilterState.select(MobileDatePreset.ALL)
    }

    @Test fun invalidLegacyDateStillAvailableUnderAllPeriods() {
        val payload = JSONObject().put("orders", JSONArray().put(
            JSONObject().put("id", "legacy").put("date", "date-not-parseable")
        ))
        MobileDateFilterState.select(MobileDatePreset.ALL)
        assertEquals(1, CommerceParser.parse(payload).orders.size)
    }
}
