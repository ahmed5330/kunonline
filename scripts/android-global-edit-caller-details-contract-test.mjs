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
assert(search.includes('تعديل الملاحظات'), 'shipped/COD orders should expose the safe notes-only action');
assert(edit.includes('payload.put("editMode", "notes")'), 'notes-only mode must be explicit to the server');
assert(service.includes('ORDER_EDIT_SHIPMENT_LOCKED') && service.includes('ORDER_EDIT_CONFLICT'), 'server must reject unsafe shipped edits and concurrent writes');
assert(edit.includes('selectedClientId = clientId'), 'editor loads exact searched tenant');
assert(edit.includes('selectedClientId = data.clientId'), 'editor saves only the tenant returned by verified details');
assert.match(api, /fetchEditorData\(context: Context, orderId: String, selectedStoreId: String = "", requireHistory: Boolean = false, selectedClientId: String = ""\)/);
assert(api.includes('if (selectedStoreId.isNotBlank()) payload.put("storeId", selectedStoreId)'), 'include store for ACL on writes');

// The tiny floating call overlay must not expose the old raw "full details" block.
assert(caller.includes('renderCallerProductSummary'), 'overlay renders only compact product lines');
assert(!caller.includes('renderCallerFullDetails('), 'overlay must not show raw full details');
assert(caller.includes('heightPixels / 2'), 'overlay height must be at most half the screen');
assert(caller.includes('putExtra("start_note", true)'), 'call overlay must provide quick notes');
assert(caller.includes('text = if (locked) "عميل كن أونلاين"'), 'lock screen must conceal customer names');
assert(caller.includes('if (!locked) line(customer.phone'), 'lock screen must conceal customer phone');
assert(caller.includes('if (!locked) line(orderBits'), 'lock screen must conceal order status');
assert(caller.includes('Intent.ACTION_SCREEN_OFF'), 'screen-off must invalidate visible call overlay');
assert(caller.includes('app.registerReceiver(receiver, filter)'), 'screen privacy receiver must be registered');
assert(caller.includes('addAction(Intent.ACTION_SCREEN_ON)'), 'proximity wake must restore an unlocked overlay');
assert(caller.includes('card.visibility = View.INVISIBLE'), 'screen-off must conceal the visible overlay');
assert(caller.includes('if (isLocked) dismiss() else card.visibility = View.VISIBLE'), 'only an unlocked wake may restore caller details');
assert(caller.includes('receiverContext.unregisterReceiver(receiver)'), 'privacy receiver must be cleaned up');
assert(caller.includes('dismiss()'), 'screen-off must dismiss call overlay');
assert(details.includes('internal fun renderCallerProductSummary'), 'structured item renderer must exist');
assert(details.includes('optJSONArray("options")'), 'product summary must include color/size options');
assert(fallback.includes('renderCallerFullDetails'), 'full protected details remain available outside overlay');
assert(fallback.includes('start_note'), 'fallback note composer must remain accessible');
assert(fallback.includes('setShowWhenLocked(false)'), 'fallback activity must not cover Keyguard');
assert(fallback.includes('text = if (locked) "عميل كن أونلاين"'), 'fallback must conceal customer name while locked');
assert(fallback.includes('if (!locked) addLine(customer.phone'), 'fallback must conceal customer phone while locked');
for (const ui of [caller, fallback]) {
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
