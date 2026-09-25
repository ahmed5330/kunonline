package com.kunonline.callerid

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

private const val COLLAB_BASE_URL = "https://app.kun-online.com"
private const val COLLAB_REFRESH_MS = 15_000L

internal data class MobileCollabMember(
    val id: String,
    val name: String,
    val role: String = ""
)

internal data class MobileCollabConversation(
    val id: String,
    val title: String,
    val lastBody: String,
    val lastSender: String,
    val unreadCount: Int
)

internal data class MobileCollabMessage(
    val id: String,
    val senderId: String,
    val senderName: String,
    val body: String,
    val orderId: String,
    val createdAt: String
)

internal data class MobileCollabBootstrap(
    val meId: String,
    val meName: String,
    val clientId: String,
    val storeId: String,
    val members: List<MobileCollabMember>,
    val conversations: List<MobileCollabConversation>
)

internal data class MobileCollabResult<T>(
    val ok: Boolean,
    val value: T? = null,
    val message: String = ""
)

internal object MobileCollaborationApi {
    private data class HttpResult(val code: Int, val body: JSONObject)
    private data class Scope(val clientId: String, val storeId: String)

    @Synchronized
    private fun resolveConcreteScope(context: Context, cookie: String): MobileCollabResult<Scope> {
        val base = KunApi.resolveScope(cookie)
        val clientId = base.clientId
        if (clientId.isBlank()) return MobileCollabResult(false, message = "تعذر تحديد حساب المتجر")
        if (base.storeId.isNotBlank()) return MobileCollabResult(true, Scope(clientId, base.storeId))

        val storeContext = request(
            "GET",
            "/api/my-store-context?clientId=${enc(clientId)}",
            cookie
        )
        if (storeContext.code == 401) return MobileCollabResult(false, message = "انتهت الجلسة — سجّل الدخول مرة أخرى")
        val stores = storeContext.body.optJSONArray("stores") ?: JSONArray()
        for (i in 0 until stores.length()) {
            val row = stores.optJSONObject(i) ?: continue
            val id = row.optString("id").ifBlank { row.optString("storeId") }.trim()
            if (id.isNotBlank()) return MobileCollabResult(true, Scope(clientId, id))
        }

        // Older/all-store sessions can omit the selected store from the context endpoint.
        // Use the first authorised order only as a safe scope hint; the collaboration API
        // still performs its own tenant/store authorisation before returning anything.
        val state = request("GET", "/api/state?clientId=${enc(clientId)}", cookie)
        val orders = state.body.optJSONArray("orders") ?: JSONArray()
        for (i in 0 until orders.length()) {
            val row = orders.optJSONObject(i) ?: continue
            val id = row.optString("storeId").ifBlank { row.optString("store_id") }.trim()
            if (id.isNotBlank()) return MobileCollabResult(true, Scope(clientId, id))
        }
        return MobileCollabResult(false, message = "اختار متجر/فرع له بيانات قبل فتح التواصل")
    }

    fun bootstrap(context: Context): MobileCollabResult<MobileCollabBootstrap> {
        val cookie = KunApi.sessionCookie(context)
            ?: return MobileCollabResult(false, message = "سجّل الدخول أولاً")
        return runCatching {
            val scopeResult = resolveConcreteScope(context, cookie)
            val scope = scopeResult.value ?: return MobileCollabResult(false, message = scopeResult.message)
            val response = request(
                "GET",
                "/api/collaboration/bootstrap?clientId=${enc(scope.clientId)}&storeId=${enc(scope.storeId)}",
                cookie
            )
            if (response.code !in 200..299) {
                return MobileCollabResult(false, message = errorMessage(response.body).ifBlank { "تعذر تحميل التواصل" })
            }
            val root = response.body
            val me = root.optJSONObject("me") ?: JSONObject()
            val meId = me.optString("id")
            val membersArray = root.optJSONArray("members") ?: JSONArray()
            val members = buildList {
                for (i in 0 until membersArray.length()) {
                    val row = membersArray.optJSONObject(i) ?: continue
                    val id = row.optString("id").trim()
                    if (id.isBlank()) continue
                    add(MobileCollabMember(id, row.optString("name").ifBlank { row.optString("email") }, row.optString("role")))
                }
            }
            val memberNames = members.associate { it.id to it.name }
            val conversationsArray = root.optJSONArray("conversations") ?: JSONArray()
            val conversations = buildList {
                for (i in 0 until conversationsArray.length()) {
                    val row = conversationsArray.optJSONObject(i) ?: continue
                    val id = row.optString("id").trim()
                    if (id.isBlank()) continue
                    val type = row.optString("type")
                    val title = row.optString("name").trim().ifBlank {
                        val conversationMembers = row.optJSONArray("members") ?: JSONArray()
                        val otherNames = buildList {
                            for (m in 0 until conversationMembers.length()) {
                                val member = conversationMembers.optJSONObject(m) ?: continue
                                val memberId = member.optString("id")
                                if (memberId == meId) continue
                                add(member.optString("name").ifBlank { memberNames[memberId].orEmpty() }.ifBlank { "عضو الفريق" })
                            }
                        }
                        if (type == "direct") otherNames.firstOrNull() ?: "محادثة خاصة"
                        else otherNames.joinToString("، ").ifBlank { "محادثة الفريق" }
                    }
                    add(
                        MobileCollabConversation(
                            id = id,
                            title = title,
                            lastBody = row.optString("last_body").ifBlank { row.optString("lastBody") },
                            lastSender = row.optString("last_sender").ifBlank { row.optString("lastSender") },
                            unreadCount = row.optInt("unreadCount", row.optInt("unread_count", 0))
                        )
                    )
                }
            }
            MobileCollabResult(
                true,
                MobileCollabBootstrap(
                    meId = meId,
                    meName = me.optString("name"),
                    clientId = scope.clientId,
                    storeId = scope.storeId,
                    members = members,
                    conversations = conversations
                )
            )
        }.getOrElse { MobileCollabResult(false, message = "تعذر الاتصال بتواصل الفريق") }
    }

