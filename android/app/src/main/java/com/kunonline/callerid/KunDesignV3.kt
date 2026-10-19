package com.kunonline.callerid

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalTime

/**
 * Android-native translation of Kun Online's reviewed 36-screen UX prototype.
 * This layer is presentation-only. Existing orders, permissions, J&T, chat,
 * call handling and store-specific APIs remain authoritative and unchanged.
 */
object KunV3 {
    val Navy = Color(0xFF123A62)
    val Blue = Color(0xFF15599B)
    val DeepBlue = Color(0xFF104471)
    val Sky = Color(0xFFEAF4FF)
    val Background = Color(0xFFF3F7FB)
    val Success = Color(0xFF16A773)
    val SuccessSoft = Color(0xFFE8F8F1)
    val Warning = Color(0xFFE9A21F)
    val WarningSoft = Color(0xFFFFF4DA)
    val Danger = Color(0xFFDD5364)
    val DangerSoft = Color(0xFFFFEDF0)
    val Border = Color(0xFFE2EAF3)
}

@Composable
fun KunGreetingHero(name: String, period: String, modifier: Modifier = Modifier) {
    val dayGreeting = if (LocalTime.now().hour in 5..11) "صباح الخير" else "مساء الخير"
    val headline = if (name.isBlank()) dayGreeting else "$dayGreeting يا $name"
    Box(
        modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
            .background(Brush.horizontalGradient(listOf(KunV3.Navy, KunV3.Blue)))
    ) {
        // The decoration never participates in hit-testing or overlays the text.
        Box(
            Modifier.align(Alignment.TopStart).offset(x = (-26).dp, y = (-48).dp)
                .size(152.dp).background(Color.White.copy(alpha = .065f), CircleShape)
        )
        Box(
            Modifier.align(Alignment.BottomStart).offset(x = 36.dp, y = 74.dp)
                .size(180.dp).background(Color.White.copy(alpha = .04f), CircleShape)
        )
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 23.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("لوحة الموظف • خدمة العملاء", color = Color.White.copy(alpha = .75f),
                style = MaterialTheme.typography.labelMedium)
            Text("$headline 👋", color = Color.White,
                fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall)
            Text("أهلاً بك في كن أونلاين • $period", color = Color.White.copy(alpha = .83f),
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun KunRaisedHomeIcon(active: Boolean) {
    Surface(
        modifier = Modifier.size(46.dp),
        shape = RoundedCornerShape(14.dp),
        color = if (active) KunV3.Blue else KunV3.Navy,
        shadowElevation = if (active) 6.dp else 3.dp
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Storefront, contentDescription = "الرئيسية",
                modifier = Modifier.size(25.dp), tint = Color.White)
        }
    }
}

@Composable
fun KunSectionListCard(
    title: String,
    detail: String,
    glyph: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = 68.dp),
        shape = RoundedCornerShape(17.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = RoundedCornerShape(13.dp), color = KunV3.Sky) {
                Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                    Icon(glyph, contentDescription = null, tint = KunV3.Blue)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, fontWeight = FontWeight.Bold, color = KunColors.Ink)
                Text(detail, color = KunColors.Ink2,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall)
            }
            Icon(Icons.Outlined.ChevronLeft, contentDescription = null,
                tint = KunColors.Ink3, modifier = Modifier.size(20.dp))
        }
    }
}

fun kunSectionGlyph(name: String): ImageVector = when (name) {
    "PRINTING" -> Icons.Outlined.Print
    "FINANCE" -> Icons.Outlined.AccountBalanceWallet
    "ACCOUNTING" -> Icons.Outlined.AccountBalance
    "CAMPAIGNS" -> Icons.Outlined.Campaign
    "INVENTORY" -> Icons.Outlined.Inventory2
    "RETURNS" -> Icons.Outlined.AssignmentReturn
    "WALLET" -> Icons.Outlined.Wallet
    "INTEGRATIONS" -> Icons.Outlined.Hub
    "SETTINGS" -> Icons.Outlined.Settings
    else -> Icons.Outlined.GridView
}

@Composable
fun KunAsyncPanel(
    label: String,
    modifier: Modifier = Modifier,
    retry: (() -> Unit)? = null,
    isError: Boolean = false
) {
    Column(modifier.fillMaxWidth().padding(22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(13.dp)) {
        if (isError) {
            Icon(Icons.Outlined.CloudOff, contentDescription = null,
                modifier = Modifier.size(39.dp), tint = KunV3.Danger)
        } else CircularProgressIndicator(color = KunV3.Blue)
        Text(label, color = if (isError) KunV3.Danger else KunColors.Ink2,
            style = MaterialTheme.typography.bodyMedium)
        if (retry != null) OutlinedButton(onClick = retry) {
            Icon(Icons.Outlined.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("إعادة المحاولة")
        }
    }
}

@Composable
fun KunStatusSurface(tone: Color, content: @Composable () -> Unit) {
    Surface(color = tone.copy(alpha = .075f),
        shape = RoundedCornerShape(17.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, tone.copy(alpha = .18f))) { content() }
}
