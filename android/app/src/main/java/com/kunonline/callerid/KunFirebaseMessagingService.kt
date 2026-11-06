package com.kunonline.callerid

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** An FCM message carries invalidation metadata only, never any order/PII. */
class KunFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        MobilePushRegistration.onTokenRotated(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        if (!isValidOrderInvalidation(message.data) || !KunApi.hasSession(this)) return
        // Do not trust the client/store IDs in a push message as authorization.
        // The existing job always pulls data under the current signed session,
        // and the server rechecks store access on each request.
        SyncJobService.scheduleImmediate(this)
    }
}

internal fun isValidOrderInvalidation(data: Map<String, String>): Boolean {
    if (data["kind"] != "orders_changed") return false
    if (data["clientId"].isNullOrBlank() || data["storeId"].isNullOrBlank()) return false
    val seq = data["seq"]?.toLongOrNull() ?: return false
    return seq > 0L
}
