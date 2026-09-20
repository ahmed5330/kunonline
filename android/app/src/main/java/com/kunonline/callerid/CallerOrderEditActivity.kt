package com.kunonline.callerid

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class CallerOrderEditActivity : ComponentActivity() {
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
                    CallerOrderEditScreen(orderId = orderId, onClose = { finish() })
                }
            }
        }
    }

    companion object {
        const val EXTRA_ORDER_ID = "kun_order_id"
    }
}

private data class CallerEditItem(
    val productId: String,
    val variantId: String,
    val productName: String,
    val variantLabel: String,
    val sku: String,
    val qty: Int,
    val unitPrice: Double
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CallerOrderEditScreen(orderId: String, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<CustomerServiceEditorData?>(null) }

    LaunchedEffect(orderId) {
        val result = withContext(Dispatchers.IO) { KunCustomerServiceApi.fetchEditorData(context, orderId) }
        loading = false
        if (result.ok) data = result else error = result.message
    }

    when {
        loading -> Scaffold(
            containerColor = KunColors.Ground,
            topBar = { CallerEditorTopBar(onClose) }
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(color = KunColors.Pine)
                    Text("جاري تحميل بيانات الطلب...", color = KunColors.Ink2)
                }
            }
        }
        data == null -> Scaffold(
            containerColor = KunColors.Ground,
            topBar = { CallerEditorTopBar(onClose) }
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(color = KunColors.BrickSoft, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
                    Text(error.ifBlank { "تعذر تحميل بيانات الطلب" }, color = KunColors.Brick, modifier = Modifier.padding(14.dp))
                }
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("إغلاق") }
            }
        }
        else -> CallerOrderEditorContent(orderId, data!!, onClose)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CallerEditorTopBar(onClose: () -> Unit) {
    TopAppBar(
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = KunColors.Chrome,
            titleContentColor = Color.White,
            navigationIconContentColor = Color.White
        ),
        title = {
            Column {
                Text("تعديل طلب العميل", fontWeight = FontWeight.Bold)
                Text("كن أونلاين", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .72f))
            }
        },
        navigationIcon = { TextButton(onClick = onClose) { Text("إغلاق", color = Color.White) } }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CallerOrderEditorContent(orderId: String, data: CustomerServiceEditorData, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val details = data.details
    val order = remember(data) { details.optJSONObject("order") ?: JSONObject() }
    val customer = remember(data) { details.optJSONObject("customer") ?: JSONObject() }
    val address = remember(data) { details.optJSONObject("address") ?: JSONObject() }
    val catalog = remember(data) { callerParseCatalog(data.catalog) }
    val items = remember(data) { mutableStateListOf<CallerEditItem>().apply { addAll(callerInitialItems(details)) } }

    var name by remember(data) { mutableStateOf(customer.optString("name")) }
    var phone by remember(data) { mutableStateOf(customer.optString("phone")) }
    var gov by remember(data) { mutableStateOf(address.optString("government").ifBlank { customer.optString("government") }) }
    var deliveryAddress by remember(data) { mutableStateOf(address.optString("address").ifBlank { customer.optString("address") }) }
    var couponCode by remember(data) { mutableStateOf(order.optString("couponCode")) }
    var customerNote by remember(data) { mutableStateOf(order.optString("customerNote")) }
    var totalText by remember(data) { mutableStateOf((details.optJSONObject("summary")?.optDouble("total", 0.0) ?: 0.0).toString()) }
    var saving by remember { mutableStateOf(false) }

    fun recalc() {
        totalText = items.sumOf { it.qty.coerceAtLeast(1) * it.unitPrice.coerceAtLeast(0.0) }.toString()
    }

    fun save() {
        if (saving) return
        if (name.isBlank() || phone.isBlank() || items.any { it.productName.isBlank() }) {
            Toast.makeText(context, "الاسم والهاتف واسم كل منتج مطلوبة", Toast.LENGTH_LONG).show()
            return
        }
        val payload = JSONObject()
            .put("name", name.trim())
            .put("phone", phone.trim())
            .put("gov", gov.trim())
            .put("address", deliveryAddress.trim())
            .put("couponCode", couponCode.trim())
            .put("customerNote", customerNote.trim())
            .put("total", totalText.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0)
            .put("items", JSONArray().apply {
                items.forEach { item ->
                    put(JSONObject()
                        .put("productId", item.productId)
                        .put("variantId", item.variantId)
                        .put("productName", item.productName.trim())
                        .put("variantLabel", item.variantLabel.trim())
                        .put("sku", item.sku)
                        .put("qty", item.qty.coerceAtLeast(1))
                        .put("unitPrice", item.unitPrice.coerceAtLeast(0.0)))
                }
            })
        saving = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { KunCustomerServiceApi.editOrder(context, orderId, payload) }
            saving = false
            Toast.makeText(context, result.message, if (result.ok) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
            if (result.ok) {
                withContext(Dispatchers.IO) { KunApi.syncWithStoredSession(context) }
                onClose()
            }
        }
    }

    Scaffold(
        containerColor = KunColors.Ground,
        topBar = { CallerEditorTopBar(onClose) },
        bottomBar = {
            Surface(color = KunColors.Surface, shadowElevation = 10.dp) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(onClick = onClose, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Text("إلغاء")
                    }
                    Button(onClick = { save() }, enabled = !saving, modifier = Modifier.weight(2f).heightIn(min = 52.dp)) {
                        if (saving) {
                            CircularProgressIndicator(Modifier.size(19.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(if (saving) "جاري الحفظ..." else "حفظ التعديلات", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Surface(color = KunColors.ChromeSoft, shape = KunRadius, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text("الطلب #${order.optString("ref").ifBlank { orderId }}", fontWeight = FontWeight.Bold, color = KunColors.Chrome)
                    Text("عدّل البيانات ثم احفظ من الشريط الثابت أسفل الشاشة", style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
                }
            }

            KunSectionCard(Modifier.fillMaxWidth()) {
                Text("بيانات العميل والتوصيل", style = MaterialTheme.typography.titleMedium)
                CallerEditField(name, { name = it }, "اسم العميل")
                CallerEditField(phone, { phone = it }, "رقم الهاتف", KeyboardType.Phone)
                CallerEditField(gov, { gov = it }, "المحافظة")
                CallerEditField(deliveryAddress, { deliveryAddress = it }, "العنوان")
            }

            KunSectionCard(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("منتجات الطلب", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = { items.add(CallerEditItem("", "", "", "", "", 1, 0.0)) }) { Text("+ إضافة منتج") }
                }
                items.forEachIndexed { index, item ->
                    CallerEditItemCard(
                        item = item,
                        catalog = catalog,
                        canRemove = items.size > 1,
                        onChange = { updated -> items[index] = updated; recalc() },
                        onRemove = { if (items.size > 1) { items.removeAt(index); recalc() } }
                    )
                }
            }

            KunSectionCard(Modifier.fillMaxWidth()) {
                Text("الخصم والإجمالي والملاحظات", style = MaterialTheme.typography.titleMedium)
                CallerEditField(couponCode, { couponCode = it }, "كود الخصم")
                CallerEditField(totalText, { totalText = it }, "إجمالي الطلب", KeyboardType.Decimal)
                OutlinedTextField(
                    value = customerNote,
                    onValueChange = { customerNote = it },
                    label = { Text("ملاحظة العميل على الطلب") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    shape = KunRadius
                )
                Text("كل تعديل يُسجل في سجل الأوردر بنفس آلية خدمة العملاء في السيستم.", style = MaterialTheme.typography.bodySmall, color = KunColors.Ink2)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun CallerEditItemCard(
    item: CallerEditItem,
    catalog: List<CsCatalogProduct>,
    canRemove: Boolean,
    onChange: (CallerEditItem) -> Unit,
    onRemove: () -> Unit
) {
    var productMenu by remember { mutableStateOf(false) }
    var variantMenu by remember { mutableStateOf(false) }
    val selectedProduct = catalog.find { it.id == item.productId }
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = KunColors.Surface2),
        shape = KunRadius
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                OutlinedButton(onClick = { productMenu = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(selectedProduct?.name ?: item.productName.ifBlank { "اختر منتج أو اكتب يدويًا" })
                }
                DropdownMenu(expanded = productMenu, onDismissRequest = { productMenu = false }) {
                    DropdownMenuItem(text = { Text("منتج يدوي") }, onClick = {
                        productMenu = false
                        onChange(item.copy(productId = "", variantId = "", variantLabel = "", sku = ""))
                    })
                    catalog.forEach { product ->
                        DropdownMenuItem(text = { Text(product.name) }, onClick = {
                            productMenu = false
                            onChange(item.copy(productId = product.id, variantId = "", productName = product.name, variantLabel = "", sku = product.sku, unitPrice = product.price))
                        })
                    }
                }
            }
            if (selectedProduct?.variants?.isNotEmpty() == true) {
                Box {
                    OutlinedButton(onClick = { variantMenu = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(item.variantLabel.ifBlank { "اختر اللون / المقاس / الاختيار" })
                    }
                    DropdownMenu(expanded = variantMenu, onDismissRequest = { variantMenu = false }) {
                        DropdownMenuItem(text = { Text("بدون اختيار") }, onClick = {
                            variantMenu = false
                            onChange(item.copy(variantId = "", variantLabel = "", sku = selectedProduct.sku))
                        })
                        selectedProduct.variants.forEach { variant ->
                            DropdownMenuItem(text = { Text(variant.name) }, onClick = {
                                variantMenu = false
                                onChange(item.copy(variantId = variant.id, variantLabel = variant.name, sku = variant.sku.ifBlank { selectedProduct.sku }, unitPrice = variant.price ?: selectedProduct.price))
                            })
                        }
                    }
                }
            }
            CallerEditField(item.productName, { onChange(item.copy(productName = it)) }, "اسم المنتج / وصف يدوي")
            CallerEditField(item.variantLabel, { onChange(item.copy(variantLabel = it)) }, "اللون / المقاس / الاختيار")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = item.qty.toString(),
                    onValueChange = { onChange(item.copy(qty = it.toIntOrNull()?.coerceAtLeast(1) ?: 1)) },
                    label = { Text("الكمية") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f), singleLine = true, shape = KunRadius
                )
                OutlinedTextField(
                    value = item.unitPrice.toString(),
                    onValueChange = { onChange(item.copy(unitPrice = it.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0)) },
                    label = { Text("سعر الوحدة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f), singleLine = true, shape = KunRadius
                )
            }
            if (canRemove) TextButton(onClick = onRemove, modifier = Modifier.align(Alignment.End)) { Text("حذف البند", color = KunColors.Brick) }
        }
    }
}

@Composable
private fun CallerEditField(value: String, onValue: (String) -> Unit, label: String, keyboard: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        singleLine = true,
        shape = KunRadius
    )
}

private fun callerInitialItems(details: JSONObject): List<CallerEditItem> {
    val array = details.optJSONArray("items") ?: JSONArray()
    val list = buildList {
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            add(CallerEditItem(
                productId = item.optString("productId"),
                variantId = item.optString("variantId"),
                productName = item.optString("name").ifBlank { item.optString("productName") },
                variantLabel = item.optString("variantName").ifBlank { item.optString("note") }.ifBlank { item.optString("variantLabel") },
                sku = item.optString("variantSku").ifBlank { item.optString("sku") },
                qty = item.optInt("quantity", item.optInt("qty", 1)).coerceAtLeast(1),
                unitPrice = item.optDouble("price", item.optDouble("unitPrice", 0.0)).coerceAtLeast(0.0)
            ))
        }
    }
    return if (list.isEmpty()) listOf(CallerEditItem("", "", "", "", "", 1, 0.0)) else list
}

private fun callerParseCatalog(array: JSONArray): List<CsCatalogProduct> = buildList {
    for (i in 0 until array.length()) {
        val product = array.optJSONObject(i) ?: continue
        val variants = buildList {
            val values = product.optJSONArray("variants") ?: JSONArray()
            for (j in 0 until values.length()) {
                val variant = values.optJSONObject(j) ?: continue
                if (variant.has("active") && !variant.optBoolean("active", true)) continue
                val rawPrice = variant.opt("price")
                val price = if (rawPrice == null || rawPrice == JSONObject.NULL) null else rawPrice.toString().toDoubleOrNull()
                add(CsCatalogVariant(variant.optString("id"), variant.optString("name"), variant.optString("sku"), price))
            }
        }
        add(CsCatalogProduct(product.optString("id"), product.optString("name"), product.optString("sku"), product.optDouble("price", 0.0), variants))
    }
}
