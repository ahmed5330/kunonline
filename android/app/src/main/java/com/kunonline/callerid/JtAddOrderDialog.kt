package com.kunonline.callerid

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

private const val JNT_ADDRESS_BASE = "https://app.kun-online.com/v2/data/jnt-addresses"
private const val JNT_ADDRESS_VERSION = "2026-09-09"

data class JntProvince(val name: String, val code: String, val file: String)
data class JntArea(val name: String, val code: String)
data class JntCity(val key: String, val name: String, val code: String, val areas: List<JntArea>)
data class JntManifest(val countryCode: String, val provinces: List<JntProvince>)

private object JntAddressRepository {
    @Volatile private var manifestCache: JntManifest? = null
    private val provinceCache = mutableMapOf<String, List<JntCity>>()

    suspend fun manifest(): JntManifest = withContext(Dispatchers.IO) {
        manifestCache?.let { return@withContext it }
        val root = getJson("$JNT_ADDRESS_BASE/index.json?v=$JNT_ADDRESS_VERSION")
        val rows = root.optJSONArray("provinces") ?: JSONArray()
        val provinces = buildList {
            for (i in 0 until rows.length()) {
                val item = rows.optJSONObject(i) ?: continue
                val name = item.optString("name").trim()
                val code = item.optString("code").trim()
                val file = item.optString("file").trim()
                if (name.isNotBlank() && file.isNotBlank()) add(JntProvince(name, code, file))
            }
        }
        JntManifest(root.optString("countryCode").ifBlank { "100000" }, provinces).also { manifestCache = it }
    }

