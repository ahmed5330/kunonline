package com.kunonline.callerid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class DashboardRangeTest {
    private val today = LocalDate.of(2026, 9, 16)

    @Test
    fun todayAndYesterdayBoundsAreCorrect() {
        assertEquals(today to today, v23RangeBounds(DashboardRange.TODAY, today))
        assertEquals(today.minusDays(1) to today.minusDays(1), v23RangeBounds(DashboardRange.YESTERDAY, today))
    }

    @Test
    fun weekBoundsStartOnMonday() {
        assertEquals(LocalDate.of(2026, 9, 14) to today, v23RangeBounds(DashboardRange.CURRENT_WEEK, today))
        assertEquals(
            LocalDate.of(2026, 9, 7) to LocalDate.of(2026, 9, 13),
            v23RangeBounds(DashboardRange.PREVIOUS_WEEK, today)
        )
    }

    @Test
    fun monthBoundsAreCorrect() {
        assertEquals(LocalDate.of(2026, 9, 1) to today, v23RangeBounds(DashboardRange.CURRENT_MONTH, today))
        assertEquals(
            LocalDate.of(2026, 8, 1) to LocalDate.of(2026, 8, 31),
            v23RangeBounds(DashboardRange.PREVIOUS_MONTH, today)
        )
    }

    @Test
    fun filtersOrdersBySelectedRange() {
        val rows = listOf(
            order("1", "2026-09-16"),
            order("2", "2026-09-15T10:30:00Z"),
            order("3", "2026-09-10"),
            order("4", "2026-08-31")
        )
        assertEquals(listOf("1"), v23FilterOrders(rows, DashboardRange.TODAY, today).map { it.id })
        assertEquals(listOf("2"), v23FilterOrders(rows, DashboardRange.YESTERDAY, today).map { it.id })
        assertTrue(v23FilterOrders(rows, DashboardRange.CURRENT_WEEK, today).map { it.id }.containsAll(listOf("1", "2")))
        assertEquals(listOf("4"), v23FilterOrders(rows, DashboardRange.PREVIOUS_MONTH, today).map { it.id })
    }

    private fun order(id: String, date: String) = OrderUi(
        id = id,
        ref = id,
        name = "",
        phone = "",
        state = "pending",
        checkpoint = "",
        total = 0.0,
        gov = "",
        address = "",
        product = "",
        qty = 1,
        awb = "",
        date = date,
        note = "",
        source = ""
    )
}
