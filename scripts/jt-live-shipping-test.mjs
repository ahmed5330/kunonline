import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildJtCreatePayload,createJtShipment,jtWebhookToken,__jtApiInternals} from '../src/jt-express-eg-api.js';
import {__jtValidationInternals} from '../src/jt-express-eg-validation.js';

const basicSecrets={api_account:'API-123',private_key:'PRIVATE-XYZ',source_code:'D452'};
const senderSecrets={...basicSecrets,sender_name:'Kun Warehouse',sender_mobile:'01000000000',sender_phone:'0220000000',sender_company:'Kun Online',sender_prov:'القاهرة',sender_city:'مدينة نصر',sender_area:'الحي السابع',sender_street:'شارع الاختبار 1'};
const businessOnlySecrets={...basicSecrets,customer_code:'J0088',customer_password:'secret'};
const secrets={...senderSecrets,customer_code:'J0088',customer_password:'secret'};
const shipment={orderId:'OID-1',customerOrderNo:'ORD-1',receiverName:'Ahmed Test',receiverPhone:'01012345678',countryCode:'+20',province:'القاهرة',provinceCode:'1011',city:'مدينة نصر',cityCode:'1011001',area:'الحي السابع',districtCode:'A000001',addressCountryCode:'100000',street:'شارع الاختبار',itemType:'Clothes',itemName:'Skirt',weight:1.25,quantity:2,codAmount:1200,currency:'EGP'};

assert.throws(()=>buildJtCreatePayload(shipment,basicSecrets),error=>error?.code==='JT_SENDER_INFO_MISSING'&&error?.status===409&&Array.isArray(error?.missingSenderFields),'Create Order must fail clearly before calling J&T when sender info is missing');
assert.throws(()=>buildJtCreatePayload(shipment,businessOnlySecrets),error=>error?.code==='JT_SENDER_INFO_MISSING'&&error?.status===409,'Business Info must not replace sender info');
assert.throws(()=>buildJtCreatePayload(shipment,senderSecrets,{requireBusiness:true}),error=>error?.code==='JT_BUSINESS_CREDENTIALS_MISSING'&&error?.status===409,'Create Order business mode must require Customer Code and Customer Password');

const payload=buildJtCreatePayload(shipment,secrets);
assert.equal(payload.sourceCode,'D452');assert.equal(payload.txlogisticId,'ORD-1');assert.equal(payload.orderType,'1');assert.equal(payload.serviceType,'01');assert.equal(payload.deliveryType,'04');assert.equal(payload.operateType,1);assert.equal(payload.receiver.areaCode,'A000001');assert.equal(payload.sender.name,'Kun Warehouse');assert.equal(payload.payType,'PP_CASH');assert.equal(payload.itemsValue,1200);assert.equal(payload.totalQuantity,2);
const businessPayload=buildJtCreatePayload(shipment,secrets,{requireBusiness:true});
assert.equal(businessPayload.customerCode,'J0088');assert.equal(businessPayload.digest,__jtApiInternals.businessDigest('J0088','secret','PRIVATE-XYZ'));

let missingBusinessFetches=0;
await assert.rejects(()=>createJtShipment({shipment,secrets:senderSecrets,fetcher:async()=>{missingBusinessFetches++;throw new Error('fetch must not run');}}),error=>error?.code==='JT_BUSINESS_CREDENTIALS_MISSING'&&error?.enterpriseCredentialsRequired===true);
assert.equal(missingBusinessFetches,0,'Missing Business Info must not burn an external request');

