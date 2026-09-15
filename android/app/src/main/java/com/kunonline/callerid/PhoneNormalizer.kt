package com.kunonline.callerid

object PhoneNormalizer {
    fun normalize(raw: String?): String {
        var d = raw.orEmpty().filter(Char::isDigit)
        d = when {
            d.startsWith("0020") -> "0" + d.drop(4)
            d.startsWith("20") && d.length == 12 -> "0" + d.drop(2)
            d.startsWith("00966") -> "0" + d.drop(5)
            d.startsWith("966") && d.length == 12 -> "0" + d.drop(3)
            else -> d
        }
        return when {
            Regex("^01[0-9]{9}$").matches(d) -> d
            Regex("^05[0-9]{8}$").matches(d) -> d
            else -> ""
        }
    }
}
