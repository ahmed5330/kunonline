package com.kunonline.callerid

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MobileSyncAuthFallbackTest {
    private val source = "/api/state?clientId=synthetic&storeId=one"
    private fun reset(cursor: String = "base") = MobileSyncResponse(200, JSONObject("""{"protocol":1,"mode":"reset","cursor":"$cursor","state":{"orders":[{"id":"synthetic-order"}]}}"""))
    private fun denied(code: Int) = MobileSyncResponse(code, JSONObject().put("error", "synthetic auth failure"))
    private fun corrupt() = MobileSyncResponse(200, JSONObject("""{"protocol":1,"mode":"delta","cursor":"bad","orders":{"upsert":[],"removed":[],"ids":["missing"]},"fields":{},"removedFields":[]}"""))

    @Test fun authoritativeAuthFailureOverridesDeltaServerErrorAndClearsBaseline() {
        for (code in listOf(401, 403)) {
            val paths = mutableListOf<String>()
            val replies = mutableListOf(reset(), denied(500), denied(code), reset("fresh"))
            val sync = MobileSyncSession(elapsedTime = { 0L }, network = { _, path -> paths.add(path); replies.removeAt(0) })
            assertEquals(200, sync.fetch("synthetic-cookie", source).code)
            assertEquals(code, sync.fetch("synthetic-cookie", source).code)
            assertEquals(source, paths.last())
            assertEquals(200, sync.fetch("synthetic-cookie", source).code)
            assertFalse("Denied session must discard its previous cursor", paths.last().contains("cursor="))
        }
    }

    @Test fun corruptDeltaStopsImmediatelyWhenResetIsUnauthorized() {
        for (code in listOf(401, 403)) {
            val paths = mutableListOf<String>()
            val replies = mutableListOf(reset(), corrupt(), denied(code), denied(code))
            val sync = MobileSyncSession(elapsedTime = { 0L }, network = { _, path -> paths.add(path); replies.removeAt(0) })
            sync.fetch("synthetic-cookie", source)
            assertEquals(code, sync.fetch("synthetic-cookie", source).code)
            assertEquals("Auth denial must not trigger another network fallback", 3, paths.size)
        }
    }

    @Test fun successfulAuthoritativeFallbackRetainsLegacyCooldown() {
        val paths = mutableListOf<String>()
        val authoritative = MobileSyncResponse(200, JSONObject("""{"orders":[]}"""))
        val replies = mutableListOf(reset(), denied(500), authoritative, authoritative)
        val sync = MobileSyncSession(elapsedTime = { 0L }, network = { _, path -> paths.add(path); replies.removeAt(0) })
        sync.fetch("synthetic-cookie", source)
        assertEquals(200, sync.fetch("synthetic-cookie", source).code)
        assertEquals(200, sync.fetch("synthetic-cookie", source).code)
        assertEquals(source, paths.last())
    }
}