    fun messages(context: Context, bootstrap: MobileCollabBootstrap, conversationId: String): MobileCollabResult<List<MobileCollabMessage>> {
        val cookie = KunApi.sessionCookie(context)
            ?: return MobileCollabResult(false, message = "سجّل الدخول أولاً")
        return runCatching {
            val response = request(
                "GET",
                "/api/collaboration/conversations/${enc(conversationId)}/messages?clientId=${enc(bootstrap.clientId)}&storeId=${enc(bootstrap.storeId)}",
                cookie
            )
            if (response.code !in 200..299) {
                return MobileCollabResult(false, message = errorMessage(response.body).ifBlank { "تعذر تحميل الرسائل" })
            }
            val array = response.body.optJSONArray("messages") ?: JSONArray()
            val rows = buildList {
                for (i in 0 until array.length()) {
                    val row = array.optJSONObject(i) ?: continue
                    add(
                        MobileCollabMessage(
                            id = row.optString("id"),
                            senderId = row.optString("sender_user_id").ifBlank { row.optString("senderUserId") },
                            senderName = row.optString("sender_name").ifBlank { row.optString("senderName") },
                            body = row.optString("body"),
                            orderId = row.optString("order_id").ifBlank { row.optString("orderId") },
                            createdAt = row.optString("created_at").ifBlank { row.optString("createdAt") }
                        )
                    )
                }
            }
            MobileCollabResult(true, rows)
        }.getOrElse { MobileCollabResult(false, message = "تعذر الاتصال بتواصل الفريق") }
    }

    fun send(context: Context, bootstrap: MobileCollabBootstrap, conversationId: String, text: String): MobileCollabResult<String> {
        val cookie = KunApi.sessionCookie(context)
            ?: return MobileCollabResult(false, message = "سجّل الدخول أولاً")
        if (text.isBlank()) return MobileCollabResult(false, message = "اكتب رسالة أولاً")
        return runCatching {
            val payload = JSONObject()
                .put("clientId", bootstrap.clientId)
                .put("storeId", bootstrap.storeId)
                .put("body", text.trim())
            val response = request(
                "POST",
                "/api/collaboration/conversations/${enc(conversationId)}/messages",
                cookie,
                payload.toString()
            )
            if (response.code !in 200..299) {
                return MobileCollabResult(false, message = errorMessage(response.body).ifBlank { "تعذر إرسال الرسالة" })
            }
            MobileCollabResult(true, response.body.optString("id"))
        }.getOrElse { MobileCollabResult(false, message = "تعذر إرسال الرسالة") }
    }

    fun createDirect(context: Context, bootstrap: MobileCollabBootstrap, targetUserId: String): MobileCollabResult<String> {
        val cookie = KunApi.sessionCookie(context)
            ?: return MobileCollabResult(false, message = "سجّل الدخول أولاً")
        return runCatching {
            val payload = JSONObject()
                .put("clientId", bootstrap.clientId)
                .put("storeId", bootstrap.storeId)
                .put("type", "direct")
                .put("targetUserId", targetUserId)
            val response = request("POST", "/api/collaboration/conversations", cookie, payload.toString())
            if (response.code !in 200..299) {
                return MobileCollabResult(false, message = errorMessage(response.body).ifBlank { "تعذر بدء المحادثة" })
            }
            val id = response.body.optString("id")
            if (id.isBlank()) MobileCollabResult(false, message = "تعذر قراءة المحادثة الجديدة")
            else MobileCollabResult(true, id)
        }.getOrElse { MobileCollabResult(false, message = "تعذر بدء المحادثة") }
    }

