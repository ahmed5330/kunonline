package com.kunonline.callerid

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Encrypted, account-and-selected-store-scoped on-device snapshot.
 *
 * This is an offline read cache, NOT an authorization source or an offline
 * mutation queue. Every online refresh still goes through server ACL checks.
 * Cursor/delta transport stays independent from this durable copy.
 */
object MobileSnapshotCache {
    private const val DATABASE = "kun_order_snapshots.db"
    private const val TABLE = "snapshots"
    private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

    internal fun scopeKey(session: String, selectedStore: String): String {
        val input = "v1\u0000" + session + "\u0000" + selectedStore
        return MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private class Storage(context: Context) :
        SQLiteOpenHelper(context.applicationContext, DATABASE, null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE $TABLE (scope_key TEXT PRIMARY KEY NOT NULL, " +
                    "encrypted_json TEXT NOT NULL, saved_at_ms INTEGER NOT NULL)"
            )
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    fun load(context: Context, session: String, selectedStore: String): JSONObject? {
        if (session.isBlank()) return null
        return runCatching {
            val record = Storage(context).use { helper ->
                helper.readableDatabase.query(
                    TABLE, arrayOf("encrypted_json", "saved_at_ms"),
                    "scope_key=?", arrayOf(scopeKey(session, selectedStore)),
                    null, null, null, "1"
                ).use { cursor ->
                    if (cursor.moveToFirst()) Pair(cursor.getString(0), cursor.getLong(1)) else null
                }
            } ?: return@runCatching null
            val age = System.currentTimeMillis() - record.second
            if (age < 0 || age > MAX_AGE_MS) return@runCatching null
            val raw = SecureStore.decrypt(record.first) ?: return@runCatching null
            JSONObject(raw).takeIf { it.optJSONArray("orders") != null }
        }.getOrNull()
    }

    /** An invalid/corrupt disk write may never break a successful live read. */
    fun save(context: Context, session: String, selectedStore: String, state: JSONObject): Boolean {
        if (session.isBlank() || state.optJSONArray("orders") == null) return false
        return runCatching {
            val encrypted = SecureStore.encrypt(state.toString())
            val key = scopeKey(session, selectedStore)
            Storage(context).use { helper ->
                val db = helper.writableDatabase
                db.beginTransaction()
                try {
                    val values = ContentValues().apply {
                        put("scope_key", key)
                        put("encrypted_json", encrypted)
                        put("saved_at_ms", System.currentTimeMillis())
                    }
                    check(db.insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L)
                    // A previous account or store must never appear during offline startup.
                    db.delete(TABLE, "scope_key<>?", arrayOf(key))
                    db.setTransactionSuccessful()
                } finally {
                    db.endTransaction()
                }
            }
            true
        }.getOrDefault(false)
    }

    fun clear(context: Context) {
        runCatching {
            Storage(context).use { helper -> helper.writableDatabase.delete(TABLE, null, null) }
        }
    }
}
