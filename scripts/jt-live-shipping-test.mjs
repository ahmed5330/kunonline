import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJtExpressShipment,jtWebhookToken,__jtApiInternals} from '../src/jt-express-eg-api.js';

const basicSecrets={api_account:'API-ACCOUNT-123',private_key:'PRIVATE-KEY-XYZ',source_code:'D452',source_name:'Kun Online',customer_code:'CUSTOMER-001',customer_password:'CUSTOMER-PASS',sender_name:'Kun Online',sender_mobile:'01000000000',sender_phone:'',sender_company:'Kun Online',sender_prov:'القاهرة',sender_city:'مدينة نصر',sender_area:'الحي السابع',sender_street:'شارع الاختبار 1'};
const order={id:'ORDER-1',ref:'REF-1',name:'Receiver',phone:'01011111111',address:'Receiver street',product:'Test item',qty:1,total:100};
const request={customerOrderNo:'REF-1',receiverName:'Receiver',receiverPhone:'01011111111',countryCode:'EGY',province:'القاهرة',city:'مدينة نصر',area:'الحي السابع',street:'Receiver street',itemName:'Test item',itemType:'Goods',weight:0.1,quantity:1,codAmount:100,currency:'EGP',notes:'Test'};

let calls=[];
const success=await createJtExpressShipment({secrets:basicSecrets,order,request,fetcher:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({code:'1',msg:'success',data:{billCode:'JT-BILL-1'}}),{status:200,headers:{'Content-Type':'application/json'}});}});
assert.equal(success.awb,'JT-BILL-1');assert.equal(calls.length,1,'Create Order must make one documented request');
const body=JSON.parse(calls[0].init.body);assert.equal(body.customerCode,basicSecrets.customer_code);assert.equal(body.digest,__jtApiInternals.businessDigest(body.bizContent,basicSecrets.customer_password));assert.equal(body.sourceCode,basicSecrets.source_code);assert.equal(body.apiAccount,basicSecrets.api_account);

let missingCalls=0;
await assert.rejects(()=>createJtExpressShipment({secrets:{...basicSecrets,customer_password:''},order,request,fetcher:async()=>{missingCalls++;throw new Error('network must not be reached');}}),/Customer Password/i);assert.equal(missingCalls,0,'Missing Business Info must fail before network access');

let rejectedCalls=0;
await assert.rejects(()=>createJtExpressShipment({secrets:basicSecrets,order,request,fetcher:async()=>{rejectedCalls++;return new Response(JSON.stringify({code:'0',msg:'bad credentials'}),{status:200,headers:{'Content-Type':'application/json'}});}}),/bad credentials/i);assert.equal(rejectedCalls,1,'Create Order must not retry with guessed or legacy credentials');

assert.equal(__jtApiInternals.parseJtShipmentResult({data:{bill_code:'JT-BILL-2'}}).awb,'JT-BILL-2');assert.equal(__jtApiInternals.parseJtShipmentResult({data:{awbNo:'JT-BILL-3'}}).awb,'JT-BILL-3');
const token1=jtWebhookToken('CON-1',basicSecrets),token2=jtWebhookToken('CON-2',basicSecrets);assert.ok(token1.length>10);assert.notEqual(token1,token2);

const edit=await readFile(new URL('../src/order-edit.js',import.meta.url),'utf8'),worker=await readFile(new URL('../src/index-commerce-v37.js',import.meta.url),'utf8'),v38=await readFile(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8'),v38Core=await readFile(new URL('../src/index-commerce-v38-core.js',import.meta.url),'utf8'),ui=await readFile(new URL('../public/v2/modules-v78-jt-shipping-order.js',import.meta.url),'utf8'),setup=await readFile(new URL('../public/v2/modules-v81-jt-live-setup.js',import.meta.url),'utf8'),trackingUi=await readFile(new URL('../public/v2/modules-v82-jt-tracking-cards.js',import.meta.url),'utf8'),recencyUi=await readFile(new URL('../public/v2/modules-v83-order-recency.js',import.meta.url),'utf8'),createSetupUi=await readFile(new URL('../public/v2/modules-v84-jt-create-setup.js',import.meta.url),'utf8'),index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),v38Effective=`${v38}\n${v38Core}`;
new Function(ui);new Function(setup);new Function(trackingUi);new Function(recencyUi);new Function(createSetupUi);
assert.match(edit,/EDITABLE_STATES=new Set\(\['pending','no_answer','confirmed','preparing','deferred'\]\)/,'no_answer must remain editable before confirmation');
for(const marker of ['function extractTracking','function delivered','jt_tracking_update','constantTimeEqual','/api/webhooks/jt/logistics/','/api/jt/webhook-url','nextState=\'signed\''])assert.ok(worker.includes(marker),`J&T webhook worker missing ${marker}`);
assert.ok(ui.includes('/api/jt/shipments/'),'J&T form must call the live server-side shipment API');assert.ok(!ui.includes('KunCustomerServiceV31?.render?.()'),'J&T shipment must not reload the Customer Service board');assert.ok(ui.includes("moveState?.(orderId,'shipped')"),'Successful J&T creation must move only the order card');
assert.ok(setup.includes('/api/jt/webhook-url'),'J&T setup must expose the logistics callback URL');for(const marker of ['Business Info','مطلوب لإنشاء البوليصة','Merchant Code','ليست Private Key'])assert.ok(setup.includes(marker),`J&T business setup missing ${marker}`);
assert.ok(v38Effective.includes('secretRelations'),'Preview diagnostic must compare legacy credential relations without exposing secret values across the v38 wrapper/core boundary');
assert.ok(v38.includes("import core from './index-commerce-v38-core.js'"),'v38 safety wrapper must preserve the prior J&T implementation through the frozen core module');
for(const marker of ['sender_name','sender_mobile','sender_prov','sender_city','sender_area','sender_street','Bill Code','markBusinessRequired','Business Info','Customer Password / API Password','لا تستخدم Private Key'])assert.ok(createSetupUi.includes(marker),`J&T Create Order setup missing ${marker}`);
for(const marker of ['/api/customer-service','/api/post-shipping','/api/returns-exchanges','history.at(-1)','patchOrder','touch(orderId)','sorted.every'])assert.ok(recencyUi.includes(marker),`Operational recency layer missing ${marker}`);
assert.ok(index.includes('/v2/modules-v81-jt-live-setup.js?v=81.3'),'J&T business/webhook setup module must be loaded with the corrected cache-busting version');assert.ok(index.includes('/v2/modules-v82-jt-tracking-cards.js?v=82.0'),'J&T tracking cards module must be loaded by the app');assert.ok(index.includes('/v2/modules-v83-order-recency.js?v=83.1'),'Operational recency module must be loaded by the app');assert.ok(index.includes('/v2/modules-v84-jt-create-setup.js?v=84.5'),'J&T Create Order setup module must load the idempotent v84.5 cache-busted asset');
for(const marker of ['post-shipping','returns-exchanges','jt82-badge','jt_tracking_update','jt_shipment_created','60000'])assert.ok(trackingUi.includes(marker),`J&T tracking UI missing ${marker}`);
assert.ok(trackingUi.includes("window.KunPostShippingV47?.render?.()"),'Post-shipping board must re-render when a J&T webhook moves an order to another stage');
console.log('J&T live shipping checks passed: Create Order requires Business Info before network access, sends the documented business digest on the first request, never guesses legacy credentials, and preserves sender/Bill Code handling.');