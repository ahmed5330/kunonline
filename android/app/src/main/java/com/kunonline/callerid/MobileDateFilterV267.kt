package com.kunonline.callerid

import android.app.DatePickerDialog
import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters

enum class MobileDatePreset(val label: String) {
    TODAY("اليوم"),
    YESTERDAY("أمس"),
    CURRENT_WEEK("هذا الأسبوع"),
    PREVIOUS_WEEK("الأسبوع الماضي"),
    CURRENT_MONTH("الشهر الحالي"),
    PREVIOUS_MONTH("الشهر الماضي"),
    CUSTOM("مدة معينة")
}

data class MobileDateBounds(val start: LocalDate, val end: LocalDate)

/**
 * UI-only period selection for the native Android app.
 *
 * The server sync always keeps the full authorised order set so Caller ID and the
 * local cache stay complete. The selected period is applied only to lists shown in
 * the app. Changing a period increments [revision], which reuses the existing delta
 * sync instead of adding another polling loop or a new backend endpoint.
 */
object MobileDateFilterState {
    private val cairo = ZoneId.of("Africa/Cairo")
    private val localDateTimeFormats = listOf(
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS"),
        DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss")
    )
    private val localDateFormats = listOf(
        DateTimeFormatter.ISO_LOCAL_DATE,
        DateTimeFormatter.ofPattern("yyyy/MM/dd"),
        DateTimeFormatter.ofPattern("dd/MM/yyyy"),
        DateTimeFormatter.ofPattern("d/M/yyyy"),
        DateTimeFormatter.ofPattern("dd-MM-yyyy"),
        DateTimeFormatter.ofPattern("d-M-yyyy")
    )

    var preset by mutableStateOf(MobileDatePreset.TODAY)
        private set
    var customStart by mutableStateOf<LocalDate?>(null)
        private set
    var customEnd by mutableStateOf<LocalDate?>(null)
        private set
    var revision by mutableIntStateOf(0)
        private set

    val periodLabel: String
        get() = when (preset) {
            MobileDatePreset.CUSTOM -> {
                val start = customStart
                val end = customEnd
                if (start != null && end != null) "${start.format(DateTimeFormatter.ISO_LOCAL_DATE)} — ${end.format(DateTimeFormatter.ISO_LOCAL_DATE)}"
                else MobileDatePreset.CUSTOM.label
            }
            else -> preset.label
        }

    fun select(value: MobileDatePreset) {
        if (value == MobileDatePreset.CUSTOM) return
        if (preset == value) return
        preset = value
        revision++
    }

    fun selectCustom(start: LocalDate, end: LocalDate) {
        val ordered = if (end.isBefore(start)) MobileDateBounds(end, start) else MobileDateBounds(start, end)
        if (preset == MobileDatePreset.CUSTOM && customStart == ordered.start && customEnd == ordered.end) return
        customStart = ordered.start
        customEnd = ordered.end
        preset = MobileDatePreset.CUSTOM
        revision++
    }

    /** Trigger one immediate state refresh without changing the selected date range. */
    fun requestRefresh() {
        revision++
    }

    fun bounds(today: LocalDate = LocalDate.now(cairo)): MobileDateBounds = when (preset) {
        MobileDatePreset.TODAY -> MobileDateBounds(today, today)
        MobileDatePreset.YESTERDAY -> MobileDateBounds(today.minusDays(1), today.minusDays(1))
        MobileDatePreset.CURRENT_WEEK -> {
            val start = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            MobileDateBounds(start, today)
        }
        MobileDatePreset.PREVIOUS_WEEK -> {
            val currentStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            MobileDateBounds(currentStart.minusWeeks(1), currentStart.minusDays(1))
        }
        MobileDatePreset.CURRENT_MONTH -> MobileDateBounds(today.withDayOfMonth(1), today)
        MobileDatePreset.PREVIOUS_MONTH -> {
            val previous = today.minusMonths(1)
            MobileDateBounds(previous.withDayOfMonth(1), previous.withDayOfMonth(previous.lengthOfMonth()))
        }
        MobileDatePreset.CUSTOM -> {
            val start = customStart ?: today
            val end = customEnd ?: start
            if (end.isBefore(start)) MobileDateBounds(end, start) else MobileDateBounds(start, end)
        }
    }

