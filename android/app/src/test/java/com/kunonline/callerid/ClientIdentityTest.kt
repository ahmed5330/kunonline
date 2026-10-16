package com.kunonline.callerid

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ClientIdentityTest {
    @Test fun multiTenantStaffHasNoFixedClientId() {
        val me = JSONObject("""{"role":"ops","uid":"staff-a","clientId":null}""")
        assertEquals("", KunApi.clientIdFromIdentity(me))
    }

    @Test fun stringifiedNullCannotFilterAuthorizedStores() {
        val me = JSONObject("""{"role":"support","uid":"staff-b","client_id":"null"}""")
        assertEquals("", KunApi.clientIdFromIdentity(me))
    }

    @Test fun actualTenantOwnersKeepTheirFixedClient() {
        val me = JSONObject("""{"role":"client","clientId":"tenant-a"}""")
        assertEquals("tenant-a", KunApi.clientIdFromIdentity(me))
    }

    @Test fun authorizedClientEntriesUseIdField() {
        val first = JSONObject("""{"id":"tenant-waqoura","name":"Store A"}""")
        val second = JSONObject("""{"id":"tenant-wefaq","name":"Store B"}""")
        assertEquals("tenant-waqoura", KunApi.clientIdFromIdentity(first))
        assertEquals("tenant-wefaq", KunApi.clientIdFromIdentity(second))
    }

    @Test fun snakeCaseClientIdentifierWorks() {
        assertEquals("tenant-c", KunApi.clientIdFromIdentity(JSONObject("""{"client_id":"tenant-c"}""")))
    }

    @Test fun missingOrNullIdentifiersNeverBecomeLiteralNull() {
        assertEquals("", KunApi.clientIdFromIdentity(JSONObject()))
        assertEquals("", KunApi.clientIdFromIdentity(JSONObject("""{"clientId":null,"client_id":null}""")))
    }
}
