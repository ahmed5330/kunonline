import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const cs = source('android/app/src/main/java/com/kunonline/callerid/CustomerServiceMobileV23.kt');
const app = source('android/app/src/main/java/com/kunonline/callerid/KunNativeAppV25.kt');
const dates = source('android/app/src/main/java/com/kunonline/callerid/MobileDateFilterV267.kt');
const editor = source('android/app/src/main/java/com/kunonline/callerid/CallerJntOrderEditActivity.kt');
const api = source('android/app/src/main/java/com/kunonline/callerid/CallerJntEditApi.kt');
const service = source('android/app/src/main/java/com/kunonline/callerid/CustomerServiceApi.kt');
const gradle = source('android/app/build.gradle.kts');

for (const fragment of [
  'onEditShipping = { openCustomerServiceJntEditor(context, order.id, order.storeId) }',
  'onEditShipping: () -> Unit',
  'CallerJntOrderEditActivity.EXTRA_SHIPPING_ONLY, true',
  'CallerJntOrderEditActivity.EXTRA_STORE_ID, storeId',
  'v23CanEditShipping(order.awb, order.state)',
  'v23VisibleOrderRef(order.ref, order.source)',
  'filtersExpanded by remember',
  'if (filtersExpanded) {'
]) assert.ok(cs.includes(fragment), 'Missing customer-service behavior: ' + fragment);
const card = cs.split('private fun V23CustomerServiceCard(')[1].split('private fun V23OrderDetailDialog(')[0];
assert.ok(!card.includes('"#${order.ref}"'), 'Customer service must not show original long Easy Orders ID');
assert.ok(card.includes('safeRef.isNotBlank()'), 'Do not leave an empty # when the reference is hidden');
assert.ok(cs.includes('order.ref, order.product'), 'Full reference must remain searchable');

assert.ok(app.includes('onClick = { selected = MobileV25Tab.CUSTOMER_SERVICE }'));
assert.ok(app.includes('label = { Text("الأقسام") }'));
assert.ok(app.includes('contentDescription = "خدمة العملاء"'));
assert.ok(app.includes('MobileDateFilterBar(compact = selected == MobileV25Tab.CUSTOMER_SERVICE)'));
assert.ok(app.includes('onEditShipping = { openCustomerServiceJntEditor(context, order.id, order.storeId) }'));
assert.ok(dates.includes('compact: Boolean = false'));
assert.ok(dates.includes('DropdownMenu(expanded = expanded'));

assert.ok(editor.includes('KunCustomerServiceApi.fetchEditorData(context, orderId, storeId, requireHistory = shippingOnly, selectedClientId = clientId)'), 'J&T editor must use the tenant associated with the call or selected order');
assert.ok(editor.includes('CallerJntEditApi.saveShipping(context, orderId, storeId.ifBlank'));
assert.ok(service.includes('selectedStoreId: String = "", requireHistory: Boolean = false'));
assert.ok(service.includes('if (requireHistory && historyResponse.code !in 200..299)'));
assert.ok(editor.includes('callerJntLastShippingEditAt(editorData?.historyOrder?.optJSONArray("history"))'));
assert.ok(cs.includes('v23OrderEditLabel(edited)'));
assert.ok(cs.includes('V23DetailRow("آخر تعديل", v23OrderEditLabel(it))'));
assert.ok(service.includes('val storeParam = if (selectedStoreId.isBlank())'));
assert.ok(api.includes('/shipping-jnt'));
assert.ok(!api.includes('authorized.stores.none'), 'Local store-list fetch must not gate server-authorized edits');
const buildCode = Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
const patchVersion = Number(gradle.match(/versionName\s*=\s*"2\.9\.(\d+)"/)?.[1] || 0);
assert.ok(buildCode >= 141 && patchVersion >= 10, 'Must preserve the minimum previously verified Android version');
console.log('Customer service compact UX, visible J&T actions, reference hiding and secure scoped editor verified.');
