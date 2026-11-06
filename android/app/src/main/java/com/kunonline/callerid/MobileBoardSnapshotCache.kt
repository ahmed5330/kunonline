package com.kunonline.callerid

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Encrypted, session + tenant + selected-store + board-filter scoped snapshot.
 * This is READ-ONLY offline data, never an authorization source for mutations.
 * Each live refresh still passes the server's store ACL and session checks.
 */
object MobileBoardSnapshotCache {
    private const val DATABASE = "kun_mobile_customer_service_cache.db"
    private const val TABLE = "board_snapshots"
    private const val MAX_AGE_MS = 24L * 60 * 60 * 1000

    internal fun scopeKey(session: String, clientId: String, storeId: String, state: String): String {
        val input = listOf("v1", session, clientId, storeId, state).joinToString("\u0000")
        return MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private class Storage(context: Context) :
        SQLiteOpenHelper(context.applicationContext, DATABASE, null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE $TABLE (scope_key TEXT PRIMARY KEY NOT NULL, encrypted_json TEXT NOT NULL, saved_at_ms INTEGER NOT NULL)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    fun load(context: Context, session: String, clientId: String, storeId: String, state: String): JSONObject? {
        if (session.isBlank() || clientId.isBlank()) return null
        return runCatching {
            val item = Storage(context).use { db ->
                db.readableDatabase.query(TABLE, arrayOf("encrypted_json", "saved_at_ms"),
                    "scope_key=?", arrayOf(scopeKey(session, clientId, storeId, state)),
                    null, null, null, "1").use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) to cursor.getLong(1) else null
                }
            } ?: return@runCatching null
            val age = System.currentTimeMillis() - item.second
            if (age < 0 || age > MAX_AGE_MS) return@runCatching null
            val decoded = SecureStore.decrypt(item.first) ?: return@runCatching null
            JSONObject(decoded).takeIf { it.optJSONArray("orders") != null }
        }.getOrNull()
    }

    fun save(context: Context, session: String, clientId: String, storeId: String, state: String, data: JSONObject): Boolean {
        if (session.isBlank() || clientId.isBlank() || data.optJSONArray("orders") == null) return false
        return runCatching {
            val encrypted = SecureStore.encrypt(data.toString())
            val key = scopeKey(session, clientId, storeId, state)
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
                    // Revoke access to snapshots from previously selected stores.
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
        runCatching { Storage(context).use { it.writableDatabase.delete(TABLE, null, null) } }
    }
}
