package com.kunonline.callerid

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.isActive
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

private const val COLLAB_URL = "https://app.kun-online.com"
private const val COLLAB_POLL_MS = 15_000L

private data class ChatMember(val id: String, val name: String)
private data class ChatConversation(
    val id: String,
    val title: String,
    val preview: String,
    val unread: Int
)
private data class ChatMessage(
    val id: String,
    val senderId: String,
    val senderName: String,
    val body: String,
    val orderId: String
)
private data class ChatBootstrap(
    val meId: String,
    val clientId: String,
    val storeId: String,
    val members: List<ChatMember>,
    val conversations: List<ChatConversation>
)
private data class ChatResult<T>(val ok: Boolean, val value: T? = null, val error: String = "")

private object MobileChatApi {
    private data class HttpResult(val code: Int, val body: JSONObject)
    private data class Scope(val clientId: String, val storeId: String)

    fun bootstrap(context: Context): ChatResult<ChatBootstrap> {
        val cookie = KunApi.sessionCookie(context) ?: return ChatResult(false, error = "سجّل الدخول أولاً")
        return runCatching {
            val scope = resolveScope(cookie) ?: return ChatResult(false, error = "تعذر تحديد المتجر/الفرع")
            val response = request(
                "GET",
                "/api/collaboration/bootstrap?clientId=${enc(scope.clientId)}&storeId=${enc(scope.storeId)}",
                cookie
            )
            if (response.code !in 200..299) {
                return ChatResult(false, error = errorText(response.body).ifBlank { "تعذر تحميل التواصل" })
            }
            val root = response.body
            val meId = root.optJSONObject("me")?.optString("id").orEmpty()
            val members = parseMembers(root.optJSONArray("members"))
            val names = members.associate { it.id to it.name }
            val conversations = parseConversations(root.optJSONArray("conversations"), meId, names)
            ChatResult(
                true,
                ChatBootstrap(
                    meId = meId,
                    clientId = scope.clientId,
                    storeId = scope.storeId,
                    members = members,
                    conversations = conversations
                )
            )
        }.getOrElse { ChatResult(false, error = "تعذر الاتصال بتواصل الفريق") }
    }

    fun messages(context: Context, data: ChatBootstrap, conversationId: String): ChatResult<List<ChatMessage>> {
        val cookie = KunApi.sessionCookie(context) ?: return ChatResult(false, error = "سجّل الدخول أولاً")
        return runCatching {
            val response = request(
                "GET",
                "/api/collaboration/conversations/${enc(conversationId)}/messages?clientId=${enc(data.clientId)}&storeId=${enc(data.storeId)}",
                cookie
            )
            if (response.code !in 200..299) {
                return ChatResult(false, error = errorText(response.body).ifBlank { "تعذر تحميل الرسائل" })
            }
            val array = response.body.optJSONArray("messages") ?: JSONArray()
            val rows = buildList {
                for (i in 0 until array.length()) {
                    val row = array.optJSONObject(i) ?: continue
                    add(
                        ChatMessage(
                            id = row.optString("id"),
                            senderId = row.optString("sender_user_id").ifBlank { row.optString("senderUserId") },
                            senderName = row.optString("sender_name").ifBlank { row.optString("senderName") },
                            body = row.optString("body"),
                            orderId = row.optString("order_id").ifBlank { row.optString("orderId") }
                        )
                    )
                }
            }
            ChatResult(true, rows)
        }.getOrElse { ChatResult(false, error = "تعذر تحميل الرسائل") }
    }

    fun send(context: Context, data: ChatBootstrap, conversationId: String, text: String): ChatResult<Unit> {
        val cookie = KunApi.sessionCookie(context) ?: return ChatResult(false, error = "سجّل الدخول أولاً")
        val clean = text.trim()
        if (clean.isBlank()) return ChatResult(false, error = "اكتب رسالة أولاً")
        return runCatching {
            val payload = JSONObject()
                .put("clientId", data.clientId)
                .put("storeId", data.storeId)
                .put("body", clean)
            val response = request(
                "POST",
                "/api/collaboration/conversations/${enc(conversationId)}/messages",
                cookie,
                payload.toString()
            )
            if (response.code !in 200..299) {
                return ChatResult(false, error = errorText(response.body).ifBlank { "تعذر إرسال الرسالة" })
            }
            ChatResult(true, Unit)
        }.getOrElse { ChatResult(false, error = "تعذر إرسال الرسالة") }
    }

