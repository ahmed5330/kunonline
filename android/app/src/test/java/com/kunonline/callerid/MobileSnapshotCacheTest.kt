package com.kunonline.callerid

import org.junit.Assert.*
import org.junit.Test

class MobileSnapshotCacheTest {
    @Test fun scopesNeverMixAccountsOrStores() {
        val first = MobileSnapshotCache.scopeKey("ko_session=synthetic-a", """{"clientId":"c1","storeId":"s1"}""")
        val otherAccount = MobileSnapshotCache.scopeKey("ko_session=synthetic-b", """{"clientId":"c1","storeId":"s1"}""")
        val otherStore = MobileSnapshotCache.scopeKey("ko_session=synthetic-a", """{"clientId":"c1","storeId":"s2"}""")
        assertEquals(64, first.length)
        assertNotEquals(first, otherAccount)
        assertNotEquals(first, otherStore)
        assertFalse(first.contains("synthetic-a"))
        assertEquals(first, MobileSnapshotCache.scopeKey("ko_session=synthetic-a", """{"clientId":"c1","storeId":"s1"}"""))
    }

    @Test fun selectedStoreAndSessionMustBothBePartOfScopeKey() {
        assertNotEquals(
            MobileSnapshotCache.scopeKey("ab", "c"),
            MobileSnapshotCache.scopeKey("a", "bc")
        )
    }
}
