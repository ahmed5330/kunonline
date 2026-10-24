package com.kunonline.callerid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VerifiedStoreScopeFastPathTest {
    @Test fun usesUnexpiredVerifiedStoreOfSameSession() {
        val chosen = ScopeInfo("client-a", "store-1")
        assertEquals(chosen, KunApi.reusableVerifiedScope("cookie-a", "cookie-a", 500, 1000, chosen))
    }

    @Test fun neverReusesAnotherSessionOrExpiredAssignment() {
        val selected = ScopeInfo("client-a", "store-1")
        assertNull(KunApi.reusableVerifiedScope("cookie-b", "cookie-a", 500, 1000, selected))
        assertNull(KunApi.reusableVerifiedScope("cookie-a", "cookie-a", 1000, 1000, selected))
    }

    @Test fun refusesMissingClientAndNullAssignment() {
        assertNull(KunApi.reusableVerifiedScope("cookie-a", "cookie-a", 100, 1000, ScopeInfo("", "store-1")))
        assertNull(KunApi.reusableVerifiedScope("cookie-a", "cookie-a", 100, 1000, ScopeInfo("null", "store-1")))
        assertNull(KunApi.reusableVerifiedScope("cookie-a", "cookie-a", 100, 1000, null))
    }

    @Test fun storeSelectionIsNotRewritten() {
        val selected = ScopeInfo("client-z", "store-2")
        assertEquals(selected, KunApi.reusableVerifiedScope("cookie-z", "cookie-z", 10, 200, selected))
    }
}