    fun parseDate(value: String): LocalDate? {
        val raw = value.trim()
        if (raw.isBlank()) return null

        runCatching { Instant.parse(raw).atZone(cairo).toLocalDate() }.getOrNull()?.let { return it }
        runCatching { OffsetDateTime.parse(raw).atZoneSameInstant(cairo).toLocalDate() }.getOrNull()?.let { return it }

        localDateTimeFormats.forEach { formatter ->
            runCatching { LocalDateTime.parse(raw, formatter).atZone(cairo).toLocalDate() }.getOrNull()?.let { return it }
        }
        localDateFormats.forEach { formatter ->
            runCatching { LocalDate.parse(raw.take(10), formatter) }.getOrNull()?.let { return it }
            runCatching { LocalDate.parse(raw, formatter) }.getOrNull()?.let { return it }
        }

        if (raw.all { it.isDigit() }) {
            raw.toLongOrNull()?.let { epoch ->
                val millis = if (raw.length <= 10) epoch * 1000L else epoch
                runCatching { Instant.ofEpochMilli(millis).atZone(cairo).toLocalDate() }.getOrNull()?.let { return it }
            }
        }
        return null
    }

    fun matches(value: String, fallback: String = ""): Boolean {
        val date = parseDate(value) ?: parseDate(fallback) ?: return false
        val range = bounds()
        return !date.isBefore(range.start) && !date.isAfter(range.end)
    }

    fun filterOrders(orders: List<OrderUi>): List<OrderUi> = orders.filter { matches(it.date) }

    fun filterCustomerServiceOrders(orders: List<CsOrderUi>): List<CsOrderUi> =
        orders.filter { matches(it.date, it.createdAt) }
}

@Composable
fun MobileDateFilterBar(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val selected = MobileDateFilterState.preset
    val start = MobileDateFilterState.customStart
    val end = MobileDateFilterState.customEnd

    Surface(modifier = modifier.fillMaxWidth(), color = KunColors.Surface, tonalElevation = 1.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 10.dp, vertical = 5.dp)
        ) {
            MobileDatePreset.entries.forEach { item ->
                val customLabel = if (item == MobileDatePreset.CUSTOM && start != null && end != null) {
                    "مدة معينة ${start.dayOfMonth}/${start.monthValue}–${end.dayOfMonth}/${end.monthValue}"
                } else item.label
                FilterChip(
                    selected = selected == item,
                    onClick = {
                        if (item == MobileDatePreset.CUSTOM) {
                            showCustomRangePicker(context, start, end) { from, to ->
                                MobileDateFilterState.selectCustom(from, to)
                            }
                        } else {
                            MobileDateFilterState.select(item)
                        }
                    },
                    label = { Text(customLabel) },
                    modifier = Modifier.padding(horizontal = 3.dp),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = KunColors.PineSoft,
                        selectedLabelColor = KunColors.Pine
                    )
                )
            }
        }
    }
}

private fun showCustomRangePicker(
    context: Context,
    currentStart: LocalDate?,
    currentEnd: LocalDate?,
    onSelected: (LocalDate, LocalDate) -> Unit
) {
    val today = LocalDate.now(ZoneId.of("Africa/Cairo"))
    val startInitial = currentStart ?: today
    DatePickerDialog(
        context,
        { _, year, month, day ->
            val start = LocalDate.of(year, month + 1, day)
            val endInitial = currentEnd?.takeUnless { it.isBefore(start) } ?: start
            DatePickerDialog(
                context,
                { _, endYear, endMonth, endDay ->
                    onSelected(start, LocalDate.of(endYear, endMonth + 1, endDay))
                },
                endInitial.year,
                endInitial.monthValue - 1,
                endInitial.dayOfMonth
            ).show()
        },
        startInitial.year,
        startInitial.monthValue - 1,
        startInitial.dayOfMonth
    ).show()
}
