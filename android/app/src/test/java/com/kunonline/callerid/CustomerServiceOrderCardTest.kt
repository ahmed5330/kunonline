package com.kunonline.callerid

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class CustomerServiceOrderCardTest {
    @Test fun displaysWaqouraModelAndColorTogether() {
        assertEquals("جيبة بليسيه — اللون: برجاندي غامق",
            v23ProductCardSummary("جيبة بليسيه", "اللون: برجاندي غامق"))
        assertEquals("جيبة دابل كلوش — اللون: أسود، الطول: 3 متر",
            v23ProductCardSummary("جيبة دابل كلوش", "اللون: أسود، الطول: 3 متر"))
    }

    @Test fun avoidsRepeatingSavedOptionsWhenProductNameAlreadyIncludesThem() {
        assertEquals("جيبة بليسيه اللون أسود",
            v23ProductCardSummary("جيبة بليسيه اللون أسود", "اللون أسود"))
        assertEquals("جيبة", v23ProductCardSummary("جيبة", ""))
    }

    @Test fun showsAllPersistedLinesWithTheirOwnColorsAndQuantities() {
        val items = JSONArray()
            .put(JSONObject().put("name", "جيبة بليسيه").put("variant", "اللون: كحلي").put("qty", 2))
            .put(JSONObject().put("name", "جيبة دابل كلوش").put("variant", "اللون: برجاندي").put("qty", 1))
        assertEquals(listOf(
            "جيبة بليسيه — اللون: كحلي × 2",
            "جيبة دابل كلوش — اللون: برجاندي × 1"
        ), v23ProductLines("جيبة", "", 3, items))
    }

    @Test fun fallsBackToOriginalOrderWhenImportedLineRowsAreMissing() {
        assertEquals(listOf("جيبة بليسيه — اللون: بترولي × 1"),
            v23ProductLines("جيبة بليسيه", "اللون: بترولي", 1, JSONArray()))
    }
}
