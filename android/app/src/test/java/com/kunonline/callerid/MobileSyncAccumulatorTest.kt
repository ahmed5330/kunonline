package com.kunonline.callerid

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MobileSyncAccumulatorTest {
    private fun reset() = JSONObject("""{"protocol":1,"mode":"reset","cursor":"one","state":{"orders":[{"id":"a","state":"pending"},{"id":"b"}],"products":[{"id":"p"}],"oldField":true}}""")

    @Test fun appliesUpdatesDeletionsAndServerOrdering() {
        val sync = MobileSyncAccumulator()
        assertTrue(sync.accept(reset()))
        assertTrue(sync.accept(JSONObject("""{"protocol":1,"mode":"delta","cursor":"two","orders":{"upsert":[{"id":"c"},{"id":"a","state":"shipped"}],"removed":["b"],"ids":["c","a"]},"fields":{"products":[]},"removedFields":["oldField"]}""")))
        val state = requireNotNull(sync.state)
        assertEquals("c", state.getJSONArray("orders").getJSONObject(0).getString("id"))
        assertEquals("shipped", state.getJSONArray("orders").getJSONObject(1).getString("state"))
        assertEquals(0, state.getJSONArray("products").length())
        assertFalse(state.has("oldField"))
        assertFalse(sync.accept(JSONObject("""{"protocol":1,"mode":"unchanged","cursor":"two"}""")))
    }

    @Test fun invalidDeltaDoesNotCommitCursorOrPartialState() {
        val sync = MobileSyncAccumulator()
        sync.accept(reset())
        val before = sync.state.toString()
        try {
            sync.accept(JSONObject("""{"protocol":1,"mode":"delta","cursor":"bad","orders":{"upsert":[],"removed":["a"],"ids":["missing"]},"fields":{},"removedFields":[]}"""))
            fail("Missing baseline row must reject delta")
        } catch (_: IllegalArgumentException) { }
        assertEquals("one",sync.cursor)
        assertEquals(before,sync.state.toString())
    }

    @Test fun resetReplacesAllDataAfterServerRestart() {
        val sync = MobileSyncAccumulator()
        sync.accept(reset())
        sync.accept(JSONObject("""{"protocol":1,"mode":"reset","cursor":"new","state":{"orders":[]}}"""))
        assertEquals(0, requireNotNull(sync.state).getJSONArray("orders").length())
        assertFalse(requireNotNull(sync.state).has("products"))
    }
}
