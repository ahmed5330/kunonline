import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = name => readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/' + name, import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/mobile-store-options.js', import.meta.url), 'utf8');
const search = source('GlobalOrderSearch.kt');
const edit = source('CallerOrderEditActivity.kt');
const api = source('CustomerServiceApi.kt');
const caller = source('CallerOverlay.kt');
const fallback = source('CallerCardActivity.kt');
const cache = source('CustomerCache.kt');
const live = source('KunApi.kt');
const details = source('CallerFullDetailsView.kt');
const service = readFileSync(new URL('../src/production-customer-service.js', import.meta.url), 'utf8');

assert.match(store, /user_store_access a JOIN stores s/, 'visible employee stores must come from server-owned ACL');
assert.match(store, /if\(isOwner\&\&!allowed\.has\(clientId\)\)continue/, 'owners remain tenant isolated; support uses exact grants');
assert.match(store, /clientName:allowed\.get\(clientId\)\|\|clientId/, 'legacy client context is an optional label, not staff grant');

for (const key of ['EXTRA_CLIENT_ID','EXTRA_STORE_ID','EXTRA_ORDER_ID']) {
  assert(search.includes('CallerOrderEditActivity.' + key), 'search must send ' + key);
  assert(edit.includes(key), 'editor must consume ' + key);
}
assert(search.includes('تعديل الطلب'), 'search has an edit action');
assert(search.includes('order.state in setOf("pending", "no_answer", "confirmed", "preparing", "deferred")'), 'immutable shipped/COD orders cannot enter regular edit');
assert(edit.includes('selectedClientId = clientId'), 'editor loads exact searched tenant');
assert(edit.includes('selectedClientId = data.clientId'), 'editor saves only the tenant returned by verified details');
assert.match(api, /fetchEditorData\(context: Context, orderId: String, selectedStoreId: String = "", requireHistory: Boolean = false, selectedClientId: String = ""\)/);
assert(api.includes('if (selectedStoreId.isNotBlank()) payload.put("storeId", selectedStoreId)'), 'include store for ACL on writes');

for (const ui of [caller, fallback]) {
  assert(ui.includes('renderCallerFullDetails'), 'call panel renders live details');
  assert(ui.includes('fetchOrderDetails'), 'call panel fetches server details');
  assert(ui.includes('stillUnlocked'), 'do not reveal live details after phone locks');
  assert(ui.includes('ScrollView'), 'long details must be scrollable');
}
assert(api.includes('KunApi.sessionCookie(context) != cookie'), 'avoid stale session after network call');
assert(cache.includes('.put("clientId", latest.optString("clientId"))'), 'caller cached scope is retained');
assert(live.includes('clientId = scope.clientId'), 'caller live scope comes from authenticated API');
for(const key of ['couponCode','shippingCost','otherCost','variantName','unitPrice','awb','customerNote']) {
  assert(details.includes(key), 'call card field missing: ' + key);
}
assert(service.includes('FROM order_items WHERE order_id=? AND client_id=?'), 'complete details are tenant-bound');
assert(service.includes('items=results.map'), 'complete details include multiple order lines');
console.log('PASS: tester stores, tenant/store-scoped global edits, complete private live call details');
