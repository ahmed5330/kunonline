import {readFile} from 'node:fs/promises';
const worker=await readFile(new URL('../src/index-commerce-v18.js',import.meta.url),'utf8');
const jtWorker=await readFile(new URL('../src/index-commerce-v37.js',import.meta.url),'utf8');
const jtWorkflow=await readFile(new URL('../src/jt-print-workflow-v2.js',import.meta.url),'utf8');
const v38Core=await readFile(new URL('../src/index-commerce-v38-core.js',import.meta.url),'utf8');
const production=await readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
const printingRoute=await readFile(new URL('../src/production-printing-queue.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v16.js',import.meta.url),'utf8');
const jtUi=await readFile(new URL('../public/v2/modules-v84-jt-create-setup.js',import.meta.url),'utf8');
const shippingUi=await readFile(new URL('../public/v2/modules-v78-jt-shipping-order.js',import.meta.url),'utf8');
const printingUi=await readFile(new URL('../public/v2/modules-v79-printing.js',import.meta.url),'utf8');
const printingRouting=await readFile(new URL('../public/v2/modules-v116-print-routing.js',import.meta.url),'utf8');
const trackingUi=await readFile(new URL('../public/v2/modules-v82-jt-tracking-cards.js',import.meta.url),'utf8');
const androidShell=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/KunNativeAppV26.kt',import.meta.url),'utf8');
const androidDateFilter=await readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/MobileDateFilterV267.kt',import.meta.url),'utf8');
const androidGradle=await readFile(new URL('../android/app/build.gradle.kts',import.meta.url),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};