    fun createDirect(context: Context, data: ChatBootstrap, memberId: String): ChatResult<String> {
        val cookie = KunApi.sessionCookie(context) ?: return ChatResult(false, error = "سجّل الدخول أولاً")
        return runCatching {
            val payload = JSONObject()
                .put("clientId", data.clientId)
                .put("storeId", data.storeId)
                .put("type", "direct")
                .put("targetUserId", memberId)
            val response = request("POST", "/api/collaboration/conversations", cookie, payload.toString())
            if (response.code !in 200..299) {
                return ChatResult(false, error = errorText(response.body).ifBlank { "تعذر بدء المحادثة" })
            }
            val id = response.body.optString("id")
            if (id.isBlank()) ChatResult(false, error = "تعذر قراءة المحادثة الجديدة") else ChatResult(true, id)
        }.getOrElse { ChatResult(false, error = "تعذر بدء المحادثة") }
    }

    private fun resolveScope(cookie: String): Scope? {
        val base = KunApi.resolveScope(cookie)
        if (base.clientId.isBlank()) return null
        if (base.storeId.isNotBlank()) return Scope(base.clientId, base.storeId)

        val stores = request("GET", "/api/my-store-context?clientId=${enc(base.clientId)}", cookie)
            .body.optJSONArray("stores") ?: JSONArray()
        for (i in 0 until stores.length()) {
            val row = stores.optJSONObject(i) ?: continue
            val id = row.optString("id").ifBlank { row.optString("storeId") }.trim()
            if (id.isNotBlank()) return Scope(base.clientId, id)
        }

        val state = request("GET", "/api/state?clientId=${enc(base.clientId)}", cookie).body
        val orders = state.optJSONArray("orders") ?: JSONArray()
        for (i in 0 until orders.length()) {
            val row = orders.optJSONObject(i) ?: continue
            val id = row.optString("storeId").ifBlank { row.optString("store_id") }.trim()
            if (id.isNotBlank()) return Scope(base.clientId, id)
        }
        return null
    }

