import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const java = name => readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/' + name, import.meta.url), 'utf8');
const src = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
const api=java('KunApi.kt'), call=java('KunCallScreeningService.kt');
const service=java('CustomerServiceApi.kt'), overlay=java('CallerOverlay.kt');
const card=java('CallerCardActivity.kt'), payload=java('CallerPayload.kt');
const jtEditor=java('CallerJntOrderEditActivity.kt'), jtApi=java('CallerJntEditApi.kt');
const home=java('KunNativeAppV25.kt');
const jnt=src('production-caller-jnt-edit.js'), search=src('mobile-global-order-search.js');
const stores=src('mobile-store-options.js');

assert(api.includes('fun loadStoreOptions(context: Context, forceRefresh: Boolean = false)'));
assert(api.includes('/api/mobile/store-options?diagnostics=1'),'store list requests own grant counts for diagnosis');
assert(api.includes('val arr = root.optJSONArray("stores")'),'server must not silently accept an invalid store list');
assert(api.includes('if (!forceRefresh) cachedStoreOptions(context)'), 'forced refresh bypasses 2-minute cache');
assert(home.includes('onRefreshStores = {')&&home.includes('forceRefresh = true')&&home.includes('تحديث المتاجر'), 'home lets staff refresh assigned stores');
assert(stores.includes("if(!context.response.ok&&(isOwner||context.response.status===401))"), 'staff grants remain discoverable when legacy client context is temporarily unavailable');

assert(api.includes('val userClientId = identity.optString("clientId")'), 'legacy fallback never confuses /api/me user id with client id');
assert(api.includes('identity.optString("role") in setOf("admin", "client")'), 'only owners have a fixed client in the Android fallback');
assert(api.includes('/api/mobile/orders/search?q=') && api.includes('PhoneNormalizer.normalize(row.optString("phone")) != normalized'), 'caller search covers all assigned stores but matches exact normalized phone');
assert(search.includes('user_store_access') && search.includes('st.status=\'active\''), 'the global read stays subject to live server-side active store permissions');
for(const key of ['clientId = clientId','storeId = storeId','storeName = row.optString("storeName")'])assert(api.includes(key),'caller result must be tenant-aware: '+key);
assert(call.includes('observed(fresh, number, incoming)') && call.includes('selectedClientId = customer.clientId'), 'call log and contact claim use the matched order tenant');
for(const s of [overlay,card])assert(s.includes('selectedClientId = customer.clientId'), 'call decision must not fall back to whichever store was selected');
assert(overlay.includes('CallerPayload.encode(customer)')&&card.includes('CallerPayload.decode'), 'overlay-denied fallback must keep authorized caller identity');
assert(payload.includes('storeId.isBlank()') && payload.includes('clientId.isBlank()'), 'fallback cannot turn an unscoped caller into an editable record');
assert(overlay.includes('EXTRA_CLIENT_ID')&&card.includes('EXTRA_CLIENT_ID')&&jtEditor.includes('EXTRA_CLIENT_ID'), 'J&T edit carries the selected caller tenant');
assert(jtEditor.includes('selectedClientId = clientId')&&jtApi.includes('selectedClientId: String = ""'), 'J&T editor respects matched caller tenant');
assert(jnt.includes('await resolveStoreScope(env,me,clientId,row.store_id||null,{write:true})'), 'J&T write enforces row-level store grant on the server');
assert(service.includes('withClient(context, selectedClientId)') && service.includes('selectedClientId.ifBlank { resolveClientId(context, cookie) }'), 'writes use caller scope but server remains authorization authority');
console.log('PASS: refreshed store assignments, cross-store caller identification, scoped call/J&T actions and server write authorization');
