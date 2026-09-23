package com.kunonline.callerid

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class CallerJntOrderEditActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CallerOverlay.dismiss()
        val orderId = intent.getStringExtra(EXTRA_ORDER_ID).orEmpty()
        if (orderId.isBlank()) {
            finish()
            return
        }
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                KunTheme {
                    CallerJntOrderEditScreen(orderId = orderId, onClose = { finish() })
                }
            }
        }
    }

    companion object {
        const val EXTRA_ORDER_ID = "kun_caller_jnt_order_id"
    }
}

private const val CALLER_JNT_ADDRESS_BASE = "https://app.kun-online.com/v2/data/jnt-addresses"
private const val CALLER_JNT_ADDRESS_VERSION = "2026-09-09"

private data class CallerJntProvince(val name: String, val code: String, val file: String)
private data class CallerJntArea(val name: String, val code: String)
private data class CallerJntCity(val key: String, val name: String, val code: String, val areas: List<CallerJntArea>)
private data class CallerJntManifest(val countryCode: String, val provinces: List<CallerJntProvince>)

private object CallerJntAddressRepository {
    @Volatile private var manifestCache: CallerJntManifest? = null
    private val provinceCache = mutableMapOf<String, List<CallerJntCity>>()

    suspend fun manifest(): CallerJntManifest = withContext(Dispatchers.IO) {
        manifestCache?.let { return@withContext it }
        val root = getJson("$CALLER_JNT_ADDRESS_BASE/index.json?v=$CALLER_JNT_ADDRESS_VERSION")
        val rows = root.optJSONArray("provinces") ?: JSONArray()
        val provinces = buildList {
            for (i in 0 until rows.length()) {
                val item = rows.optJSONObject(i) ?: continue
                val name = item.optString("name").trim()
                val code = item.optString("code").trim()
                val file = item.optString("file").trim()
                if (name.isNotBlank() && file.isNotBlank()) add(CallerJntProvince(name, code, file))
            }
        }
        CallerJntManifest(root.optString("countryCode").ifBlank { "100000" }, provinces).also { manifestCache = it }
    }

    suspend fun cities(province: CallerJntProvince): List<CallerJntCity> = withContext(Dispatchers.IO) {
        synchronized(provinceCache) { provinceCache[province.file] }?.let { return@withContext it }
        val root = getJson("$CALLER_JNT_ADDRESS_BASE/${province.file}?v=$CALLER_JNT_ADDRESS_VERSION")
        val rows = root.optJSONArray("cities") ?: JSONArray()
        val cities = buildList {
            for (i in 0 until rows.length()) {
                val item = rows.optJSONObject(i) ?: continue
                val areaRows = item.optJSONArray("areas") ?: JSONArray()
                val areas = buildList {
                    for (j in 0 until areaRows.length()) {
                        val area = areaRows.optJSONObject(j) ?: continue
                        val name = area.optString("name").trim()
                        if (name.isNotBlank()) add(CallerJntArea(name, area.optString("code").trim()))
                    }
                }
                val name = item.optString("name").trim()
                if (name.isNotBlank()) add(
                    CallerJntCity(
                        key = item.optString("key").ifBlank { "${item.optString("code")}:$name" },
                        name = name,
                        code = item.optString("code").trim(),
                        areas = areas
                    )
                )
            }
        }
        synchronized(provinceCache) { provinceCache[province.file] = cities }
        cities
    }

    private fun getJson(url: String): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-cache")
        }
        try {
            if (connection.responseCode !in 200..299) throw IllegalStateException("تعذر تحميل دليل عناوين J&T")
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }
}

