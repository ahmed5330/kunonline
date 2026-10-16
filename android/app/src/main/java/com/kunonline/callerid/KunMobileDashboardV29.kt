package com.kunonline.callerid

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/** Real seven-day order activity from the authorised server payload, not sample metrics. */
@Composable
fun KunSevenDayOrdersTrend(root: JSONObject) {
    val today = LocalDate.now(ZoneId.of("Africa/Cairo"))
    val dates = (6 downTo 0).map { today.minusDays(it.toLong()) }
    val input = root.optJSONArray("orders")
    val counts = dates.map { day ->
        var count = 0
        if (input != null) for (index in 0 until input.length()) {
            val order = input.optJSONObject(index) ?: continue
            val rawDate = order.optString("date").ifBlank {
                order.optString("createdAt").ifBlank { order.optString("created_at") }
            }
            if (MobileDateFilterState.parseDate(rawDate) == day) count++
        }
        count
    }

    KunSectionCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("حركة الطلبات", style = MaterialTheme.typography.titleMedium)
            Text("آخر 7 أيام", color = KunColors.Ink2, style = MaterialTheme.typography.labelMedium)
        }
        if (counts.all { it == 0 }) {
            Text("لا توجد طلبات مؤرخة خلال آخر 7 أيام", color = KunColors.Ink2, style = MaterialTheme.typography.bodyMedium)
        } else {
            val max = counts.maxOrNull()?.coerceAtLeast(1)?.toFloat() ?: 1f
            Canvas(Modifier.fillMaxWidth().height(128.dp).padding(vertical = 9.dp, horizontal = 7.dp)) {
                (1..3).forEach { tick ->
                    val y = size.height * tick / 4f
                    drawLine(KunColors.Line, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
                }
                val path = Path()
                counts.forEachIndexed { index, count ->
                    val x = size.width * index / 6f
                    val y = size.height - (count / max) * (size.height * .85f) - (size.height * .07f)
                    if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(path, KunColors.Chrome, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                counts.forEachIndexed { index, count ->
                    drawCircle(KunColors.Pine, radius = 3.4.dp.toPx(),
                        center = Offset(size.width * index / 6f, size.height - (count / max) * (size.height * .85f) - (size.height * .07f)))
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("منذ 6 أيام", color = KunColors.Ink3, style = MaterialTheme.typography.labelSmall)
                Text("${counts.sum()} طلب خلال الأسبوع", color = KunColors.Chrome, style = MaterialTheme.typography.labelSmall)
                Text("اليوم", color = KunColors.Ink3, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
