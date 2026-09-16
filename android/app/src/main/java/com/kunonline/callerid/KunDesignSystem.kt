package com.kunonline.callerid

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object KunColors {
    val Ink = Color(0xFF12212B)
    val Ink2 = Color(0xFF3D5563)
    val Ink3 = Color(0xFF7C929E)
    val Ground = Color(0xFFE9EFEC)
    val Surface = Color(0xFFFFFFFF)
    val Surface2 = Color(0xFFF5F8F7)
    val Line = Color(0xFFD3DEDA)
    val Pine = Color(0xFF3F8F2B)
    val PineSoft = Color(0xFFE8F7E1)
    val PineLine = Color(0xFFC3E8B0)
    val Gold = Color(0xFFC08A00)
    val GoldSoft = Color(0xFFFBF0D6)
    val Brick = Color(0xFFA8321D)
    val BrickSoft = Color(0xFFFAE6E1)
    val Chrome = Color(0xFF0E5095)
    val ChromeSoft = Color(0xFFE8F0F8)
}

val KunRadius = RoundedCornerShape(14.dp)
val KunRadiusLarge = RoundedCornerShape(20.dp)

private val KunLightColors = lightColorScheme(
    primary = KunColors.Pine,
    onPrimary = Color.White,
    primaryContainer = KunColors.PineSoft,
    onPrimaryContainer = KunColors.Ink,
    secondary = KunColors.Chrome,
    onSecondary = Color.White,
    secondaryContainer = KunColors.ChromeSoft,
    onSecondaryContainer = KunColors.Ink,
    tertiary = KunColors.Gold,
    onTertiary = Color.White,
    tertiaryContainer = KunColors.GoldSoft,
    onTertiaryContainer = KunColors.Ink,
    error = KunColors.Brick,
    onError = Color.White,
    errorContainer = KunColors.BrickSoft,
    onErrorContainer = KunColors.Brick,
    background = KunColors.Ground,
    onBackground = KunColors.Ink,
    surface = KunColors.Surface,
    onSurface = KunColors.Ink,
    surfaceVariant = KunColors.Surface2,
    onSurfaceVariant = KunColors.Ink2,
    outline = KunColors.Line
)

private val KunTypography = Typography(
    headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 36.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 32.sp),
    headlineSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 21.sp, lineHeight = 28.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 24.sp),
    titleSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 21.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 18.sp)
)

@Composable
fun KunTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = KunLightColors,
        typography = KunTypography,
        shapes = MaterialTheme.shapes.copy(
            extraSmall = RoundedCornerShape(8.dp),
            small = RoundedCornerShape(10.dp),
            medium = KunRadius,
            large = KunRadiusLarge,
            extraLarge = RoundedCornerShape(24.dp)
        ),
        content = content
    )
}

@Composable
fun KunBrandMark(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.size(34.dp).background(Color.White, CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text("كُن", color = KunColors.Pine, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
    }
}

@Composable
fun KunPageIntro(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, color = KunColors.Ink)
        subtitle?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = KunColors.Ink2)
        }
    }
}

@Composable
fun KunInfoCard(
    title: String,
    value: String,
    modifier: Modifier = Modifier,
    tone: Color = KunColors.Pine
) {
    Card(
        modifier = modifier,
        shape = KunRadius,
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, style = MaterialTheme.typography.labelMedium, color = KunColors.Ink2)
            Text(value, style = MaterialTheme.typography.titleLarge, color = KunColors.Ink)
            Spacer(Modifier.height(1.dp))
            Box(Modifier.size(width = 34.dp, height = 3.dp).background(tone, CircleShape))
        }
    }
}

@Composable
fun KunSectionCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Card(
        modifier = modifier,
        shape = KunRadius,
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
    }
}

@Composable
fun KunStatusDot(ok: Boolean, label: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(10.dp).background(if (ok) KunColors.Pine else KunColors.Gold, CircleShape))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = KunColors.Ink2)
    }
}
