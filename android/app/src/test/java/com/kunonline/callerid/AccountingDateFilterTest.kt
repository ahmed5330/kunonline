package com.kunonline.callerid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class AccountingDateFilterTest {
    @Test fun thirtyDaysIncludesToday() {
        val range = AccountingDateFilter.lastDays(30, LocalDate.of(2026, 10, 23))
        assertEquals("2026-09-24", range.from)
        assertEquals("2026-10-23", range.to)
    }

    @Test fun todayOnly() {
        val range = AccountingDateFilter.lastDays(1, LocalDate.of(2026, 10, 23))
        assertEquals("2026-10-23", range.from)
        assertEquals("2026-10-23", range.to)
    }

    @Test fun acceptsHistoricValidRange() {
        assertNull(AccountingDateFilter.validate("2025-01-01", "2026-10-23"))
    }

    @Test fun rejectsReverseRange() {
        assertEquals(
            "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية",
            AccountingDateFilter.validate("2026-10-23", "2026-10-22")
        )
    }

    @Test fun rejectsInvalidCalendarDate() {
        assertEquals(
            "اكتب تاريخ البداية بالشكل YYYY-MM-DD",
            AccountingDateFilter.validate("2026-02-30", "2026-10-23")
        )
    }
}