for(const marker of ['/api/integrations/connections','providerById','integration.connection.create','integration.connection.delete'])must(worker.includes(marker),`Integration setup missing ${marker}`);
must(worker.includes("requirePermission(m,'integrations'"),'Integration setup must require permissions');
must(worker.includes('deduplicated:true')&&worker.includes('lower(store_name)=lower(?)'),'Repeated setup must reuse an existing provider/store connection');
must(worker.includes('DELETE FROM integration_secrets'),'Connection delete must remove encrypted secrets');
must(ui.includes('/api/integration-secrets/'),'UI must send credentials directly to encrypted secret API');
must(ui.includes('/api/integrations/connections'),'UI must create governed connections');
must(/function remove\(row,load,root\)\{[\s\S]*?panel\.scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/.test(ui),'Removal confirmation must be brought into view');
must(ui.includes("btn.textContent='جاري الإزالة...'")&&ui.includes("method:'DELETE'"),'Removal action must expose progress and call the delete route');
must(!ui.includes('localStorage.setItem')&&!ui.includes('sessionStorage.setItem'),'Integration UI must not persist credentials in browser storage');
must(jtUi.includes("if(meta&&meta.textContent!==requiredText)meta.textContent=requiredText"),'J&T setup observer must not rewrite identical textContent and trigger itself forever');
must(jtUi.includes("if(input.placeholder!==placeholder)input.placeholder=placeholder"),'J&T setup enhancement must keep repeated scans idempotent');

must(v38Core.includes('handleJtPrintWorkflowV2')&&v38Core.includes('workflowResponse'),'v38 must intercept J&T create/print before legacy routes');
const queueStart=jtWorkflow.indexOf('async function queueForPrint'),queueEnd=jtWorkflow.indexOf('function walkObjects');
const queueBlock=jtWorkflow.slice(queueStart,queueEnd);
must(queueStart>=0&&queueEnd>queueStart,'J&T local queue handler must exist');
must(queueBlock.includes('jt_print_queued'),'Printing preparation must persist the J&T shipment draft');
must(queueBlock.includes('buildJtCreatePayload(shipment,secrets,{requireBusiness:true})'),'Printing preparation must validate the future create payload');
must(!queueBlock.includes('createJtShipment(')&&!queueBlock.includes('PRINT_ORDER_PATH'),'Preparing an order in Printing must not contact J&T');
must(!queueBlock.includes("UPDATE orders SET state='shipped'")&&!queueBlock.includes('delegateState('),'Confirmed order must remain out of shipping until the explicit Printing send succeeds');
must(queueBlock.includes('state:row.state'),'Queue preparation must keep the current confirmed/preparing state');

const printStart=jtWorkflow.indexOf('async function createAndPrint'),printEnd=jtWorkflow.indexOf('export async function handleJtPrintWorkflowV2');
const printBlock=jtWorkflow.slice(printStart,printEnd);
for(const marker of ['createJtShipment({shipment,secrets})',"UPDATE orders SET awb=?",'jt_shipment_created','jt_print_requested',"printSize:'2'",'printCode:1','signedPost(PRINT_ORDER_PATH','jt_print_failed','jt_label_printed','official:true',"UPDATE orders SET state='shipped'",'jt_handoff_shipped'])must(printBlock.includes(marker),`Explicit Printing send workflow missing ${marker}`);
must(printBlock.indexOf('createJtShipment({shipment,secrets})')<printBlock.indexOf('signedPost(PRINT_ORDER_PATH'),'AWB creation must happen before printOrder');
must(printBlock.indexOf('jt_label_printed')<printBlock.indexOf("UPDATE orders SET state='shipped'"),'Order may enter shipping only after official J&T label succeeds');

must(printingRoute.includes("url.pathname!=='/api/printing'")&&printingRoute.includes("['confirmed','preparing','shipped']"),'Production must expose a dedicated Printing queue containing confirmed orders and legacy queued shipments');
must(printingRoute.includes("order.state!=='shipped'||order.queuedForPrint||order.printed"),'Unrelated shipped orders must not leak into Printing');
must(production.includes('routeConfirmedOrdersToPrinting')&&production.includes("new Set(['confirmed','preparing'])"),'Confirmed orders must disappear from Customer Service and route to Printing');
for(const marker of ['modules-v51-permission-navigation.js?v=51.11','modules-v78-jt-shipping-order.js?v=78.5','modules-v79-printing.js?v=79.8','modules-v116-print-routing.js?v=116.0'])must(production.includes(marker),`Production HTML must cache-bust/load ${marker}`);

must(shippingUi.includes('الإرسال الحقيقي وإنشاء AWB يتمان فقط')&&shippingUi.includes('قسم الطباعة'),'J&T editor must make clear that external sending happens only in Printing');
must(shippingUi.includes("version:'78.5'"),'J&T editor runtime must identify v78.5');
must(!shippingUi.includes("moveState?.(orderId,'shipped')"),'Editing/preparing J&T data must not move the order to shipping');
must(printingUi.includes('/api/printing?clientId=')&&printingUi.includes('إرسال إلى J&T وطباعة البوليصة'),'Printing UI must own the external handoff action');
must(printingUi.includes('/api/jt/shipments/${encodeURIComponent(o.id)}')&&printingUi.includes('/api/jt/shipments/${encodeURIComponent(id)}/print'),'Printing must stage locally then call J&T create/print');
must(printingUi.includes("version:'79.8'"),'Printing runtime must identify v79.8');
must(printingRouting.includes("new Set(['confirmed','preparing'])")&&printingRouting.includes('تم تأكيد الأوردر ونقله تلقائيًا إلى قسم الطباعة'),'Customer Service UI must immediately remove confirmed orders');

must(!androidShell.includes('PrintingMobileV26')&&!androidShell.includes('Text("الطباعة")'),'Android app must not expose Printing; Printing remains in the main web system');
for(const label of ['اليوم','أمس','هذا الأسبوع','الأسبوع الماضي','الشهر الحالي','الشهر الماضي','مدة معينة'])must(androidDateFilter.includes(`\"${label}\"`),`Android period selector missing ${label}`);
must(androidDateFilter.includes('DatePickerDialog')&&androidDateFilter.includes('selectCustom'),'Android custom period must allow a start/end date');
must(androidGradle.includes('versionCode = 117')&&androidGradle.includes('versionName = "2.6.7"'),'Android date-filter release must be v2.6.7 code 117');

must(trackingUi.includes('PULL_INTERVAL=300000')&&trackingUi.includes('/track?clientId='),'J&T live tracking fallback must remain protected');
must(jtWorker.includes("PRINT_ORDER_PATH='/webopenplatformapi/api/order/printOrder'"),'Legacy print route remains only for rollback compatibility behind v38 interception');
console.log('Integration setup checks passed: confirmation routes to web Printing; Android has no Printing action and uses the shared period selector.');
await import('./jt-live-shipping-test.mjs');
