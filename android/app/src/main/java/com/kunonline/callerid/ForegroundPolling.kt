package com.kunonline.callerid

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** Poll immediately on resume and stop scheduling calls as soon as UI pauses. */
@Composable
fun ForegroundPolling(key: Any?, enabled: Boolean = true, intervalMillis: Long, poll: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val latestPoll = rememberUpdatedState(poll)
    LaunchedEffect(lifecycle, key, enabled, intervalMillis) {
        if (!enabled) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                latestPoll.value()
                delay(intervalMillis)
            }
        }
    }
}
