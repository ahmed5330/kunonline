import {readFile} from 'node:fs/promises';

const backend=await readFile(new URL('../src/customer-service.js',import.meta.url),'utf8');
const fifo=await readFile(new URL('../src/inventory-fifo.js',import.meta.url),'utf8');
const entry=await readFile(new URL('../src/index-commerce-v31.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v31-customer-service.js',import.meta.url),'utf8');
const searchUi=await readFile(new URL('../public/v2/modules-v55-customer-search-fifo.js',import.meta.url),'utf8');
const confirmUi=await readFile(new URL('../public/v2/modules-v58-confirm-inventory.js',import.meta.url),'utf8');
const dataUi=await readFile(new URL('../public/v2/modules-v23-data.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/v2/kun-v10.css',import.meta.url),'utf8');
const index=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');
const team=await readFile(new URL('../public/v2/modules-v24-team.js',import.meta.url),'utf8');
const must=(ok,message)=>{if(!ok)throw new Error(message);};

for(const role of ['admin','client','ops','support'])must(backend.includes(`'${role}'`)&&ui.includes(`'${role}'`),`Customer Service role missing: ${role}`);
for(const stage of ['pending','confirmed','preparing','shipped'])must(backend.includes(`'${stage}'`)&&ui.includes(`'${stage}'`),`Customer Service stage missing: ${stage}`);
for(const label of ['في انتظار التأكيد','تم التأكيد','التجهيز والتغليف','جاري الشحن'])must(backend.includes(label)&&ui.includes(label),`Customer Service label missing: ${label}`);
must(backend.includes("import {listMyStores} from './store-scope.js'")&&backend.includes('accessContext'),'Customer Service must resolve access through the central multi-store scope');
must(backend.includes('STORE_ISOLATION')&&backend.includes('STORE_READ_ONLY'),'Customer Service backend must enforce assigned-store isolation and read-only access');
must(team.includes('data-v28-store')&&team.includes('storeAccess:readAssignments()'),'Administration must keep multi-store assignment controls for team members');
must(ui.includes('كل المتاجر')&&ui.includes('data-cs-store'),'Customer Service must allow an authorized user to combine assigned stores in one board');

must(backend.includes('ensureLegacyCustomerServiceEnabled')&&backend.includes("module_key='orders'")&&backend.includes('customerServiceEnabled=true'),'Tenant owners on the modern Customer Service board must bridge the legacy state permission before delegated order actions');
must(backend.includes("const DELETE_ROLES=new Set(['admin','client','ops'])")&&backend.includes("action==='delete'")&&backend.includes('ORDER_DELETE_DENIED'),'Order deletion must be explicitly limited to platform admin, tenant owner and operations manager roles');
must(dataUi.includes('v23DeleteOrder')&&dataUi.includes('حذف الطلب')&&dataUi.includes('/api/customer-service/orders/${encodeURIComponent(orderId)}/delete'),'General Orders drawer must expose the governed delete action');
must(dataUi.includes("['admin','client','ops'].includes"),'General Orders delete button must stay hidden from Customer Service/support users');

must(backend.includes("state='deferred'")&&backend.includes("type:'defer_return'")&&backend.includes('Africa/Cairo'),'Deferred orders must automatically return using the Cairo business date');
must(ui.includes("next==='deferred'")&&ui.includes('csDeferDate')&&ui.includes('الطلبات المؤجلة'),'Deferred orders must have a date picker and a separate deferred section');
must(ui.includes('returnedFromDeferredToday')&&ui.includes('رجع من التأجيل اليوم'),'Orders returning from deferral today must be visually called out');

must(backend.includes("action==='contact'")&&backend.includes('/contact'),'Contact attempts must route through the recorded order contact action');
must(ui.includes('/contact')&&ui.includes('تواصل ('),'Customer Service cards must record and expose contact-attempt counts');
must(ui.includes('href="tel:')&&ui.includes('مكالمة'),'Customer Service cards must provide native phone calling');
must(ui.includes('https://wa.me/')&&ui.includes('/whatsapp-log')&&ui.includes('templatesFor'),'WhatsApp templates must open WhatsApp and record the event');
for(const template of ['رسالة تأكيد الطلب','رسالة التجهيز والتغليف','رسالة جاري الشحن','رسالة طلب تقييم','متابعة الطلب المؤجل'])must(ui.includes(template),`WhatsApp state template missing: ${template}`);