    private fun parseMembers(array: JSONArray?): List<ChatMember> = buildList {
        val rows = array ?: JSONArray()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("id").trim()
            if (id.isBlank()) continue
            add(ChatMember(id, row.optString("name").ifBlank { row.optString("email") }.ifBlank { "عضو الفريق" }))
        }
    }

    private fun parseConversations(array: JSONArray?, meId: String, names: Map<String, String>): List<ChatConversation> = buildList {
        val rows = array ?: JSONArray()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("id").trim()
            if (id.isBlank()) continue
            val memberRows = row.optJSONArray("members") ?: JSONArray()
            val others = buildList {
                for (m in 0 until memberRows.length()) {
                    val member = memberRows.optJSONObject(m) ?: continue
                    val memberId = member.optString("id")
                    if (memberId == meId) continue
                    add(member.optString("name").ifBlank { names[memberId].orEmpty() }.ifBlank { "عضو الفريق" })
                }
            }
            val title = row.optString("name").trim().ifBlank {
                others.joinToString("، ").ifBlank { "محادثة الفريق" }
            }
            val lastSender = row.optString("last_sender").ifBlank { row.optString("lastSender") }
            val lastBody = row.optString("last_body").ifBlank { row.optString("lastBody") }
            val preview = listOf(lastSender, lastBody).filter { it.isNotBlank() }.joinToString(": ")
            add(
                ChatConversation(
                    id = id,
                    title = title,
                    preview = preview,
                    unread = row.optInt("unreadCount", row.optInt("unread_count", 0))
                )
            )
        }
    }

    private fun request(method: String, path: String, cookie: String, body: String? = null): HttpResult {
        val connection = (URL(COLLAB_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 20_000
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-Kun-Mobile", "native-android/2.6.8")
            if (body != null) doOutput = true
        }
        return try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            HttpResult(code, runCatching { JSONObject(text) }.getOrDefault(JSONObject()))
        } finally {
            connection.disconnect()
        }
    }

    private fun errorText(body: JSONObject): String = body.optString("error").ifBlank { body.optString("message") }
    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileCollaborationDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<ChatBootstrap?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var showMembers by remember { mutableStateOf(false) }
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    suspend fun refreshBootstrap(): ChatBootstrap? {
        busy = true
        val result = withContext(Dispatchers.IO) { MobileChatApi.bootstrap(context) }
        busy = false
        if (!result.ok || result.value == null) {
            error = result.error
            return null
        }
        error = ""
        data = result.value
        return result.value
    }

    suspend fun refreshMessages(conversationId: String, current: ChatBootstrap?) {
        val active = current ?: return
        busy = true
        val result = withContext(Dispatchers.IO) { MobileChatApi.messages(context, active, conversationId) }
        busy = false
        if (!result.ok || result.value == null) {
            error = result.error
            return
        }
        error = ""
        messages = result.value
    }

    LaunchedEffect(Unit) {
        refreshBootstrap()
    }

    LaunchedEffect(selectedId) {
        while (isActive) {
            val current = data
            val target = selectedId
            if (target != null) refreshMessages(target, current) else refreshBootstrap()
            delay(COLLAB_POLL_MS)
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFFF2F6F3)) {
                Column(Modifier.fillMaxSize()) {
                    TopAppBar(
                        title = {
                            val title = when {
                                showMembers -> "محادثة جديدة"
                                selectedId != null -> data?.conversations?.firstOrNull { it.id == selectedId }?.title ?: "التواصل"
                                else -> "التواصل"
                            }
                            Text(title, fontWeight = FontWeight.Bold)
                        },
                        navigationIcon = {
                            IconButton(
                                onClick = {
                                    when {
                                        showMembers -> showMembers = false
                                        selectedId != null -> {
                                            selectedId = null
                                            messages = emptyList()
                                        }
                                        else -> onDismiss()
                                    }
                                }
                            ) {
                                Icon(
                                    if (showMembers || selectedId != null) Icons.Outlined.ArrowBack else Icons.Outlined.Close,
                                    contentDescription = null
                                )
                            }
                        },
                        actions = {
                            if (!showMembers && selectedId == null) {
                                IconButton(onClick = { showMembers = true }, enabled = data != null) {
                                    Icon(Icons.Outlined.AddComment, contentDescription = "محادثة جديدة")
                                }
                            }
                            IconButton(
                                onClick = {
                                    scope.launch {
                                        val target = selectedId
                                        if (target == null) refreshBootstrap() else refreshMessages(target, data)
                                    }
                                },
                                enabled = !busy
                            ) {
                                Icon(Icons.Outlined.Refresh, contentDescription = "تحديث")
                            }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(
                            containerColor = Color(0xFF0E5A98),
                            titleContentColor = Color.White,
                            navigationIconContentColor = Color.White,
                            actionIconContentColor = Color.White
                        )
                    )

                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (error.isNotBlank()) {
                        Surface(color = Color(0xFFFFE8E6), modifier = Modifier.fillMaxWidth()) {
                            Text(error, color = Color(0xFF8A1C12), modifier = Modifier.padding(12.dp))
                        }
                    }

                    when {
                        showMembers -> {
                            val current = data
                            val members = current?.members.orEmpty().filter { it.id != current?.meId }
                            if (!busy && members.isEmpty()) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("لا يوجد أعضاء فريق متاحون في هذا الفرع")
                                }
                            } else {
                                LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    items(members, key = { it.id }) { member ->
                                        Card(
                                            modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) {
                                                val active = data ?: return@clickable
                                                scope.launch {
                                                    busy = true
                                                    val result = withContext(Dispatchers.IO) {
                                                        MobileChatApi.createDirect(context, active, member.id)
                                                    }
                                                    busy = false
                                                    if (!result.ok || result.value.isNullOrBlank()) {
                                                        error = result.error
                                                    } else {
                                                        val conversationId = result.value
                                                        val refreshed = refreshBootstrap() ?: active
                                                        showMembers = false
                                                        selectedId = conversationId
                                                        refreshMessages(conversationId, refreshed)
                                                    }
                                                }
                                            },
                                            colors = CardDefaults.cardColors(containerColor = Color.White)
                                        ) {
                                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                                Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Color(0xFF0E5A98))
                                                Spacer(Modifier.width(10.dp))
                                                Text(member.name, fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        selectedId == null -> {
                            val conversations = data?.conversations.orEmpty()
                            if (!busy && conversations.isEmpty()) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Icon(Icons.Outlined.ChatBubbleOutline, null, modifier = Modifier.size(42.dp), tint = Color(0xFF0E5A98))
                                        Spacer(Modifier.height(8.dp))
                                        Text("لا توجد محادثات بعد", fontWeight = FontWeight.Bold)
                                        Text("اضغط + لبدء محادثة", color = Color.Gray)
                                    }
                                }
                            } else {
                                LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    items(conversations, key = { it.id }) { conversation ->
                                        Card(
                                            modifier = Modifier.fillMaxWidth().clickable { selectedId = conversation.id },
                                            colors = CardDefaults.cardColors(containerColor = Color.White)
                                        ) {
                                            Row(
                                                Modifier.fillMaxWidth().padding(14.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Color(0xFF0E5A98))
                                                Spacer(Modifier.width(10.dp))
                                                Column(Modifier.weight(1f)) {
                                                    Text(conversation.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                    if (conversation.preview.isNotBlank()) {
                                                        Text(conversation.preview, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                    }
                                                }
                                                if (conversation.unread > 0) {
                                                    Badge { Text(conversation.unread.coerceAtMost(99).toString()) }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        else -> {
                            val current = data
                            Column(Modifier.fillMaxSize()) {
                                LazyColumn(
                                    modifier = Modifier.fillMaxWidth().weight(1f),
                                    contentPadding = PaddingValues(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    items(messages, key = { it.id }) { message ->
                                        val mine = message.senderId.isNotBlank() && message.senderId == current?.meId
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = if (mine) Arrangement.Start else Arrangement.End
                                        ) {
                                            Surface(
                                                modifier = Modifier.widthIn(max = 310.dp),
                                                color = if (mine) Color(0xFFDDF4D7) else Color.White,
                                                shape = RoundedCornerShape(16.dp)
                                            ) {
                                                Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                                                    if (!mine && message.senderName.isNotBlank()) {
                                                        Text(message.senderName, color = Color(0xFF0E5A98), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                                                    }
                                                    if (message.body.isNotBlank()) Text(message.body)
                                                    if (message.orderId.isNotBlank()) {
                                                        Text("أوردر: ${message.orderId}", color = Color.Gray, style = MaterialTheme.typography.labelSmall)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                Surface(color = Color.White, tonalElevation = 4.dp) {
                                    Row(
                                        Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        OutlinedTextField(
                                            value = draft,
                                            onValueChange = { draft = it },
                                            modifier = Modifier.weight(1f),
                                            placeholder = { Text("اكتب رسالة…") },
                                            maxLines = 4,
                                            shape = RoundedCornerShape(18.dp)
                                        )
                                        Spacer(Modifier.width(8.dp))
                                        FilledIconButton(
                                            onClick = {
                                                val target = selectedId ?: return@FilledIconButton
                                                val active = data ?: return@FilledIconButton
                                                val text = draft.trim()
                                                if (text.isBlank()) return@FilledIconButton
                                                scope.launch {
                                                    sending = true
                                                    val result = withContext(Dispatchers.IO) {
                                                        MobileChatApi.send(context, active, target, text)
                                                    }
                                                    sending = false
                                                    if (!result.ok) {
                                                        error = result.error
                                                    } else {
                                                        draft = ""
                                                        error = ""
                                                        refreshMessages(target, active)
                                                    }
                                                }
                                            },
                                            enabled = draft.isNotBlank() && !sending
                                        ) {
                                            if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                            else Icon(Icons.Outlined.Send, contentDescription = "إرسال")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
