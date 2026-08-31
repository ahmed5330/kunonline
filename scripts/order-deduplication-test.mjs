import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {__dedupeTest} from '../src/order-deduplication.js';

const entry=await readFile(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8');
const moduleSource=await readFile(new URL('../src/order-deduplication.js',import.meta.url),'utf8');
const easy={id:'EO-1',created_at:'2026-08-31T08:00:00.000Z',full_name:'أحمد محمد',phone:'201012345678',government:'القاهرة',address:'مدينة نصر - شارع 10',total_cost:1199,shipping_cost:50,cart_items:[{product:{name:'جيبة بليسيه'},variant:{sku:'BURG-L',variation_props:[{variation:'اللون',variation_prop:'برجاندي'},{variation:'المقاس',variation_prop:'L'}]},quantity:2,price:574.5}]};
const sheet={createdAt:'2026-08-31T08:03:00.000Z',name:'أحمد محمد',phone:'01012345678',gov:'القاهرة',address:'مدينة نصر - شارع 10',total:1199,shippingCost:50,items:[{product:'جيبة بليسيه',variant:'المقاس: L | اللون: برجاندي',sku:'BURG-L',qty:2,unitPrice:574.5,lineTotal:1149}]};
const a=__dedupeTest.easySnapshot(easy),b=__dedupeTest.sheetSnapshot(sheet);
assert.equal(__dedupeTest.sameSnapshot(a,b,{requireCloseTime:true}),true,'Identical full Easy Orders/sheet order must match');
const wrongColor=__dedupeTest.sheetSnapshot({...sheet,items:[{...sheet.items[0],variant:'المقاس: L | اللون: بترولي'}]});
assert.equal(__dedupeTest.sameSnapshot(a,wrongColor,{requireCloseTime:true}),false,'Different color/variant must never dedupe');
const wrongPrice=__dedupeTest.sheetSnapshot({...sheet,items:[{...sheet.items[0],unitPrice:575,lineTotal:1150}]});
assert.equal(__dedupeTest.sameSnapshot(a,wrongPrice,{requireCloseTime:true}),false,'Different item price must never dedupe');
const later=__dedupeTest.sheetSnapshot({...sheet,createdAt:'2026-08-31T12:00:00.000Z'});
assert.equal(__dedupeTest.sameSnapshot(a,later,{requireCloseTime:true}),false,'Far-apart identical-looking orders must remain separate');
for(const marker of ['prepareIncomingEasyOrdersDedupe','prepareEasyOrdersSheetRows','persistEasyOrdersLineItems','strict_full_order'])assert.ok(moduleSource.includes(marker),`Dedupe module missing ${marker}`);
for(const marker of ['/api/orders/sheet-import','deduplicatedExact','prepareIncomingEasyOrdersDedupe','prepareEasyOrdersSheetRows'])assert.ok(entry.includes(marker),`v34 dedupe wiring missing ${marker}`);
console.log('Exact order deduplication contract passed: customer/address/date/time, every item, variant, quantity, unit price, line total, shipping and order total must agree before merging.');