private data class CallerJntSeed(
    val name: String,
    val phone: String,
    val phone2: String,
    val province: String,
    val provinceCode: String,
    val city: String,
    val cityCode: String,
    val cityKey: String,
    val area: String,
    val areaCode: String,
    val street: String,
    val product: String,
    val quantity: Int,
    val total: Double,
    val weight: Double,
    val note: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CallerJntOrderEditScreen(orderId: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var formError by remember { mutableStateOf("") }
    var editorData by remember { mutableStateOf<CustomerServiceEditorData?>(null) }
    var manifest by remember { mutableStateOf<CallerJntManifest?>(null) }
    var cities by remember { mutableStateOf<List<CallerJntCity>>(emptyList()) }
    var initialized by remember { mutableStateOf(false) }

    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var phone2 by remember { mutableStateOf("") }
    var province by remember { mutableStateOf<CallerJntProvince?>(null) }
    var city by remember { mutableStateOf<CallerJntCity?>(null) }
    var area by remember { mutableStateOf<CallerJntArea?>(null) }
    var street by remember { mutableStateOf("") }
    var product by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    var codAmount by remember { mutableStateOf("") }
    var weight by remember { mutableStateOf("1") }
    var notes by remember { mutableStateOf("") }

    var provincePicker by remember { mutableStateOf(false) }
    var cityPicker by remember { mutableStateOf(false) }
    var areaPicker by remember { mutableStateOf(false) }

    LaunchedEffect(orderId) {
        loading = true
        val dataResult = withContext(Dispatchers.IO) { KunCustomerServiceApi.fetchEditorData(context, orderId) }
        val manifestResult = runCatching { CallerJntAddressRepository.manifest() }
        if (!dataResult.ok) {
            error = dataResult.message
        } else if (manifestResult.isFailure) {
            error = "تعذر تحميل دليل عناوين J&T"
        } else {
            editorData = dataResult
            manifest = manifestResult.getOrNull()
        }
        loading = false
    }

    LaunchedEffect(editorData, manifest) {
        if (initialized) return@LaunchedEffect
        val data = editorData ?: return@LaunchedEffect
        val addressManifest = manifest ?: return@LaunchedEffect
        val seed = callerJntSeed(data)
        name = seed.name
        phone = seed.phone
        phone2 = seed.phone2
        street = seed.street
        product = seed.product
        quantity = seed.quantity.coerceAtLeast(1).toString()
        codAmount = callerJntNumber(seed.total)
        weight = callerJntNumber(seed.weight.coerceAtLeast(0.01))
        notes = seed.note

        val matchedProvince = addressManifest.provinces.firstOrNull { p ->
            (seed.provinceCode.isNotBlank() && p.code == seed.provinceCode) || p.name == seed.province
        }
        if (matchedProvince != null) {
            province = matchedProvince
            val loadedCities = runCatching { CallerJntAddressRepository.cities(matchedProvince) }.getOrDefault(emptyList())
            cities = loadedCities
            val matchedCity = loadedCities.firstOrNull { c ->
                (seed.cityKey.isNotBlank() && c.key == seed.cityKey) ||
                    (seed.cityCode.isNotBlank() && c.code == seed.cityCode && (seed.city.isBlank() || c.name == seed.city)) ||
                    (seed.city.isNotBlank() && c.name == seed.city)
            }
            city = matchedCity
            area = matchedCity?.areas?.firstOrNull { a ->
                (seed.areaCode.isNotBlank() && a.code == seed.areaCode) || (seed.area.isNotBlank() && a.name == seed.area)
            }
        }
        initialized = true
    }

    fun save() {
        if (saving) return
        val selectedManifest = manifest
        val selectedProvince = province
        val selectedCity = city
        val selectedArea = area
        val qty = quantity.toIntOrNull()
        val total = codAmount.replace(',', '.').toDoubleOrNull()
        val kg = weight.replace(',', '.').toDoubleOrNull()
        formError = when {
            name.isBlank() -> "اكتب اسم المستلم"
            phone.isBlank() -> "اكتب رقم موبايل المستلم"
            selectedManifest == null -> "دليل J&T غير جاهز"
            selectedProvince == null -> "اختر المحافظة من قائمة J&T"
            selectedCity == null -> "اختر المدينة / الحي من قائمة J&T"
            selectedArea == null -> "اختر المنطقة من قائمة J&T"
            street.isBlank() -> "اكتب الشارع والعنوان التفصيلي"
            product.isBlank() -> "اكتب اسم المنتج"
            qty == null || qty < 1 -> "اكتب كمية صحيحة"
            total == null || total < 0 -> "اكتب قيمة تحصيل صحيحة"
            kg == null || kg <= 0 -> "اكتب وزن صحيح أكبر من صفر"
            else -> ""
        }
        if (formError.isNotBlank()) return

        val jntAddress = JSONObject()
            .put("country", "Egypt")
            .put("countryCode", selectedManifest!!.countryCode.ifBlank { "100000" })
            .put("province", selectedProvince!!.name)
            .put("provinceCode", selectedProvince.code)
            .put("city", selectedCity!!.name)
            .put("cityCode", selectedCity.code)
            .put("cityKey", selectedCity.key)
            .put("area", selectedArea!!.name)
            .put("areaCode", selectedArea.code)
            .put("street", street.trim())
            .put("phone2", phone2.trim())
            .put("weight", kg!!)

        val payload = JSONObject()
            .put("name", name.trim())
            .put("phone", phone.trim())
            .put("phone2", phone2.trim())
            .put("product", product.trim())
            .put("quantity", qty!!)
            .put("total", total!!)
            .put("weight", kg)
            .put("customerNote", notes.trim())
            .put("jntAddress", jntAddress)

        saving = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { CallerJntEditApi.save(context, orderId, payload) }
            saving = false
            if (result.ok) {
                withContext(Dispatchers.IO) { KunApi.syncWithStoredSession(context) }
                Toast.makeText(context, result.message, Toast.LENGTH_LONG).show()
                onClose()
            } else {
                formError = result.message
            }
        }
    }

    Scaffold(
        containerColor = KunColors.Ground,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = KunColors.Chrome,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                ),
                title = {
                    Column {
                        Text("تعديل بيانات العميل وJ&T", fontWeight = FontWeight.Bold)
                        Text("من شاشة المكالمة", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .72f))
                    }
                },
                navigationIcon = { TextButton(onClick = onClose) { Text("إغلاق", color = Color.White) } }
            )
        },
        bottomBar = {
            if (!loading && error.isBlank()) {
                Surface(color = KunColors.Surface, shadowElevation = 10.dp) {
                    Button(
                        onClick = { save() },
                        enabled = !saving,
                        modifier = Modifier.fillMaxWidth().padding(14.dp).heightIn(min = 52.dp)
                    ) {
                        if (saving) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(if (saving) "جاري الحفظ..." else "حفظ كل التعديلات", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = KunColors.Pine)
            }
            error.isNotBlank() -> Column(
                Modifier.fillMaxSize().padding(padding).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(error, color = KunColors.Brick)
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("إغلاق") }
            }
            else -> Column(
                modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(color = KunColors.ChromeSoft, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        "العنوان هنا يستخدم نفس دليل J&T الرسمي: محافظة ← مدينة/حي ← منطقة، ويتم حفظ الأسماء والأكواد الأصلية مع الأوردر.",
                        modifier = Modifier.padding(14.dp),
                        color = KunColors.Chrome,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                CallerJntSection("بيانات المستلم") {
                    CallerJntTextField(name, { name = it }, "اسم المستلم *")
                    CallerJntTextField(phone, { phone = it }, "رقم الموبايل *", KeyboardType.Phone)
                    CallerJntTextField(phone2, { phone2 = it }, "رقم إضافي", KeyboardType.Phone)
                }

                CallerJntSection("عنوان J&T") {
                    CallerJntChoice("المحافظة *", province?.name.orEmpty(), manifest != null && !saving) { provincePicker = true }
                    CallerJntChoice("المدينة / الحي *", city?.let { callerJntCityDisplay(it, cities) }.orEmpty(), province != null && cities.isNotEmpty() && !saving) { cityPicker = true }
                    CallerJntChoice("المنطقة *", area?.let { callerJntAreaDisplay(it, city?.areas.orEmpty()) }.orEmpty(), city != null && city!!.areas.isNotEmpty() && !saving) { areaPicker = true }
                    OutlinedTextField(
                        value = street,
                        onValueChange = { street = it },
                        label = { Text("الشارع / العنوان التفصيلي *") },
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                CallerJntSection("بيانات الأوردر") {
                    CallerJntTextField(product, { product = it }, "اسم المنتج *")
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CallerJntTextField(quantity, { quantity = callerJntDigits(it) }, "الكمية *", KeyboardType.Number, Modifier.weight(1f))
                        CallerJntTextField(weight, { weight = callerJntDecimal(it) }, "الوزن كجم *", KeyboardType.Decimal, Modifier.weight(1f))
                    }
                    CallerJntTextField(codAmount, { codAmount = callerJntDecimal(it) }, "قيمة التحصيل / الإجمالي *", KeyboardType.Decimal)
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        label = { Text("ملاحظات") },
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                if (formError.isNotBlank()) {
                    Surface(color = KunColors.BrickSoft, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                        Text(formError, color = KunColors.Brick, modifier = Modifier.padding(12.dp))
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    if (provincePicker) {
        CallerJntPicker(
            title = "اختر محافظة J&T",
            items = manifest?.provinces.orEmpty(),
            label = { it.name },
            onDismiss = { provincePicker = false },
            onSelect = { selected ->
                provincePicker = false
                province = selected
                city = null
                area = null
                cities = emptyList()
                scope.launch {
                    cities = runCatching { CallerJntAddressRepository.cities(selected) }.getOrElse {
                        formError = "تعذر تحميل مدن ومناطق ${selected.name}"
                        emptyList()
                    }
                }
            }
        )
    }
    if (cityPicker) {
        CallerJntPicker(
            title = "اختر المدينة / الحي",
            items = cities,
            label = { callerJntCityDisplay(it, cities) },
            onDismiss = { cityPicker = false },
            onSelect = { selected -> cityPicker = false; city = selected; area = null }
        )
    }
    if (areaPicker) {
        val areas = city?.areas.orEmpty()
        CallerJntPicker(
            title = "اختر المنطقة",
            items = areas,
            label = { callerJntAreaDisplay(it, areas) },
            onDismiss = { areaPicker = false },
            onSelect = { selected -> areaPicker = false; area = selected }
        )
    }
}

@Composable
private fun CallerJntSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(color = KunColors.Surface, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun CallerJntTextField(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    modifier: Modifier = Modifier.fillMaxWidth()
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        singleLine = true,
        modifier = modifier
    )
}

@Composable
private fun CallerJntChoice(label: String, value: String, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 9.dp)
    ) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Text(label, style = MaterialTheme.typography.labelSmall)
            Text(value.ifBlank { "اضغط للاختيار" }, fontWeight = FontWeight.Medium)
        }
        Text("⌄")
    }
}

@Composable
private fun <T> CallerJntPicker(
    title: String,
    items: List<T>,
    label: (T) -> String,
    onDismiss: () -> Unit,
    onSelect: (T) -> Unit
) {
    var search by remember { mutableStateOf("") }
    val filtered = remember(items, search) {
        val query = search.trim()
        if (query.isBlank()) items else items.filter { label(it).contains(query, ignoreCase = true) }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth(.92f).fillMaxHeight(.82f),
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = 8.dp
        ) {
            Column(Modifier.fillMaxSize().padding(14.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    label = { Text("بحث") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                LazyColumn(Modifier.weight(1f)) {
                    items(filtered) { item ->
                        TextButton(onClick = { onSelect(item) }, modifier = Modifier.fillMaxWidth()) {
                            Text(label(item), modifier = Modifier.fillMaxWidth())
                        }
                        HorizontalDivider()
                    }
                }
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("إلغاء") }
            }
        }
    }
}

private fun callerJntSeed(data: CustomerServiceEditorData): CallerJntSeed {
    val details = data.details
    val customer = details.optJSONObject("customer") ?: JSONObject()
    val address = details.optJSONObject("address") ?: JSONObject()
    val order = details.optJSONObject("order") ?: JSONObject()
    val item = details.optJSONArray("items")?.optJSONObject(0) ?: JSONObject()
    val summary = details.optJSONObject("summary") ?: JSONObject()
    val historyOrder = data.historyOrder
    val jt = callerJntLatestAddress(historyOrder.optJSONArray("history"))
    return CallerJntSeed(
        name = customer.optString("name"),
        phone = customer.optString("phone"),
        phone2 = jt.optString("phone2"),
        province = jt.optString("province").ifBlank { address.optString("government").ifBlank { customer.optString("government") } },
        provinceCode = jt.optString("provinceCode"),
        city = jt.optString("city"),
        cityCode = jt.optString("cityCode"),
        cityKey = jt.optString("cityKey"),
        area = jt.optString("area"),
        areaCode = jt.optString("areaCode").ifBlank { jt.optString("districtCode") },
        street = jt.optString("street").ifBlank { address.optString("address").ifBlank { customer.optString("address") } },
        product = item.optString("productName").ifBlank { item.optString("name").ifBlank { historyOrder.optString("product") } },
        quantity = item.optInt("qty", item.optInt("quantity", historyOrder.optInt("qty", 1))).coerceAtLeast(1),
        total = summary.optDouble("total", historyOrder.optDouble("total", 0.0)),
        weight = jt.optDouble("weight", 1.0).takeIf { it > 0 } ?: 1.0,
        note = order.optString("customerNote").ifBlank { historyOrder.optString("customerNote") }
    )
}

private fun callerJntLatestAddress(history: JSONArray?): JSONObject {
    if (history == null) return JSONObject()
    for (i in history.length() - 1 downTo 0) {
        val event = history.optJSONObject(i) ?: continue
        val address = event.optJSONObject("jtAddress") ?: continue
        if (address.optString("province").isNotBlank()) return address
    }
    return JSONObject()
}

private fun callerJntCityDisplay(city: CallerJntCity, all: List<CallerJntCity>): String =
    if (all.count { it.name == city.name } > 1) "${city.name} (${city.code})" else city.name

private fun callerJntAreaDisplay(area: CallerJntArea, all: List<CallerJntArea>): String =
    if (all.count { it.name == area.name } > 1) "${area.name} (${area.code})" else area.name

private fun callerJntDigits(value: String): String = value.filter { it.isDigit() }

private fun callerJntDecimal(value: String): String {
    val normalized = value.replace(',', '.')
    var dotSeen = false
    return buildString {
        normalized.forEach { ch ->
            when {
                ch.isDigit() -> append(ch)
                ch == '.' && !dotSeen -> { append(ch); dotSeen = true }
            }
        }
    }
}

private fun callerJntNumber(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
