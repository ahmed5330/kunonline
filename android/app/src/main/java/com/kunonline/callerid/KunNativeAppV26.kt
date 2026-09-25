package com.kunonline.callerid

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
 * Keeps the proven v2.5 experience and adds native J&T order creation and team chat.
 * Printing stays in the main Kun Online system, not in the Android app.
 */
@Composable
fun KunNativeAppV26(activity: MainActivity) {
    val context = LocalContext.current
    var hasSession by remember { mutableStateOf(KunApi.hasSession(context)) }
    var showAddOrder by remember { mutableStateOf(false) }
    var showCollaboration by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (isActive) {
            hasSession = KunApi.hasSession(context)
            if (!hasSession) {
                showAddOrder = false
                showCollaboration = false
            }
            delay(800)
        }
    }

    MaterialTheme {
        Box {
            KunNativeAppV25(activity)

            if (hasSession && !showAddOrder && !showCollaboration) {
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 12.dp, bottom = 86.dp)
                        .zIndex(20f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilledTonalButton(
                        onClick = { showAddOrder = true },
                        modifier = Modifier.height(46.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 13.dp, vertical = 0.dp)
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Text("إضافة أوردر")
                    }
                    OutlinedButton(
                        onClick = { showCollaboration = true },
                        modifier = Modifier.height(46.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 0.dp)
                    ) {
                        Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null)
                        Text("التواصل")
                    }
                }
            }

            if (showAddOrder) {
                JntAddOrderDialog(
                    onDismiss = { showAddOrder = false },
                    onCreated = {
                        showAddOrder = false
                        MobileDateFilterState.requestRefresh()
                        Toast.makeText(context, "تم إنشاء الأوردر وجاري مزامنته الآن", Toast.LENGTH_SHORT).show()
                    }
                )
            }

            if (showCollaboration) {
                MobileCollaborationDialog(onDismiss = { showCollaboration = false })
            }
        }
    }
}
