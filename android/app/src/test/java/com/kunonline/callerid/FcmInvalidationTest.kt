package com.kunonline.callerid

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FcmInvalidationTest {
    @Test fun onlyValidNonPiiChangeHintsScheduleAuthorizedSync() {
        assertTrue(isValidOrderInvalidation(mapOf(
            "kind" to "orders_changed", "clientId" to "client-a",
            "storeId" to "store-a", "seq" to "28"
        )))
        assertFalse(isValidOrderInvalidation(mapOf(
            "kind" to "orders_changed", "clientId" to "client-a",
            "storeId" to "store-a", "seq" to "0"
        )))
        assertFalse(isValidOrderInvalidation(mapOf(
            "kind" to "orders_changed", "clientId" to "client-a",
            "storeId" to "store-a", "seq" to "garbage"
        )))
        assertFalse(isValidOrderInvalidation(mapOf(
            "kind" to "arbitrary", "clientId" to "client-a",
            "storeId" to "store-a", "seq" to "28"
        )))
        assertFalse(isValidOrderInvalidation(mapOf(
            "kind" to "orders_changed", "clientId" to "client-a", "seq" to "28"
        )))
    }
}
