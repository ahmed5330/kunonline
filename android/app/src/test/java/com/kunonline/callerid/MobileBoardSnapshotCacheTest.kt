package com.kunonline.callerid

import org.junit.Assert.*
import org.junit.Test

class MobileBoardSnapshotCacheTest {
    @Test fun boardKeysAreSessionTenantStoreAndFilterScoped() {
        val a = MobileBoardSnapshotCache.scopeKey("synthetic-session-1", "client-1", "store-1", "pending")
        assertEquals(64, a.length)
        assertNotEquals(a, MobileBoardSnapshotCache.scopeKey("synthetic-session-2", "client-1", "store-1", "pending"))
        assertNotEquals(a, MobileBoardSnapshotCache.scopeKey("synthetic-session-1", "client-2", "store-1", "pending"))
        assertNotEquals(a, MobileBoardSnapshotCache.scopeKey("synthetic-session-1", "client-1", "store-2", "pending"))
        assertNotEquals(a, MobileBoardSnapshotCache.scopeKey("synthetic-session-1", "client-1", "store-1", "confirmed"))
        assertFalse(a.contains("synthetic-session-1"))
    }

    @Test fun concatenationsCannotCollideAcrossParts() {
        assertNotEquals(
            MobileBoardSnapshotCache.scopeKey("ab", "c", "d", "pending"),
            MobileBoardSnapshotCache.scopeKey("a", "bc", "d", "pending")
        )
    }
}