const calls=[];
const result=await createJtShipment({shipment,secrets,fetcher:async(url,options)=>{
  calls.push({url,options});assert.equal(url,`${__jtApiInternals.LIVE_BASE}${__jtApiInternals.ADD_ORDER_PATH}`);assert.equal(options.method,'POST');assert.equal(options.headers.apiAccount,secrets.api_account);assert.match(options.headers.timestamp,/^\d{13}$/);
  const bizContent=new URLSearchParams(options.body).get('bizContent');assert.ok(bizContent);assert.equal(options.headers.digest,__jtValidationInternals.md5Base64(bizContent+secrets.private_key));
  const sent=JSON.parse(bizContent);assert.equal(sent.sourceCode,'D452');assert.equal(sent.customerCode,'J0088');assert.equal(sent.digest,__jtApiInternals.businessDigest('J0088','secret','PRIVATE-XYZ'));assert.equal(sent.receiver.areaCode,'A000001');assert.equal(sent.orderType,'1');assert.equal(sent.serviceType,'01');
  return new Response(JSON.stringify({code:'1',msg:'success',data:{billCode:'JT123456789EG',txlogisticId:'ORD-1',sortingCode:'20 C01-03'}}),{status:200,headers:{'Content-Type':'application/json'}});
}});
assert.equal(calls.length,1);assert.equal(result.awb,'JT123456789EG');assert.equal(result.sortingCode,'20 C01-03');assert.equal(result.txlogisticId,'ORD-1');assert.equal(result.businessAuthUsed,true);

let rejectedCalls=0;
await assert.rejects(()=>createJtShipment({shipment,secrets,fetcher:async()=>{rejectedCalls++;return new Response(JSON.stringify({code:'145003031',msg:'Business parameter signature verification failed'}),{status:200,headers:{'Content-Type':'application/json'}});}}),error=>error?.code==='JT_BUSINESS_CREDENTIALS_REJECTED'&&error?.status===422);
assert.equal(rejectedCalls,1,'Create Order must not retry guessed credentials');
assert.equal(__jtApiInternals.parseJtShipmentResult({data:{bill_code:'JT-BILL-2'}}).awb,'JT-BILL-2');
assert.equal(__jtApiInternals.parseJtShipmentResult({data:{awbNo:'JT-BILL-3'}}).awb,'JT-BILL-3');
const token1=jtWebhookToken('CON-1',basicSecrets),token2=jtWebhookToken('CON-2',basicSecrets);assert.ok(token1.length>10);assert.notEqual(token1,token2);