    suspend fun cities(province: JntProvince): List<JntCity> = withContext(Dispatchers.IO) {
        synchronized(provinceCache) { provinceCache[province.file] }?.let { return@withContext it }
        val root = getJson("$JNT_ADDRESS_BASE/${province.file}?v=$JNT_ADDRESS_VERSION")
        val rows = root.optJSONArray("cities") ?: JSONArray()
        val cities = buildList {
            for (i in 0 until rows.length()) {
                val item = rows.optJSONObject(i) ?: continue
                val areasJson = item.optJSONArray("areas") ?: JSONArray()
                val areas = buildList {
                    for (j in 0 until areasJson.length()) {
                        val a = areasJson.optJSONObject(j) ?: continue
                        val name = a.optString("name").trim()
                        if (name.isNotBlank()) add(JntArea(name, a.optString("code").trim()))
                    }
                }
                val name = item.optString("name").trim()
                if (name.isNotBlank()) {
                    add(
                        JntCity(
                            key = item.optString("key").ifBlank { "${item.optString("code")}:$name" },
                            name = name,
                            code = item.optString("code").trim(),
                            areas = areas
                        )
                    )
                }
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

@Composable
fun JntAddOrderDialog(
    onDismiss: () -> Unit,
    onCreated: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var manifest by remember { mutableStateOf<JntManifest?>(null) }
    var cities by remember { mutableStateOf<List<JntCity>>(emptyList()) }
    var loadingAddresses by remember { mutableStateOf(true) }
    var addressError by remember { mutableStateOf("") }

    var customerName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var phone2 by remember { mutableStateOf("") }
    var province by remember { mutableStateOf<JntProvince?>(null) }
    var city by remember { mutableStateOf<JntCity?>(null) }
    var area by remember { mutableStateOf<JntArea?>(null) }
    var street by remember { mutableStateOf("") }
    var product by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    var codAmount by remember { mutableStateOf("") }
    var weight by remember { mutableStateOf("1") }
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf("") }

    var provincePicker by remember { mutableStateOf(false) }
    var cityPicker by remember { mutableStateOf(false) }
    var areaPicker by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        loadingAddresses = true
        runCatching { JntAddressRepository.manifest() }
            .onSuccess { manifest = it }
            .onFailure { addressError = "تعذر تحميل محافظات J&T. تأكد من الإنترنت وحاول مرة أخرى." }
        loadingAddresses = false
    }

    Dialog(onDismissRequest = { if (!saving) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.94f),
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = 6.dp
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("إضافة أوردر", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("عنوان J&T الرسمي — محافظة ← مدينة/حي ← منطقة", style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(onClick = onDismiss, enabled = !saving) { Text("إغلاق") }
                }
                HorizontalDivider()

                Column(
                    modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(11.dp)
                ) {
                    Text("بيانات المستلم", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = customerName, onValueChange = { customerName = it },
                        label = { Text("اسم المستلم *") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = phone, onValueChange = { phone = it },
                        label = { Text("رقم الموبايل *") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone)
                    )
                    OutlinedTextField(
                        value = phone2, onValueChange = { phone2 = it },
                        label = { Text("رقم إضافي") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone)
                    )

                    Spacer(Modifier.height(2.dp))
                    Text("عنوان J&T", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    if (loadingAddresses) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (addressError.isNotBlank()) Text(addressError, color = MaterialTheme.colorScheme.error)

                    JntChoiceField(
                        label = "المحافظة *",
                        value = province?.name.orEmpty(),
                        enabled = manifest != null && !saving,
                        onClick = { provincePicker = true }
                    )
                    JntChoiceField(
                        label = "المدينة / الحي *",
                        value = city?.let { cityDisplay(it, cities) }.orEmpty(),
                        enabled = province != null && cities.isNotEmpty() && !saving,
                        onClick = { cityPicker = true }
                    )
                    JntChoiceField(
                        label = "المنطقة *",
                        value = area?.let { areaDisplay(it, city?.areas.orEmpty()) }.orEmpty(),
                        enabled = city != null && city!!.areas.isNotEmpty() && !saving,
                        onClick = { areaPicker = true }
                    )
                    OutlinedTextField(
                        value = street, onValueChange = { street = it },
                        label = { Text("الشارع / العنوان التفصيلي *") },
                        minLines = 2, modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(Modifier.height(2.dp))
                    Text("بيانات الأوردر", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = product, onValueChange = { product = it },
                        label = { Text("اسم المنتج *") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = quantity, onValueChange = { quantity = it.filter { ch -> ch.isDigit() } },
                            label = { Text("الكمية *") }, singleLine = true, modifier = Modifier.weight(1f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                        )
                        OutlinedTextField(
                            value = weight, onValueChange = { weight = decimalInput(it) },
                            label = { Text("الوزن كجم *") }, singleLine = true, modifier = Modifier.weight(1f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                        )
                    }
                    OutlinedTextField(
                        value = codAmount, onValueChange = { codAmount = decimalInput(it) },
                        label = { Text("قيمة التحصيل / الإجمالي *") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), suffix = { Text("ج.م") }
                    )
                    OutlinedTextField(
                        value = notes, onValueChange = { notes = it },
                        label = { Text("ملاحظات") }, minLines = 2, modifier = Modifier.fillMaxWidth()
                    )

                    if (formError.isNotBlank()) {
                        Text(formError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(
                        "المحافظة والمدينة والمنطقة تُحفظ بالقيم والأكواد الأصلية من دليل J&T، بدون تخمين أو تحويل أسماء.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                HorizontalDivider()
                Button(
                    onClick = {
                        formError = validateOrder(
                            customerName, phone, province, city, area, street, product,
                            quantity, codAmount, weight
                        )
                        if (formError.isNotBlank()) return@Button
                        val selectedProvince = province ?: return@Button
                        val selectedCity = city ?: return@Button
                        val selectedArea = area ?: return@Button
                        val selectedManifest = manifest ?: return@Button
                        val qty = quantity.toIntOrNull() ?: 1
                        val total = codAmount.toDoubleOrNull() ?: 0.0
                        val kg = weight.toDoubleOrNull() ?: 1.0
                        saving = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                KunApi.createOrder(
                                    context,
                                    buildManualOrderPayload(
                                        customerName = customerName,
                                        phone = phone,
                                        phone2 = phone2,
                                        province = selectedProvince,
                                        city = selectedCity,
                                        area = selectedArea,
                                        street = street,
                                        product = product,
                                        quantity = qty,
                                        codAmount = total,
                                        weightKg = kg,
                                        notes = notes,
                                        addressCountryCode = selectedManifest.countryCode
                                    )
                                )
                            }
                            if (result.ok) {
                                withContext(Dispatchers.IO) { KunApi.fetchState(context) }
                                SyncJobService.schedule(context)
                                Toast.makeText(context, "تمت إضافة الأوردر ومزامنته مع المكالمات", Toast.LENGTH_LONG).show()
                                saving = false
                                onCreated()
                            } else {
                                formError = result.message
                                saving = false
                            }
                        }
                    },
                    enabled = !saving && manifest != null,
                    modifier = Modifier.fillMaxWidth().padding(16.dp).height(52.dp)
                ) {
                    if (saving) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("جارٍ تسجيل الأوردر...")
                    } else {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("إضافة الأوردر")
                    }
                }
            }
        }
    }

    if (provincePicker) {
        JntPickerDialog(
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
                addressError = ""
                scope.launch {
                    loadingAddresses = true
                    runCatching { JntAddressRepository.cities(selected) }
                        .onSuccess { cities = it }
                        .onFailure { addressError = "تعذر تحميل مدن ومناطق ${selected.name}." }
                    loadingAddresses = false
                }
            }
        )
    }
    if (cityPicker) {
        JntPickerDialog(
            title = "اختر المدينة / الحي",
            items = cities,
            label = { cityDisplay(it, cities) },
            onDismiss = { cityPicker = false },
            onSelect = { selected -> cityPicker = false; city = selected; area = null }
        )
    }
    if (areaPicker) {
        val areas = city?.areas.orEmpty()
        JntPickerDialog(
            title = "اختر المنطقة",
            items = areas,
            label = { areaDisplay(it, areas) },
            onDismiss = { areaPicker = false },
            onSelect = { selected -> areaPicker = false; area = selected }
        )
    }
}

@Composable
private fun JntChoiceField(label: String, value: String, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Text(label, style = MaterialTheme.typography.labelSmall)
            Text(value.ifBlank { "اضغط للاختيار" }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        }
        Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = null)
    }
}

@Composable
private fun <T> JntPickerDialog(
    title: String,
    items: List<T>,
    label: (T) -> String,
    onDismiss: () -> Unit,
    onSelect: (T) -> Unit
) {
    var search by remember { mutableStateOf("") }
    val filtered = remember(items, search) {
        val q = search.trim()
        if (q.isBlank()) items else items.filter { label(it).contains(q, ignoreCase = true) }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.92f).fillMaxHeight(0.82f),
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
                    itemsIndexed(filtered) { _, item ->
                        TextButton(
                            onClick = { onSelect(item) },
                            modifier = Modifier.fillMaxWidth(),
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)
                        ) {
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

private fun cityDisplay(city: JntCity, all: List<JntCity>): String =
    if (all.count { it.name == city.name } > 1) "${city.name} (${city.code})" else city.name

private fun areaDisplay(area: JntArea, all: List<JntArea>): String =
    if (all.count { it.name == area.name } > 1) "${area.name} (${area.code})" else area.name

private fun decimalInput(value: String): String {
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

private fun validateOrder(
    name: String,
    phone: String,
    province: JntProvince?,
    city: JntCity?,
    area: JntArea?,
    street: String,
    product: String,
    quantity: String,
    codAmount: String,
    weight: String
): String {
    if (name.isBlank()) return "اكتب اسم المستلم"
    if (phone.isBlank()) return "اكتب رقم موبايل المستلم"
    if (province == null) return "اختر المحافظة من قائمة J&T"
    if (city == null) return "اختر المدينة / الحي من قائمة J&T"
    if (area == null) return "اختر المنطقة من قائمة J&T"
    if (street.isBlank()) return "اكتب الشارع والعنوان التفصيلي"
    if (product.isBlank()) return "اكتب اسم المنتج"
    val qty = quantity.toIntOrNull() ?: return "اكتب كمية صحيحة"
    if (qty < 1) return "الكمية لازم تكون 1 على الأقل"
    val total = codAmount.toDoubleOrNull() ?: return "اكتب قيمة التحصيل"
    if (total < 0) return "قيمة التحصيل لا يمكن أن تكون سالبة"
    val kg = weight.toDoubleOrNull() ?: return "اكتب الوزن بالكيلوجرام"
    if (kg <= 0) return "الوزن لازم يكون أكبر من صفر"
    return ""
}

private fun buildManualOrderPayload(
    customerName: String,
    phone: String,
    phone2: String,
    province: JntProvince,
    city: JntCity,
    area: JntArea,
    street: String,
    product: String,
    quantity: Int,
    codAmount: Double,
    weightKg: Double,
    notes: String,
    addressCountryCode: String
): JSONObject {
    val now = Instant.now().toString()
    val jtAddress = JSONObject()
        .put("country", "Egypt")
        .put("countryCode", addressCountryCode.ifBlank { "100000" })
        .put("province", province.name)
        .put("provinceCode", province.code)
        .put("city", city.name)
        .put("cityCode", city.code)
        .put("cityKey", city.key)
        .put("area", area.name)
        .put("areaCode", area.code)
        .put("street", street.trim())
        .put("phone2", phone2.trim())
        .put("weight", weightKg)

    val history = JSONArray().put(
        JSONObject()
            .put("state", "pending")
            .put("at", now)
            .put("event", "manual_android_order")
            .put("jtAddress", jtAddress)
    )
    val fullAddress = listOf(street.trim(), area.name, city.name, province.name)
        .filter { it.isNotBlank() }
        .joinToString("، ")

    return JSONObject()
        .put("date", now)
        .put("name", customerName.trim())
        .put("phone", phone.trim())
        .put("phone2", phone2.trim())
        .put("gov", province.name)
        .put("province", province.name)
        .put("provinceCode", province.code)
        .put("city", city.name)
        .put("cityCode", city.code)
        .put("area", area.name)
        .put("districtCode", area.code)
        .put("areaCode", area.code)
        .put("addressCountryCode", addressCountryCode.ifBlank { "100000" })
        .put("street", street.trim())
        .put("address", fullAddress)
        .put("product", product.trim())
        .put("itemName", product.trim())
        .put("qty", quantity)
        .put("quantity", quantity)
        .put("unitPrice", if (quantity > 0) codAmount / quantity else codAmount)
        .put("total", codAmount)
        .put("codAmount", codAmount)
        .put("weight", weightKg)
        .put("source", "تطبيق كن أونلاين")
        .put("note", notes.trim())
        .put("notes", notes.trim())
        .put("state", "pending")
        .put("history", history)
}
