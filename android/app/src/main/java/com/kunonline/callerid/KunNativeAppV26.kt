package com.kunonline.callerid

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * Kun Online Android v2.6 shell.
 * Keeps the proven v2.5 experience and adds a native manual-order action backed by
 * the authoritative J&T Egypt province/city/area directory.
 */
@Composable
fun KunNativeAppV26(activity: MainActivity) {
    val context = LocalContext.current
    var hasSession by remember { mutableStateOf(KunApi.hasSession(context)) }
    var showAddOrder by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (isActive) {
            hasSession = KunApi.hasSession(context)
            if (!hasSession) showAddOrder = false
            delay(800)
        }
    }

    MaterialTheme {
        Box {
            KunNativeAppV25(activity)

            if (hasSession) {
                ExtendedFloatingActionButton(
                    onClick = { showAddOrder = true },
                    icon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                    text = { Text("إضافة أوردر") },
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 18.dp, bottom = 86.dp)
                        .zIndex(20f)
                )
            }

            if (showAddOrder) {
                JntAddOrderDialog(
                    onDismiss = { showAddOrder = false },
                    onCreated = { showAddOrder = false }
                )
            }
        }
    }
}