const edit=await readFile(new URL('../src/order-edit.js',import.meta.url),'utf8');
const legacyWorker=await readFile(new URL('../src/index-commerce-v37.js',import.meta.url),'utf8');
const v38=await readFile(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8');
const v38Core=await readFile(new URL('../src/index-commerce-v38-core.js',import.meta.url),'utf8');
const workflow=await readFile(new URL('../src/jt-print-workflow-v2.js',import.meta.url),'utf8');
const production=await readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
const printingRoute=await readFile(new URL('../src/production-printing-queue.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v78-jt-shipping-order.js',import.meta.url),'utf8');
const setup=await readFile(new URL('../public/v2/modules-v81-jt-live-setup.js',import.meta.url),'utf8');
const trackingUi=await readFile(new URL('../public/v2/modules-v82-jt-tracking-cards.js',import.meta.url),'utf8');
const recencyUi=await readFile(new URL('../public/v2/modules-v83-order-recency.js',import.meta.url),'utf8');
const createSetupUi=await readFile(new URL('../public/v2/modules-v84-jt-create-setup.js',import.meta.url),'utf8');
const printingUi=await readFile(new URL('../public/v2/modules-v79-printing.js',import.meta.url),'utf8');
const printingRouting=await readFile(new URL('../public/v2/modules-v116-print-routing.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');
const androidShell=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/KunNativeAppV26.kt',import.meta.url),'utf8');
const androidDateFilter=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/MobileDateFilterV267.kt',import.meta.url),'utf8');
const androidGradle=await readFile(new URL('../android/app/build.gradle.kts',import.meta.url),'utf8');
new Function(ui);new Function(setup);new Function(trackingUi);new Function(recencyUi);new Function(createSetupUi);new Function(printingUi);new Function(printingRouting);

assert.match(edit,/EDITABLE_STATES=new Set\(\['pending','no_answer','confirmed','preparing','deferred'\]\)/,'no_answer must remain editable');
for(const marker of ['function extractTracking','function delivered','function settled','jt_tracking_update','constantTimeEqual','/api/webhooks/jt/logistics/','/api/jt/webhook-url'])assert.ok(legacyWorker.includes(marker),`J&T tracking/webhook worker missing ${marker}`);
for(const marker of ['settlementStatus','settlementAmount','mappedState','collected_amount'])assert.ok(legacyWorker.includes(marker),`J&T settlement sync missing ${marker}`);
assert.ok(v38.includes("import core from './index-commerce-v38-core.js'"),'v38 wrapper must preserve the frozen core');
assert.ok(v38Core.includes("import {handleJtPrintWorkflowV2} from './jt-print-workflow-v2.js'"),'v38 must load the governed J&T Printing workflow');
assert.ok(v38Core.includes('handleJtPrintWorkflowV2({request,env,ctx,delegate:commerceV37,me})'),'v38 must intercept J&T shipment/print routes before legacy delegation');

const queueStart=workflow.indexOf('async function queueForPrint'),queueEnd=workflow.indexOf('function walkObjects'),queueBlock=workflow.slice(queueStart,queueEnd);
assert.ok(queueStart>=0&&queueEnd>queueStart,'Queue handler must exist');
assert.ok(queueBlock.includes("'jt_print_queued'"),'Printing preparation must persist shipment data locally');
assert.ok(queueBlock.includes('buildJtCreatePayload(shipment,secrets,{requireBusiness:true})'),'Printing preparation must validate the future Create Order payload');
assert.ok(!queueBlock.includes('createJtShipment('),'Preparing Printing data must never call addOrder');
assert.ok(!queueBlock.includes('signedPost(PRINT_ORDER_PATH'),'Preparing Printing data must never call printOrder');
assert.ok(!queueBlock.includes('delegateState(')&&!queueBlock.includes("UPDATE orders SET state='shipped'"),'Preparing Printing data must not move the order to shipping');
assert.ok(queueBlock.includes("['confirmed','preparing'].includes(row.state)"),'Only confirmed/preparing orders may be prepared for first J&T send');
assert.ok(queueBlock.includes('state:row.state'),'Preparation must preserve the confirmed/preparing state');

const printStart=workflow.indexOf('async function createAndPrint'),printEnd=workflow.indexOf('export async function handleJtPrintWorkflowV2'),printBlock=workflow.slice(printStart,printEnd);
assert.ok(printStart>=0&&printEnd>printStart,'Create-and-print handler must exist');
for(const marker of ['createJtShipment({shipment,secrets})',"UPDATE orders SET awb=?",'jt_shipment_created','jt_print_requested',"printSize:'2'",'printCode:1','signedPost(PRINT_ORDER_PATH','jt_print_failed','jt_label_printed','official:true',"UPDATE orders SET state='shipped'",'jt_handoff_shipped'])assert.ok(printBlock.includes(marker),`Explicit Printing send workflow missing ${marker}`);
assert.ok(printBlock.indexOf('createJtShipment({shipment,secrets})')<printBlock.indexOf('signedPost(PRINT_ORDER_PATH'),'addOrder must run before printOrder');
assert.ok(printBlock.indexOf("UPDATE orders SET awb=?")<printBlock.indexOf('signedPost(PRINT_ORDER_PATH'),'AWB must be persisted before printOrder so retries cannot duplicate a shipment');
assert.ok(printBlock.indexOf('jt_label_printed')<printBlock.indexOf("UPDATE orders SET state='shipped'"),'Order must enter shipping only after the carrier label succeeds');
assert.ok(printBlock.includes("if(!awb){"),'Existing AWB must skip shipment creation and continue printing');

assert.ok(printingRoute.includes("url.pathname!=='/api/printing'")&&printingRoute.includes("const states=['confirmed','preparing','shipped']"),'Production must expose confirmed orders through the dedicated Printing queue');
assert.ok(printingRoute.includes("order.state!=='shipped'||order.queuedForPrint||order.printed"),'Unrelated shipped orders must stay out of Printing');
assert.ok(production.includes("const PRINTING_STATES=new Set(['confirmed','preparing'])")&&production.includes('routeConfirmedOrdersToPrinting'),'Confirmed orders must be removed from Customer Service responses and routed to Printing');
for(const marker of ['modules-v78-jt-shipping-order.js?v=78.5','modules-v79-printing.js?v=79.8','modules-v116-print-routing.js?v=116.0'])assert.ok(production.includes(marker),`Production must load/cache-bust ${marker}`);

assert.ok(ui.includes('الإرسال الحقيقي وإنشاء AWB يتمان فقط')&&ui.includes('قسم الطباعة'),'J&T editor must explain that external sending belongs to Printing');
assert.ok(ui.includes("version:'78.5'"),'J&T editor runtime must be v78.5');
assert.ok(!ui.includes("moveState?.(orderId,'shipped')"),'J&T data preparation must never move the order to shipping');
assert.ok(printingUi.includes('/api/printing?clientId='),'Printing UI must load the dedicated queue');
assert.ok(printingUi.includes('إرسال إلى J&T وطباعة البوليصة'),'Printing UI must own the external carrier handoff');
assert.ok(printingUi.includes('/api/jt/shipments/${encodeURIComponent(o.id)}')&&printingUi.includes('/api/jt/shipments/${encodeURIComponent(id)}/print'),'Printing must stage local data then perform governed J&T create/print');
assert.ok(printingUi.includes("version:'79.8'"),'Printing runtime must be v79.8');
assert.ok(printingRouting.includes("new Set(['confirmed','preparing'])")&&printingRouting.includes('تم تأكيد الأوردر ونقله تلقائيًا إلى قسم الطباعة'),'Web Customer Service must immediately hand confirmed orders to Printing');
assert.ok(!printingUi.includes('window.print')&&!printingUi.includes('fallbackPrint'),'Official carrier label must have no browser-generated fallback');

assert.ok(!androidShell.includes('PrintingMobileV26')&&!androidShell.includes('Text("الطباعة")'),'Android app must keep Printing in the main web system only');
for(const label of ['اليوم','أمس','هذا الأسبوع','الأسبوع الماضي','الشهر الحالي','الشهر الماضي','مدة معينة'])assert.ok(androidDateFilter.includes(`"${label}"`),`Android period selector missing ${label}`);
assert.ok(androidDateFilter.includes('DatePickerDialog')&&androidDateFilter.includes('selectCustom'),'Android custom period must provide a start/end date selection');
assert.ok(androidGradle.includes('versionCode = 117')&&androidGradle.includes('versionName = "2.6.7"'),'Android release must be v2.6.7 code 117');

assert.ok(index.includes('/v2/modules-v81-jt-live-setup.js?v=81.3'));assert.ok(index.includes('/v2/modules-v82-jt-tracking-cards.js?v=82.1'));assert.ok(index.includes('/v2/modules-v83-order-recency.js?v=83.1'));assert.ok(index.includes('/v2/modules-v84-jt-create-setup.js?v=84.5'));
for(const marker of ['post-shipping','returns-exchanges','jt82-badge','jt_tracking_update','jt_shipment_created','60000','PULL_INTERVAL=300000','MAX_PULL=6','/track?clientId='])assert.ok(trackingUi.includes(marker),`J&T tracking UI missing ${marker}`);
assert.ok(trackingUi.includes("window.KunPostShippingV47?.render?.()"));
for(const marker of ['sender_name','sender_mobile','sender_prov','sender_city','sender_area','sender_street','Bill Code','markBusinessRequired','Business Info','Customer Password / API Password','لا تستخدم Private Key'])assert.ok(createSetupUi.includes(marker),`J&T Create Order setup missing ${marker}`);
for(const marker of ['/api/customer-service','/api/post-shipping','/api/returns-exchanges','history.at(-1)','patchOrder','touch(orderId)','sorted.every'])assert.ok(recencyUi.includes(marker),`Operational recency layer missing ${marker}`);
console.log('J&T live shipping checks passed: confirmation routes to web Printing; Android has no Printing action; official carrier label still moves the order to shipping in the web system.');
