package com.kunonline.callerid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class MobileDateFilterV267Test {
    private val today = LocalDate.of(2026, 9, 24)

    @Test
    fun presetBoundsUseCairoBusinessPeriods() {
        MobileDateFilterState.select(MobileDatePreset.TODAY)
        assertEquals(MobileDateBounds(today, today), MobileDateFilterState.bounds(today))

        MobileDateFilterState.select(MobileDatePreset.YESTERDAY)
        assertEquals(MobileDateBounds(LocalDate.of(2026, 9, 23), LocalDate.of(2026, 9, 23)), MobileDateFilterState.bounds(today))

        MobileDateFilterState.select(MobileDatePreset.CURRENT_WEEK)
        assertEquals(MobileDateBounds(LocalDate.of(2026, 9, 21), today), MobileDateFilterState.bounds(today))

        MobileDateFilterState.select(MobileDatePreset.PREVIOUS_WEEK)
        assertEquals(MobileDateBounds(LocalDate.of(2026, 9, 14), LocalDate.of(2026, 9, 20)), MobileDateFilterState.bounds(today))

        MobileDateFilterState.select(MobileDatePreset.CURRENT_MONTH)
        assertEquals(MobileDateBounds(LocalDate.of(2026, 9, 1), today), MobileDateFilterState.bounds(today))

        MobileDateFilterState.select(MobileDatePreset.PREVIOUS_MONTH)
        assertEquals(MobileDateBounds(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31)), MobileDateFilterState.bounds(today))
    }

    @Test
    fun customRangeIsInclusiveAndNormalizesReverseSelection() {
        MobileDateFilterState.selectCustom(LocalDate.of(2026, 9, 15), LocalDate.of(2026, 9, 10))
        assertEquals(
            MobileDateBounds(LocalDate.of(2026, 9, 10), LocalDate.of(2026, 9, 15)),
            MobileDateFilterState.bounds(today)
        )
        assertTrue(MobileDateFilterState.matches("2026-09-10"))
        assertTrue(MobileDateFilterState.matches("2026-09-15T12:30:00Z"))
        assertFalse(MobileDateFilterState.matches("2026-09-16"))
    }
}
