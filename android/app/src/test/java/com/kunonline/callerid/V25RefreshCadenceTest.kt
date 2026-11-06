package com.kunonline.callerid

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class V25RefreshCadenceTest {
    @Test fun operationalTabRefreshesAfterFifteenSeconds() {
        val last = 100_000L
        assertTrue(v25SkipSilentRefresh(true, true, last + 14_999L, last, 15_000L))
        assertFalse(v25SkipSilentRefresh(true, true, last + 15_000L, last, 15_000L))
        assertFalse(v25SkipSilentRefresh(true, true, last + 30_000L, last, 15_000L))
    }

    @Test fun homeStillPreservesSixtySecondCadence() {
        val last = 100_000L
        assertTrue(v25SkipSilentRefresh(true, true, last + 15_000L, last, 60_000L))
        assertTrue(v25SkipSilentRefresh(true, true, last + 59_999L, last, 60_000L))
        assertFalse(v25SkipSilentRefresh(true, true, last + 60_000L, last, 60_000L))
    }

    @Test fun missingSnapshotManualRefreshAndClockResetNeverBlock() {
        assertFalse(v25SkipSilentRefresh(true, false, 102_000L, 100_000L, 60_000L))
        assertFalse(v25SkipSilentRefresh(false, true, 102_000L, 100_000L, 60_000L))
        assertFalse(v25SkipSilentRefresh(true, true, 10_000L, 100_000L, 60_000L))
        assertFalse(v25SkipSilentRefresh(true, true, 10_000L, 0L, 60_000L))
    }
}
