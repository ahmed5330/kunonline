import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');
const ui=read('android/app/src/main/java/com/kunonline/callerid/GlobalOrderSearch.kt');
const api=read('src/mobile-global-order-search.js');
const build=read('android/app/build.gradle.kts');

for (const field of ['o.date','o.created_at AS createdAt','o.state','o.product','o.name','o.phone','o.store_id AS storeId']) {
  assert.ok(api.includes(field), 'global search API must return '+field);
}
assert.ok(ui.includes('date = row.optString("date").ifBlank { row.optString("createdAt") }'),
  'use creation date as fallback when the original order date is absent');
assert.ok(ui.includes('product = row.optString("product")'), 'parse order product');
assert.ok(ui.includes('state = row.optString("state")'), 'parse customer status');
assert.match(ui,/Text\("تاريخ الطلب: \$\{globalSearchOrderDate\(order\.date\)\}"/,
  'search card must render the order date');
assert.match(ui,/Text\("المنتج: \$\{order\.product\.ifBlank \{ "غير مسجل" \}\}"/,
  'search card must render the product with explicit empty fallback');
assert.match(ui,/Text\("حالة العميل: \$\{globalSearchCustomerStatus\(order\.state\)\}"/,
  'search card must show localized customer status');
for (const [code,label] of Object.entries({
  pending:'في انتظار التأكيد', contacting:'جاري التواصل',
  no_answer:'العميل لا يرد', confirmed:'تم التأكيد',
  preparing:'التجهيز والتغليف', shipped:'جاري الشحن',
  signed:'تم التسليم — تحصيل منتظر',
  collected:'تم التحصيل', cancelled:'ملغي', returned:'مرتجع'
})) {
  assert.ok(ui.includes('"'+code+'"') && ui.includes('"'+label+'"'), 'Arabic state mapping missing: '+code);
}
assert.ok(ui.includes('globalSearchReadableRef(order.ref)'), 'suppress unwieldy imported UUID in result card');
assert.ok(ui.includes('putExtra(CallerOrderEditActivity.EXTRA_CLIENT_ID, order.clientId)'),
  'search detail edit must preserve target tenant');
assert.ok(ui.includes('putExtra(CallerOrderEditActivity.EXTRA_STORE_ID, order.storeId)'),
  'search detail edit must preserve target store');
assert.match(build,/versionCode\s*=\s*152\b/);
assert.match(build,/versionName\s*=\s*"2\.9\.21"/);
console.log('PASS: search result card and order dialog render product, date and Arabic customer status with safe scoped edit');
