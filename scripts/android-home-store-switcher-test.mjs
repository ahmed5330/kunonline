import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = name => readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/' + name, import.meta.url), 'utf8');
const api = source('KunApi.kt');
const home = source('KunNativeAppV25.kt');
const service = source('CustomerServiceApi.kt');
const native = source('NativeSectionsApi.kt');
const collaboration = source('MobileCollaboration.kt');
const scope = readFileSync(new URL('../src/store-scope.js', import.meta.url), 'utf8');

for (const endpoint of ['/api/me', '/api/my-client-context', '/api/my-store-context']) {
  assert.ok(api.includes(endpoint), 'Authorized store discovery must use ' + endpoint);
}
assert.match(api, /option\.clientId == choice\.clientId && it\.storeId == choice\.storeId|it\.clientId == choice\.clientId && it\.storeId == choice\.storeId/, 'Validate both client and store identities');
assert.ok(api.includes('SELECTED_STORE_KEY'), 'Persist scoped choice independently of global login');
assert.match(api, /SecureStore\.put\(context, AUTH_PREFS, SELECTED_STORE_KEY, null\)/, 'Clear saved store on session change');
assert.match(api, /MobileSyncClient\.clear\(\)\s*CustomerCache\.clear\(context\)\s*CallActivityStore\.clear\(context\)/, 'Purge previous store caches on switch');
assert.ok(api.includes('preferredClient == clientId && preferredStore in allowed'), 'Revalidate saved store against the live store ACL');
assert.ok(api.includes('scope.storeId')) ;
assert.match(api, /values\.put\("storeId", scope\.storeId\)/, 'Native writes inherit selected store');
assert.ok(home.includes('اختيار المتجر') && home.includes('onSelectStore'), 'Expose store switcher on the native home');
assert.ok(home.includes('performRefresh(true)'), 'Force reload after changing store');
assert.ok(home.includes('storeOptions'), 'Only populate store cards from API options');
assert.ok(service.includes('KunApi.resolveScope(cookie, context).storeId'), 'Customer Service follows selected store');
assert.ok(native.includes('KunApi.resolveScope(cookie, context)'), 'Other native modules follow selected store');
assert.ok(collaboration.includes('KunApi.loadStoreOptions(context)')&&collaboration.includes('result.current.clientId')&&collaboration.includes('result.current.storeId'),'Collaboration follows the selected store from authorised options');
assert.ok(collaboration.includes('result.stores.singleOrNull()')&&collaboration.includes('selectedStore == null ->'),'Multi-store chat must prompt before showing any conversation');
assert.ok(!collaboration.includes('KunApi.resolveScope(cookie, context)'),'Chat must never pick an arbitrary first store');
assert.ok(scope.includes('user_store_access') && scope.includes('STORE_ISOLATION'), 'Backend must enforce store ACL');
const dates = source('MobileDateFilterV267.kt');
const models = source('CommerceModels.kt');
assert.match(dates, /var preset by mutableStateOf\(MobileDatePreset\.ALL\)/, 'Dashboard must not default to an empty today filter');
assert.match(dates, /if \(preset == MobileDatePreset\.ALL\) return true/, 'Full-range orders include legacy dates');
assert.match(models, /filterOrders\(allOrders\)/, 'Period filter is on the UI, not the source snapshot');
assert.match(home, /rawOrderCount > 0/, 'Explain when selected period hides existing orders');
assert.match(home, /V25StatusTile\(status, countBase, dataReady/, 'State counters must be equal square tiles');
assert.match(home, /aspectRatio\(1f\)/, 'Home number cards must stay square');
assert.match(home, /syncError = result\.message/, 'Network errors must not appear as genuine zero totals');
assert.match(api, /if \(selectedStore == null && \(active\.storeId\.isNotBlank\(\) \|\| selected != null\)\)/, 'Persist verified store only when it changes; keep legitimate all-store scope');
assert.match(api, /if \(root\.optJSONArray\("orders"\) == null\)/, 'Reject malformed state without order array');
console.log('Android home store-switcher contract: permissions, switching, isolation and sync PASS.');
