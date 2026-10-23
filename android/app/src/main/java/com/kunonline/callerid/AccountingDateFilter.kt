package com.kunonline.callerid

import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class AccountingDateRange(val from: String, val to: String)

/** Same calendar used by the accounting backend's Africa/Cairo date defaults. */
object AccountingDateFilter {
    fun lastDays(
        days: Int,
        today: LocalDate = LocalDate.now(ZoneId.of("Africa/Cairo"))
    ): AccountingDateRange {
        require(days > 0) { "days must be positive" }
        return AccountingDateRange(today.minusDays(days.toLong() - 1).toString(), today.toString())
    }

    fun validate(from: String, to: String): String? {
        val start = runCatching { LocalDate.parse(from.trim(), DateTimeFormatter.ISO_LOCAL_DATE) }.getOrNull()
            ?: return "اكتب تاريخ البداية بالشكل YYYY-MM-DD"
        val end = runCatching { LocalDate.parse(to.trim(), DateTimeFormatter.ISO_LOCAL_DATE) }.getOrNull()
            ?: return "اكتب تاريخ النهاية بالشكل YYYY-MM-DD"
        if (start.isAfter(end)) return "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية"
        return null
    }
}
