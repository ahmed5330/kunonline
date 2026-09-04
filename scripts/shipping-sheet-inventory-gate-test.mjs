import {readFile} from 'node:fs/promises';
import {sanitizeShippingSheetPending,latestShippingSheetInventoryBlock,decorateShippingSheetInventoryBlocks} from '../src/shipping-sheet-inventory-gate.js';
import {normalizeShippingPhone,normalizeShippingName,shippingNameSimilarity,shippingAmountMatches,scoreShippingOrderMatch,chooseShippingOrderMatch} from '../src/shipping-sheet-order-match.js';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const must=(ok,message)=>{if(!ok)throw new Error(`Shipping-sheet inventory gate contract failed: ${message}`);};
const [entry,gate,fifo,ui,smartUi,matcher,editBackend,editUi,index]=await Promise.all([
  read('src/index-commerce-v36.js'),read('src/shipping-sheet-inventory-gate.js'),read('src/inventory-fifo.js'),read('public/v2/modules-v63-shipping-inventory-gate.js'),read('public/v2/modules-v64-shipping-smart-sync.js'),read('src/shipping-sheet-order-match.js'),read('src/order-edit.js'),read('public/v2/modules-v44-customer-service-order-edit.js'),read('public/v2/index.html')
]);
new Function(smartUi);

for(const marker of ['gateShippingSheetInventory','shipping_sheet_inventory_blocked','shipping_sheet_inventory_resolved','ORDER_INVENTORY_COVERAGE_INCOMPLETE','ORDER_INVENTORY_NOT_LINKED','STOCK_FIFO_INSUFFICIENT','resetOrderStockAllocationForRepair','finalizeHistoricalReturnedInventoryBackfill'])must(gate.includes(marker)||fifo.includes(marker),`backend marker missing: ${marker}`);
must(gate.indexOf('if(coverage.complete)return')>=0&&gate.indexOf('if(coverage.complete)return')<gate.indexOf('prepareOrderStockTransition'),'a fully allocated order must return before any fresh FIFO allocation, preventing double stock deduction');
must(gate.indexOf('resetOrderStockAllocationForRepair')<gate.indexOf('prepareOrderStockTransition'),'partial allocation repair must be wired before a fresh FIFO allocation path');
must(fifo.includes("toState:'cancelled',actor,restoreGeneral:true")&&fifo.includes("toState:'returned',actor,restoreGeneral:true"),'FIFO repair hooks must restore both lot and general stock');

for(const marker of ['/shipping-sheet-apply','/shipping-sheet-retry','/api/post-shipping/shipping-sheet-match','shippingSheetInventoryGate:true','shippingSheetInventoryPrivacyBlock:true','shippingSheetFinancialDependency:true','shippingSheetSmartMatch:true','shippingSheetIdempotentInventory:true','decorateShippingSheetInventoryBlocks'])must(entry.includes(marker),`active v36 entrypoint missing: ${marker}`);
const financialRoute=entry.slice(entry.indexOf('async function carrierFinancialsRoute'),entry.indexOf('async function settleShippingSheetState'));
must(financialRoute.indexOf('gateShippingSheetInventory')>=0&&financialRoute.indexOf('gateShippingSheetInventory')<financialRoute.indexOf('recordCarrierFinancials'),'carrier financial writes must be gated by FIFO inventory first');
const workflow=entry.slice(entry.indexOf('async function applyShippingSheetWorkflow'),entry.indexOf('async function shippingSheetApplyRoute'));
must(workflow.indexOf('gateShippingSheetInventory')<workflow.indexOf('settleShippingSheetState')&&workflow.indexOf('settleShippingSheetState')<workflow.indexOf('recordCarrierFinancials'),'sheet workflow order must stay inventory -> state -> carrier finance');
must(workflow.includes('inventoryAlreadySynced')&&workflow.includes('inventoryAllocatedNow'),'workflow response must expose whether stock was already reconciled or newly deducted');
must(entry.includes("clean(body.state)==='returned'&&clean(body.sourceSection)==='post-shipping-sheet'")&&entry.includes("target:'returned',flow:'post-shipping-sheet-return'"),'sheet-driven returns must pass the inventory gate');
must(entry.includes("/api/post-shipping/orders/${encodeURIComponent(orderId)}/delivered")&&entry.includes('guardedDirectDelivered'),'direct delivered settlement must also remain inventory guarded');

