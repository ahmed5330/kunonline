import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const read = p => fs.readFileSync(new URL('../'+p, import.meta.url), 'utf8');
for (const p of [
  'src/index-production-mobile-update.js',
  'src/production-customer-service.js',
  'public/v2/modules-v79-printing.js',
  'public/v2/modules-v155-customer-service-board.js',
  'public/v2/modules-v54-order-workflow-controls.js'
]) {
  execFileSync(process.execPath,['--check',new URL('../'+p, import.meta.url).pathname]);
}
const gateway=read('src/index-production-mobile-update.js');
const backend=read('src/production-customer-service.js');
const printing=read('public/v2/modules-v79-printing.js');
const board=read('public/v2/modules-v155-customer-service-board.js');
const drawer=read('public/v2/modules-v54-order-workflow-controls.js');
const api=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceApi.kt');
const android=read('android/app/src/main/java/com/kunonline/callerid/CustomerServiceMobileV23.kt');
const nativePrinting=read('android/app/src/main/java/com/kunonline/callerid/KunSystemSections.kt');

assert.match(gateway,/Keep queue, official printing, and void on the SAME canonical D1/);
assert.match(gateway,/handleJtPrintWorkflowV2\(\{request,env:dataEnv,ctx,delegate,me\}\)/);
assert.match(backend,/JT_OFFICIAL_HANDOFF_REQUIRED/, 'State-only shipping must be rejected');
assert.match(board,/KunPrintingV79\?\.shipById/,'Customer Service drag uses real handoff');
assert.match(drawer,/KunPrintingV79\.shipById/,'Details drawer uses real handoff');
assert.match(api,/if \(state == "shipped"\) return@withClient/);
assert.match(api,/NativeSectionsApi\.queueJt\(context, orderId, storeId\)/);
assert.match(api,/NativeSectionsApi\.printJt\(context, orderId, storeId\)/);
assert.match(android,/confirmShip/);
assert.match(android,/KunCustomerServiceApi\.shipOrder/);
assert.match(nativePrinting,/pendingSendOrderId/);
assert.match(nativePrinting,/إرسال إلى J&T ونقل إلى جاري الشحن/);

const calls=[],events=[],toasts=[],popups=[];
let allow=true, failQueue=false;
const window={
  confirm:()=>allow,showToast:m=>toasts.push(m),
  open:()=>{const popup={location:{replace:url=>{popup.finalUrl=url;}},document:{body:{}},close(){popup.closed=true;}};popups.push(popup);return popup;},
  kunClientId:async()=> 'tenant-a',
  dispatchEvent:e=>events.push(e.detail)
};
const document={readyState:'loading',addEventListener(){},querySelector(){return null;}};
const fetch=async (url,options={})=>{
  calls.push({url,method:options.method||'GET',body:options.body});
  if(url.includes('/details?'))return {ok:true,json:async()=>({order:{id:'o-1',storeId:'store-a',state:'confirmed'}})};
  if(url.includes('/shipments/o-1/print'))return {ok:true,json:async()=>({state:'shipped',awb:'AWB-1',url:'https://jt.example/label'})};
  if(url.includes('/shipments/o-1'))return {ok:!failQueue,status:failQueue?422:201,json:async()=>failQueue?{error:'Address missing',code:'JT_SHIPMENT_FIELDS_MISSING'}:{queuedForPrint:true}};
  throw new Error('Unexpected network call '+url);
};
vm.runInNewContext(printing,{window,document,fetch,CustomEvent:class{constructor(name,init){this.type=name;this.detail=init.detail;}},console,URL,Set,JSON,Number,String,Array,encodeURIComponent});
const sent=await window.KunPrintingV79.shipById('o-1');
assert.equal(sent.state,'shipped');
assert.deepEqual(calls.map(x=>x.method),['GET','POST','POST']);
assert.equal(JSON.parse(calls[1].body).storeId,'store-a');
assert.equal(calls.filter(x=>x.method==='PATCH').length,0);
assert.equal(popups[0].finalUrl,'https://jt.example/label');
assert.equal(events.at(-1).state,'shipped');

calls.length=0;events.length=0;failQueue=true;
await assert.rejects(()=>window.KunPrintingV79.shipById('o-1'),/Address missing/);
assert.deepEqual(calls.map(x=>x.method),['GET','POST'],'Print is forbidden if queue validation failed');
assert.equal(events.length,0,'Do not optimistically mark shipped on error');
assert.equal(popups.at(-1).closed,true,'Close abandoned popup');

calls.length=0;allow=false;failQueue=false;
assert.equal((await window.KunPrintingV79.shipById('o-1')).cancelled,true);
assert.equal(calls.length,0,'No carrier call without explicit confirmation');
console.log('PASS: confirmed -> J&T queue -> official print -> shipped; rejection/cancellation keep status unchanged; Android and worker wiring');
