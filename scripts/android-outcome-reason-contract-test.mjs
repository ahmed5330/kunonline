import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeOutcomeReason} from '../src/order-outcome-reason.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

assert.equal(normalizeOutcomeReason({cancelReason:'  الرقم غلط  '},'cancelled'),'الرقم غلط',
  'Existing Android cancellation text must not be discarded');
assert.equal(normalizeOutcomeReason({reason:'العنوان غير صحيح'},'cancelled'),'العنوان غير صحيح',
  'Browser client cancellation reason remains supported');
assert.equal(normalizeOutcomeReason({outcomeReason:'المقاس غير مناسب'},'cancelled'),'المقاس غير مناسب',
  'Legacy outcome reason remains supported');
assert.equal(normalizeOutcomeReason({cancelReason:' ',reason:'عميل طلب الإلغاء'},'cancelled'),'عميل طلب الإلغاء',
  'Blank aliases must not shadow a populated reason');
assert.equal(normalizeOutcomeReason({reason:'استبدال المقاس'},'returned'),'استبدال المقاس');
assert.equal(normalizeOutcomeReason({cancelReason:'wrong lifecycle'},'returned'),'',
  'A cancellation field cannot silently authorize a return');
assert.equal(normalizeOutcomeReason({note:'customer-entered note'},'cancelled'),'',
  'A customer note is never silently used as the mandatory employee reason');

const preview=read('src/index-commerce-v35.js');
const prod=read('src/production-customer-service.js');
const native=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceApi.kt');
const modal=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceMobileV23.kt');
const caller=read('android/app/src/main/java/com/kunonline/callerid/CallerCardActivity.kt');
assert.match(preview,/const reason=normalizeOutcomeReason\(body,state\)/,
  'Preview validation must recognize the Android cancellation field');
assert.match(preview,/reason\.length<2/,'The server must continue to require a real reason');
assert.match(preview,/outcomeReason:reason/,'Preview must save the reason for reporting and history');
assert.match(preview,/persistOutcomeReason\(/,'Preview must create the audited outcome record');
assert.match(prod,/const cancelReason=normalizeOutcomeReason\(body,state\)/,
  'Production must use the same canonical outcome reason parser');
assert.match(prod,/CANCEL_REASON_REQUIRED/,'Production must reject empty cancellations');
assert.match(prod,/reason:state==='cancelled'\?cancelReason:null/,
  'Cancellation reason must be present in the staff audit event');
assert.match(native,/payload\.put\("cancelReason", reason\)/,'Native endpoint alias required');
assert.match(native,/\.put\("reason", reason\)/,'Legacy Preview expects reason');
assert.match(native,/\.put\("outcomeReason", reason\)/,'Legacy outcome handler expects outcomeReason');
assert.match(native,/state == "cancelled" && cancelReason\.isBlank\(\)/,
  'Native must not permit blank cancellation');
assert.match(modal,/cancelReason\s*,\s*onValueChange\s*=\s*\{ cancelReason = it \}/,
  'Customer Service detail uses the reason input');
assert.match(caller,/cancelReason = reason/,'Floating call overlay also sends a reason');
assert.match(read('android/app/build.gradle.kts'),/versionCode = 146[\s\S]*versionName = "2\.9\.15"/,
  'Release APK must be a newer version');
console.log('PASS: Android v2.9.15 sends explicit cancellation reason compatible with Preview and Production; staff audit preserved.');
