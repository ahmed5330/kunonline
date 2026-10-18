import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const expect=(s,term,label)=>assert.ok(s.includes(term),label+': '+term);
const deny=(s,term,label)=>assert.ok(!s.includes(term),label+': '+term);
const filter=read('public/v2/modules-v109-operational-date-contact.js');
const board=read('public/v2/modules-v31-customer-service.js');
const claims=read('src/operational-workflow-v105.js');
const production=read('src/production-customer-service.js');
const native=read('android/app/src/main/java/com/kunonline/callerid/CallerOverlay.kt');
const nativeFallback=read('android/app/src/main/java/com/kunonline/callerid/CallerCardActivity.kt');
const screening=read('android/app/src/main/java/com/kunonline/callerid/KunCallScreeningService.kt');
const service=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceApi.kt');
const api=read('android/app/src/main/java/com/kunonline/callerid/KunApi.kt');
const build=read('android/app/build.gradle.kts');
deny(filter,'scheduleRelease(id,2500)','do not release contact shortly after manual contact');
deny(filter,'scheduleRelease(id,300000)','do not release contact on arbitrary call timeout');
deny(filter,"window.addEventListener('focus',finishCall)",'no release on call focus');
expect(filter,'syncToolbar(bar,view)','filter selection syncs on every apply');
expect(filter,"button.setAttribute?.('aria-pressed',String(on))",'accessible selected filter');
expect(board,'renderQueued=true','board must not drop filter selection while loading');
expect(board,'queueMicrotask(()=>renderWorkspace())','queued render should refresh');
for(const s of [claims,production]){
  expect(s,"'confirmed','no_answer'","claimed call can only leave through explicit outcomes");
  expect(s,'CONTACT_DECISION_REQUIRED','invalid transition gets 409');
  expect(s,'CONTACT_OWNED_BY_OTHER','only owning employee may close call');
}
expect(api,'fun lookupCallerLive','fallback authenticated lookup');
expect(claims,'orderTotal:Number(order?.total||0)','live caller detail includes total');
expect(claims,'product:clean(order?.product)','live caller detail includes product');
expect(screening,'KunApi.lookupCallerLive','screening refreshes stale cache');
expect(screening,'KunCustomerServiceApi.claimContact','screening claims contact');
expect(service,'fun claimContact','native API can claim contact');
for(const s of [native,nativeFallback]){
  expect(s,'"no_answer"','overlay no-answer');
  expect(s,'"confirmed"','overlay confirm');
  expect(s,'CallerJntOrderEditActivity.EXTRA_SHIPPING_ONLY, true','open native J&T cascading shipping editor');
  expect(s,'تعديل بيانات','shipping button shown');
}
expect(build,'versionCode = 140','new build number');
expect(build,'versionName = "2.9.9"','new version');
console.log('PASS: Customer Service filter and call claim continuity / Android caller panel 2.9.9');