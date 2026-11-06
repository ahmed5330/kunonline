package com.kunonline.callerid

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Only shown for verified provider payment evidence, never for COD/confirmation. */
@Composable
internal fun KunPaymentBadge(status: String) {
    val paid = status == "paid"
    if (!paid && status != "refunded") return
    Surface(
        color = if (paid) Color(0xFFE1F6E9) else Color(0xFFFBE7EB),
        contentColor = if (paid) Color(0xFF126E45) else Color(0xFF9F2F41),
        shape = RoundedCornerShape(8.dp)
    ) {
        Text(
            text = if (paid) "✓ مدفوع بالكامل" else "↩ تم رد المبلغ",
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            fontWeight = FontWeight.Bold
        )
    }
}