must(backend.includes("type:'internal_note'")&&backend.includes('latestInternalNote'),'Internal Customer Service notes must be stored separately in order history');
must(ui.includes('ملاحظة العميل عند الطلب')&&ui.includes('ملاحظة داخلية لخدمة العملاء'),'Customer note and internal staff note must be visibly separate');
must(backend.includes('byName')&&backend.includes('byUserId')&&ui.includes('بواسطة:'),'Order history must identify the team member who performed actions');
must(ui.includes('سجل الأوردر')&&ui.includes('/history'),'Every card must expose the auditable order timeline');
must(ui.includes('رقم البوليصة')&&backend.includes("type:'awb'"),'Customer Service must allow AWB recording with audit history');

must(backend.includes("from './inventory-fifo.js'"),'Customer Service confirmation must use the dedicated FIFO inventory allocator');
for(const marker of ['order_item_stock_allocations','ORDER BY b.stock_date ASC,b.created_at ASC','STOCK_FIFO_INSUFFICIENT','virtualRemaining','خصم أوردر ${orderId} تلقائيًا بنظام FIFO','if(toState!==\'confirmed\')','HOLDING_STATES'])must(fifo.includes(marker),`FIFO confirmation allocator missing ${marker}`);
must(fifo.includes('Moving to "shipped" is intentionally state-only'),'Shipping must be explicitly decoupled from inventory allocation');
must(!fifo.includes('STOCK_BATCH_REQUIRED'),'Confirmation FIFO must not require a manually selected stock batch');
must(searchUi.includes('operationalCustomerMatches')&&searchUi.includes('كل العملاء المطابقين للاسم'),'Global operational search must return every matching customer under one list');
must(!searchUi.includes('/api/state?clientId='),'Operational customer search must not load the full state payload');
must(searchUi.includes('filterOperationalCards')&&searchUi.includes('v55-filter-hidden'),'Customer Service search must filter operational columns to matching customer names');
must(searchUi.includes('v55-order-date')&&searchUi.includes('تاريخ الطلب'),'Every operational order card must receive an explicit order-date row');
must(searchUi.includes("select.value!=='shipped'")&&searchUi.includes("state:'shipped'")&&searchUi.includes('stateOnlyShip'),'Shipping transition must bypass the legacy stock chooser and remain state-only');
must(searchUi.includes('بدون أي تعديل على المخزون')&&!searchUi.includes('stockBatchId'),'Shipping UI must not select or send an inventory batch');

for(const marker of ['تأكيد من المخزون','/api/catalog/products','/edit',"state:'confirmed'",'عدد القطع','سعر القطعة','المتاح حاليًا','validateAvailability','حجز/خصم الكمية','KunConfirmInventoryV58'])must(confirmUi.includes(marker),`Inventory confirmation UI missing ${marker}`);
must(confirmUi.includes('productId')&&confirmUi.includes('variantId')&&confirmUi.includes('unitPrice'),'Confirmation must persist exact product/variant and editable price');
must(index.includes('/v2/modules-v55-customer-search-fifo.js?v=55.2'),'v55.2 state-only shipping/search/date module must be loaded by v2');
must(index.includes('/v2/modules-v58-confirm-inventory.js?v=58.0'),'v58 inventory confirmation module must be loaded by v2');
must(index.indexOf('modules-v55-customer-search-fifo.js')<index.indexOf('modules-v39-stock-batches.js'),'State-only shipping capture must load before the legacy stock chooser interceptor');
must(index.indexOf('modules-v58-confirm-inventory.js')>index.indexOf('modules-v57-section-reload.js'),'Confirmation module must load after the operational UI modules');

must(!ui.includes('حذف')&&!ui.includes('data-cs-action="delete"'),'Customer Service board must not expose order deletion');
must(index.includes('data-view="customer-service"')&&index.includes('/v2/modules-v31-customer-service.js')&&index.includes('/v2/kun-v10.css'),'Customer Service navigation, JS and CSS assets must be loaded by v2');
must(css.includes('grid-template-columns:repeat(4')&&css.includes('@media(max-width:700px)')&&css.includes('.cs-returned-today'),'Customer Service board must be four-stage, responsive and visually flag returned deferred orders');
must(entry.includes("path==='/api/customer-service'")&&entry.includes("path.startsWith('/api/customer-service/orders/')"),'Active Preview entrypoint must route Customer Service APIs');

await import('../src/inventory-fifo.js');
assertBrowserModule(searchUi);assertBrowserModule(confirmUi);
console.log('Customer Service contract passed: inventory-backed confirmation, FIFO reservation on confirm, state-only shipping, search/filter/date UX and governed order operations.');

function assertBrowserModule(source){try{new Function(source);}catch(error){throw new Error(`Customer Service browser module must parse: ${error.message}`);}}
