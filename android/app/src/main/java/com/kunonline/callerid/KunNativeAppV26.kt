package com.kunonline.callerid

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.FilledTonalButton
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
 * Kun Online Android v2.8.3 shell.
 * Keeps the fast native daily workflow and exposes the selected client modules as native Android screens.
 * Native Printing still calls the governed Kun Online/J&T server workflow for Create Order and official labels.
 */
@Composable
fun KunNativeAppV26(activity: MainActivity) {
    val context = LocalContext.current
    var hasSession by remember { mutableStateOf(KunApi.hasSession(context)) }
    var showAddOrder by remember { mutableStateOf(false) }
    var showCollaboration by remember { mutableStateOf(false) }
    var showSystemSections by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (isActive) {
            hasSession = KunApi.hasSession(context)
            if (!hasSession) {
                showAddOrder = false
                showCollaboration = false
                showSystemSections = false
            }
            delay(800)
        }
    }

    MaterialTheme {
        Box {
            KunNativeAppV25(
                activity = activity,
                onOpenCollaboration = { showCollaboration = true },
                onOpenSystemSections = { showSystemSections = true }
            )

            if (hasSession && !showAddOrder && !showCollaboration && !showSystemSections) {
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 12.dp, bottom = 86.dp)
                        .zIndex(20f),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    FilledTonalButton(
                        onClick = { showAddOrder = true },
                        modifier = Modifier.height(46.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 0.dp)
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Text("إضافة")
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

            if (showSystemSections) {
                MobileSystemSectionsDialog(onDismiss = { showSystemSections = false })
            }
        }
    }
}