for(const marker of ['inventory63-blocked','border:2px solid #dc2626','بيانات الطلب محجوبة','لن تظهر بيانات العميل أو المنتجات أو المبالغ','data-inventory63-retry','data-inventory63-edit','data-inventory63-stock','shipping-sheet-retry','expectedCarrierCollection','المستحق المتوقع'])must(ui.includes(marker),`privacy/blocker UI marker missing: ${marker}`);
for(const marker of ['Smart Shipping Sync','رقم الهاتف + الاسم + قيمة التحصيل','shipping-sheet-match','shipping-sheet-apply','inventoryAlreadySynced','inventoryAllocatedNow','كان مسمّع مسبقًا','خصم مخزون جديد',"phone:'رقم الهاتف'","name:'اسم العميل/المستلم'","codAmount:'قيمة التحصيل / COD'"])must(smartUi.includes(marker),`smart shipping UI marker missing: ${marker}`);
must(smartUi.includes('#psSheetImportV59,#jntSheetV60{display:none!important}'),'v64 must replace the split legacy importer UI to keep one governed workflow');
must(index.includes('/v2/modules-v63-shipping-inventory-gate.js?v=63.0'),'v63 shipping inventory UI must load in the active v2 shell');
must(index.includes('/v2/modules-v64-shipping-smart-sync.js?v=64.0'),'v64 smart shipping sync UI must load in the active v2 shell');

for(const marker of ['normalizeShippingPhone','normalizeShippingName','shippingNameSimilarity','shippingAmountMatches','chooseShippingOrderMatch','autoMatchRequiresUnique','ambiguousRowsBlocked','phone+name+collection-amount'])must(matcher.includes(marker),`smart matcher backend marker missing: ${marker}`);
must(normalizeShippingPhone('+20 10 1234 5678')==='01012345678','Egyptian phone normalization must make local/international formats comparable');
must(normalizeShippingPhone('+966 50 123 4567')==='0501234567','Saudi phone normalization must make local/international formats comparable');
must(normalizeShippingName('أحمد مُحمّد')===normalizeShippingName('احمد محمد'),'Arabic names must normalize hamza/diacritics before comparison');
must(shippingNameSimilarity('أحمد محمد علي','احمد محمد على')>.9,'Arabic spelling variants should retain a high name similarity');
must(shippingAmountMatches(650,{total:651}).match===true,'small carrier rounding differences must remain within the safe amount tolerance');

const orders=[
  {id:'ORD-1',ref:'REF-1',awb:'AWB-1',state:'shipped',store_id:'S1',name:'أحمد محمد علي',phone:'01012345678',total:650,collected_amount:null,shipping_cost:70,date:'2026-09-03'},
  {id:'ORD-2',ref:'REF-2',awb:'AWB-2',state:'shipped',store_id:'S1',name:'محمود حسن',phone:'01199999999',total:800,collected_amount:null,shipping_cost:75,date:'2026-09-03'}
];
const composite=chooseShippingOrderMatch({phone:'+20 10 1234 5678',name:'احمد محمد على',amount:650,target:'delivered'},orders);
must(composite.matched&&composite.order.id==='ORD-1'&&composite.matchedBy==='phone-name-amount'&&composite.score>=90,'phone + name + collection amount must auto-match the unique high-confidence order');
for(const field of ['name','phone','total'])must(!(field in composite.order),`server match response must not expose ${field}`);
const strongScore=scoreShippingOrderMatch({phone:'01012345678',name:'أحمد محمد علي',amount:650},orders[0]);must(strongScore.phoneMatch&&strongScore.amountMatch&&strongScore.nameSimilarity>.9&&strongScore.autoEligible,'all three composite signals must qualify as a strong match');
const ambiguous=chooseShippingOrderMatch({phone:'01012345678',name:'أحمد محمد علي',amount:650,target:'delivered'},[orders[0],{...orders[0],id:'ORD-X',ref:'REF-X',awb:'AWB-X'}]);
must(!ambiguous.matched&&ambiguous.ambiguous===true,'equally strong composite matches must be blocked instead of guessed');
const phoneOnly=chooseShippingOrderMatch({phone:'01012345678',target:'delivered'},orders);must(!phoneOnly.matched,'phone alone must never auto-match a carrier row');
const conflictingAwb=chooseShippingOrderMatch({awb:'AWB-1',phone:'01111111111',name:'شخص مختلف تماما',amount:999,target:'delivered'},orders);
must(!conflictingAwb.matched&&conflictingAwb.review===true,'an exact AWB with strongly contradictory identity/amount signals must require review');