    private fun request(method: String, path: String, cookie: String, body: String? = null): HttpResult {
        val connection = (URL(COLLAB_BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 20_000
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-Kun-Mobile", "native-android/2.6.8")
            if (body != null) doOutput = true
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            return HttpResult(code, runCatching { JSONObject(text) }.getOrDefault(JSONObject()))
        } finally {
            connection.disconnect()
        }
    }

    private fun errorMessage(body: JSONObject): String =
        body.optString("error").ifBlank { body.optString("message") }

    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileCollaborationDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bootstrap by remember { mutableStateOf<MobileCollabBootstrap?>(null) }
    var selectedConversationId by remember { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf<List<MobileCollabMessage>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var showMembers by remember { mutableStateOf(false) }

    suspend fun reloadBootstrap(): MobileCollabBootstrap? {
        loading = true
        val result = withContext(Dispatchers.IO) { MobileCollaborationApi.bootstrap(context) }
        loading = false
        if (!result.ok || result.value == null) {
            error = result.message
            return null
        }
        error = ""
        bootstrap = result.value
        return result.value
    }

    suspend fun reloadMessages(target: String, current: MobileCollabBootstrap = bootstrap ?: return) {
        loading = true
        val result = withContext(Dispatchers.IO) { MobileCollaborationApi.messages(context, current, target) }
        loading = false
        if (!result.ok || result.value == null) {
            error = result.message
            return
        }
        error = ""
        messages = result.value
    }

    LaunchedEffect(Unit) { reloadBootstrap() }

    LaunchedEffect(selectedConversationId, bootstrap?.clientId, bootstrap?.storeId) {
        while (isActive) {
            val current = bootstrap
            val selected = selectedConversationId
            if (current != null && selected != null) reloadMessages(selected, current)
            else if (current != null) reloadBootstrap()
            delay(COLLAB_REFRESH_MS)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = Color(0xFFF2F6F3)
            ) {
                Column(Modifier.fillMaxSize()) {
                    TopAppBar(
                        title = {
                            Text(
                                when {
                                    showMembers -> "محادثة جديدة"
                                    selectedConversationId != null -> bootstrap?.conversations?.firstOrNull { it.id == selectedConversationId }?.title ?: "التواصل"
                                    else -> "التواصل"
                                },
                                fontWeight = FontWeight.Bold
                            )
                        },
                        navigationIcon = {
                            IconButton(onClick = {
                                when {
                                    showMembers -> showMembers = false
                                    selectedConversationId != null -> {
                                        selectedConversationId = null
                                        messages = emptyList()
                                    }
                                    else -> onDismiss()
                                }
                            }) {
                                Icon(
                                    if (showMembers || selectedConversationId != null) Icons.Outlined.ArrowBack else Icons.Outlined.Close,
                                    contentDescription = null
                                )
                            }
                        },
                        actions = {
                            if (!showMembers && selectedConversationId == null) {
                                IconButton(onClick = { showMembers = true }, enabled = bootstrap != null) {
                                    Icon(Icons.Outlined.AddComment, contentDescription = "محادثة جديدة")
                                }
                            }
                            IconButton(
                                onClick = {
                                    scope.launch {
                                        if (selectedConversationId != null && bootstrap != null) reloadMessages(selectedConversationId!!, bootstrap!!)
                                        else reloadBootstrap()
                                    }
                                },
                                enabled = !loading
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

                    if (loading) {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                    if (error.isNotBlank()) {
                        Surface(color = Color(0xFFFFE8E6), modifier = Modifier.fillMaxWidth()) {
                            Text(error, color = Color(0xFF8A1C12), modifier = Modifier.padding(12.dp))
                        }
                    }

                    when {
                        showMembers -> {
                            val current = bootstrap
                            val members = current?.members.orEmpty().filter { it.id != current?.meId }
                            if (members.isEmpty()) {
                                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                                    Text("لا يوجد أعضاء فريق متاحون في هذا الفرع")
                                }
                            } else {
                                LazyColumn(
                                    modifier = Modifier.fillMaxSize(),
                                    contentPadding = PaddingValues(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    items(members, key = { it.id }) { member ->
                                        Card(
                                            modifier = Modifier.fillMaxWidth().clickable(enabled = !loading) {
                                                val currentBootstrap = bootstrap ?: return@clickable
                                                scope.launch {
                                                    loading = true
                                                    val result = withContext(Dispatchers.IO) {
                                                        MobileCollaborationApi.createDirect(context, currentBootstrap, member.id)
                                                    }
                                                    loading = false
                                                    if (!result.ok || result.value.isNullOrBlank()) {
                                                        error = result.message
                                                        return@launch
                                                    }
                                                    val id = result.value
                                                    val refreshed = reloadBootstrap() ?: currentBootstrap
                                                    showMembers = false
                                                    selectedConversationId = id
                                                    reloadMessages(id, refreshed)
                                                }
                                            },
                                            colors = CardDefaults.cardColors(containerColor = Color.White)
                                        ) {
                                            Row(
                                                Modifier.fillMaxWidth().padding(14.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                                            ) {
                                                Box(
                                                    Modifier.size(42.dp).background(Color(0xFFE5F1FF), CircleShape),
                                                    contentAlignment = Alignment.Center
                                                ) {
                                                    Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Color(0xFF0E5A98))
                                                }
                                                Column(Modifier.weight(1f)) {
                                                    Text(member.name, fontWeight = FontWeight.Bold)
                                                    if (member.role.isNotBlank()) Text(member.role, style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        selectedConversationId == null -> {
                            val conversations = bootstrap?.conversations.orEmpty()
                            if (!loading && conversations.isEmpty()) {
                                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Icon(Icons.Outlined.ChatBubbleOutline, null, modifier = Modifier.size(44.dp), tint = Color(0xFF0E5A98))
                                        Text("لا توجد محادثات بعد", fontWeight = FontWeight.Bold)
                                        Text("اضغط + لبدء محادثة مع أحد أعضاء الفريق", color = Color.Gray)
                                    }
                                }
                            } else {
                                LazyColumn(
                                    modifier = Modifier.fillMaxSize(),
                                    contentPadding = PaddingValues(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    items(conversations, key = { it.id }) { conversation ->
                                        Card(
                                            modifier = Modifier.fillMaxWidth().clickable {
                                                showMembers = false
                                                selectedConversationId = conversation.id
                                            },
                                            colors = CardDefaults.cardColors(containerColor = Color.White)
                                        ) {
                                            Row(
                                                Modifier.fillMaxWidth().padding(14.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                                            ) {
                                                Box(
                                                    Modifier.size(44.dp).background(Color(0xFFE5F1FF), CircleShape),
                                                    contentAlignment = Alignment.Center
                                                ) {
                                                    Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Color(0xFF0E5A98))
                                                }
                                                Column(Modifier.weight(1f)) {
                                                    Text(conversation.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                    val preview = listOf(conversation.lastSender, conversation.lastBody).filter { it.isNotBlank() }.joinToString(": ")
                                                    if (preview.isNotBlank()) Text(preview, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.Gray)
                                                }
                                                if (conversation.unreadCount > 0) {
                                                    Badge { Text(conversation.unreadCount.coerceAtMost(99).toString()) }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        else -> {
                            Column(Modifier.fillMaxSize()) {
                                val current = bootstrap
                                LazyColumn(
                                    modifier = Modifier.weight(1f).fillMaxWidth(),
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
                                                Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                                    if (!mine && message.senderName.isNotBlank()) {
                                                        Text(message.senderName, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = Color(0xFF0E5A98))
                                                    }
                                                    if (message.body.isNotBlank()) Text(message.body)
                                                    if (message.orderId.isNotBlank()) {
                                                        Text("أوردر: ${message.orderId}", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Surface(color = Color.White, tonalElevation = 4.dp) {
                                    Row(
                                        Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        OutlinedTextField(
                                            value = draft,
                                            onValueChange = { draft = it },
                                            modifier = Modifier.weight(1f),
                                            placeholder = { Text("اكتب رسالة…") },
                                            maxLines = 4,
                                            shape = RoundedCornerShape(18.dp)
                                        )
                                        FilledIconButton(
                                            onClick = {
                                                val target = selectedConversationId ?: return@FilledIconButton
                                                val currentBootstrap = bootstrap ?: return@FilledIconButton
                                                val text = draft.trim()
                                                if (text.isBlank()) return@FilledIconButton
                                                scope.launch {
                                                    sending = true
                                                    val result = withContext(Dispatchers.IO) {
                                                        MobileCollaborationApi.send(context, currentBootstrap, target, text)
                                                    }
                                                    sending = false
                                                    if (!result.ok) {
                                                        error = result.message
                                                    } else {
                                                        draft = ""
                                                        error = ""
                                                        reloadMessages(target, currentBootstrap)
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
