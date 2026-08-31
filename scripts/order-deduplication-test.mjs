import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sameBusinessOrder,__dedupeV2Test} from '../src/order-deduplication-v2.js';

const [entry,moduleSource,migration]=await Promise.all([
  readFile(new URL('../src/index-commerce-v35.js',import.meta.url),'utf8'),
  readFile(new URL('../src/order-deduplication-v2.js',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0022_order_duplicate_links.sql',import.meta.url),'utf8')
]);
const easy={id:'2fa1a840-1111-4444-9999-123456789abc',short_id:7315,created_at:'2026-08-31T08:00:00.000Z',full_name:'أحمد محمد',phone:'201012345678',government:'القاهرة',address:'مدينة نصر - شارع 10',total_cost:1199,shipping_cost:50,cart_items:[{product:{name:'جيبة بليسيه'},variant:{sku:'BURG-L',variation_props:[{variation:'اللون',variation_prop:'برجاندي'},{variation:'المقاس',variation_prop:'L'}]},quantity:2,price:574.5}]};
const sheet={createdAt:'2026-08-31',name:'احمد محمد',phone:'01012345678',gov:'القاهرة',address:'مدينة نصر شارع ١٠',total:1199,shippingCost:50,items:[{product:'جيبة بليسيه',variant:'المقاس: L | اللون: برجاندي',sku:'BURG-L',qty:2,unitPrice:574.5,lineTotal:1149}]};
const a=__dedupeV2Test.easySnapshot(easy),b=__dedupeV2Test.sheetSnapshot(sheet);
assert.equal(sameBusinessOrder(a,b),true,'Same Easy Orders order must match even when the manual sheet has only the calendar date/midnight');
assert.deepEqual(__dedupeV2Test.easyAliases(easy).sort(),['2fa1a840-1111-4444-9999-123456789abc','7315'].sort(),'Provider UUID and Short ID must both be usable aliases');
assert.ok(__dedupeV2Test.sheetAliases({externalId:'2fa1a840-1111-4444-9999-123456789abc',platformId:'7315'}).includes('7315'),'Sheet platform/Short ID alias must be preserved');
const wrongColor=__dedupeV2Test.sheetSnapshot({...sheet,items:[{...sheet.items[0],variant:'المقاس: L | اللون: بترولي'}]});
assert.equal(sameBusinessOrder(a,wrongColor),false,'Different color/variant must never dedupe');
const wrongPrice=__dedupeV2Test.sheetSnapshot({...sheet,items:[{...sheet.items[0],unitPrice:575,lineTotal:1150}]});
assert.equal(sameBusinessOrder(a,wrongPrice),false,'Different explicit item price must never dedupe');
const preciseFar=__dedupeV2Test.sheetSnapshot({...sheet,createdAt:'2026-08-31T18:00:00.000Z'});
assert.equal(sameBusinessOrder(a,preciseFar),false,'Two precise timestamps far apart must remain separate');
const missingShipping=__dedupeV2Test.sheetSnapshot({...sheet,shippingCost:''});
assert.equal(sameBusinessOrder(a,missingShipping),true,'Missing sheet shipping must be treated as unknown, not as a false mismatch');
for(const marker of ['prepareIncomingEasyOrdersDedupeV2','prepareEasyOrdersSheetRowsV2','reconcileEasyOrdersDuplicates','unique-business-fingerprint','provider-alias','ambiguous'])assert.ok(moduleSource.includes(marker),`Dedupe v2 module missing ${marker}`);
for(const marker of ['order_duplicate_links','duplicate_order_id','canonical_order_id','match_mode'])assert.ok(migration.includes(marker),`Dedupe registry migration missing ${marker}`);
for(const marker of ['/api/orders/dedupe/reconcile','prepareIncomingEasyOrdersDedupeV2','prepareEasyOrdersSheetRowsV2','reconcileEasyOrdersDuplicates','duplicateFilteredResponse','actual-orders-inside-selected-date-range-after-dedupe'])assert.ok(entry.includes(marker),`v35 dedupe/daily-count wiring missing ${marker}`);
console.log('Easy Orders dedupe v2 contract passed: provider aliases first, date-only sheet timestamps supported, unique business fingerprint fallback, variant/price safety and reversible duplicate links.');