must(editBackend.includes("INVENTORY_REPAIR_STATES=new Set(['shipped','signed'])")&&editBackend.includes('latestShippingSheetInventoryBlock(row.history)'),'backend edit exception must be limited to unresolved inventory-blocked shipped/signed orders');
must(editBackend.includes('ORDER_EDIT_STOCK_ALLOCATED'),'repair editing must still reject orders with an active stock allocation');
must(editUi.includes("REPAIR_STATES=new Set(['shipped','signed'])")&&editUi.includes('shipping-sheet-retry'),'frontend repair editor must retry the pending shipping workflow after saving');

const pending=sanitizeShippingSheetPending({target:'delivered',flow:'shipping-sheet-apply',shippingCost:'73.5',carrierName:'J&T Express',carrierFinancials:{provider:'jnt',sheetType:'delivered',codAmount:650,shippingCost:73.5,codServiceFee:8,accessToken:'must-not-survive'},returnBody:{reason:'test'}});
must(pending.target==='delivered'&&pending.shippingCost===73.5,'pending workflow must normalize target and shipping cost');
must(pending.carrierFinancials?.provider==='jnt'&&!('accessToken' in pending.carrierFinancials),'pending history must whitelist financial fields instead of persisting arbitrary payload data');

const blockedEvent={type:'shipping_sheet_inventory_blocked',at:'2026-09-04T10:00:00.000Z',code:'STOCK_FIFO_INSUFFICIENT',reason:'المطلوب 2 والمتاح 0',pending:{target:'delivered'}};
must(latestShippingSheetInventoryBlock([blockedEvent])===blockedEvent,'latest unresolved blocker must be found');
must(latestShippingSheetInventoryBlock([blockedEvent,{type:'shipping_sheet_inventory_resolved',at:'2026-09-04T10:05:00.000Z'}])===null,'a resolved event must clear the blocker');
const decorated=decorateShippingSheetInventoryBlocks({ok:true,orders:[{id:'ORD-1',ref:'REF-1',awb:'AWB-1',state:'shipped',name:'Secret Name',phone:'01000000000',gov:'Cairo',address:'Secret Address',product:'Secret Product',total:900,history:[blockedEvent]}]});
const redacted=decorated.orders[0];
must(redacted.inventoryBlocked===true&&redacted.id==='ORD-1'&&redacted.awb==='AWB-1','blocked operational identifiers must remain available for repair/matching');
for(const [field,value] of [['phone',''],['gov',''],['address',''],['total',null]])must(redacted[field]===value,`blocked order must redact ${field}`);
must(!String(redacted.name).includes('Secret')&&!String(redacted.product).includes('Secret'),'blocked order must not expose customer/product values');

console.log('Shipping-sheet inventory gate contract passed: fully allocated orders never deduct twice; new rows use unique AWB/order identifiers first then safe phone+name+collection-value scoring; ambiguous/conflicting matches stop for review; inventory remains all-or-nothing and finance starts only after inventory validation.');
