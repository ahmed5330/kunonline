import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(f)=>readFileSync(f,'utf8');
const overlay=read('android/app/src/main/java/com/kunonline/callerid/CallerOverlay.kt');
const fallback=read('android/app/src/main/java/com/kunonline/callerid/CallerCardActivity.kt');
const board=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceMobileV23.kt');
const client=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceApi.kt');
const server=read('src/production-customer-service.js');
const claims=read('src/operational-workflow-v105.js');
for(const src of [overlay,fallback]){
  assert.match(src, /decision\([^)]*orderId, "cancelled"\)/);

  assert.match(src,/العميل\\nلغى/,'call overlay must show customer cancelled');
  assert.match(src,/CallerJntOrderEditActivity.EXTRA_SHIPPING_ONLY/,'J&T editor must remain');
}
assert.match(overlay,/putExtra\("start_cancel", true\)/,'overlay routes cancellation to the editable reason dialog');
assert.match(fallback,/تأكيد الإلغاء/,'fallback requires explicit cancellation confirmation');
assert.match(board,/mutableStateOf\("pending"\)/,'pending is the default tab');
assert.match(board,/ForegroundPolling\(storeFilter to stateFilter/,'switching tabs must fetch from API');
assert.match(board,/Status tabs are ALWAYS visible/);
for(const status of ['pending','contacting','no_answer','confirmed','shipped','deferred','cancelled','returned']){
  assert.ok(board.includes('"'+status+'" to '),'missing distinct status tab '+status);
}
assert.match(client,/append\("&state=\$\{enc\(state\)\}"\)/,'server must receive explicit status');
assert.match(server,/state==='contacting'/,'separate active contact list');
assert.match(server,/state==='pending'/,'default pending must exclude active calls');
assert.match(server,/contact_claim_user_id IS NULL OR contact_claim_user_id=''/,'unclaimed waiting filter');
assert.match(server,/state&&state!=='all'/,'server-side status filter');
for(const source of [server,claims]){
  assert.ok(source.includes("'confirmed','no_answer','cancelled'"),'cancelled must resolve an active call');
  assert.match(source,/CONTACT_DECISION_REQUIRED/,'must block unrelated state transitions');
  assert.match(source,/CONTACT_OWNED_BY_OTHER/,'must respect other agents claims');
}
assert.match(server,/byUserId:me\.uid\|\|(me\.id\|\|)?null/,'record actor on state transition');

assert.match(server,/CANCEL_REASON_REQUIRED/,'server must reject cancellation without a reason');
assert.match(client,/cancelReason: String = ""/,'Android must pass a cancellation reason');
assert.match(fallback,/showCancelReason\(orderId, customer\.clientId\)/,'call card must provide a cancellation reason input scoped to the customer tenant');
assert.match(board,/سجل المكالمات المرصودة/,'call logs must be visible in customer service');
assert.match(server,/intent==='screened'/,'call counts must distinguish observed calls');
console.log('PASS: android cancellation reason, screened call logs, separate queues and audit contract');
