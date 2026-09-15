package com.kunonline.callerid

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneNormalizerTest {
    @Test fun egyptFormatsMatch() {
        assertEquals("01012345678", PhoneNormalizer.normalize("+20 10 1234 5678"))
        assertEquals("01012345678", PhoneNormalizer.normalize("00201012345678"))
        assertEquals("01012345678", PhoneNormalizer.normalize("01012345678"))
    }

    @Test fun saudiFormatsMatch() {
        assertEquals("0512345678", PhoneNormalizer.normalize("+966 51 234 5678"))
        assertEquals("0512345678", PhoneNormalizer.normalize("00966512345678"))
    }

    @Test fun invalidNumbersAreRejected() {
        assertEquals("", PhoneNormalizer.normalize("12345"))
        assertEquals("", PhoneNormalizer.normalize(null))
    }
}
