import assert from 'node:assert/strict';
import {currentInventoryOrderCost} from '../src/dashboard-live-product-cost.js';

const products=[{id:'P1',cost:30},{id:'P2',cost:70}];
const variants=[{id:'V1',product_id:'P1',cost:55},{id:'V2',product_id:'P1',cost:null}];

assert.equal(currentInventoryOrderCost({order:{id:'O1',product_id:'P1',variant_id:'V1',qty:2,product_cost:999},products,variants}),110,'dashboard must prefer current variant cost over stale saved order product_cost');
assert.equal(currentInventoryOrderCost({order:{id:'O2',product_id:'P1',variant_id:'V2',qty:3,product_cost:999},products,variants}),90,'variant without its own cost must inherit current product cost');
assert.equal(currentInventoryOrderCost({order:{id:'O3',product_id:'P2',qty:2,product_cost:999},products,variants}),140,'dashboard must use current product cost when there is no variant');
assert.equal(currentInventoryOrderCost({order:{id:'O4',product_id:'UNKNOWN',qty:1,product_cost:88},products,variants}),88,'historical order cost is only a fallback for an order that cannot be linked to current inventory');
assert.equal(currentInventoryOrderCost({order:{id:'O5',product_cost:999},orderItems:[{product_id:'P1',variant_id:'V1',qty:2},{product_id:'P2',qty:1}],products,variants}),180,'multi-item order cost must sum current inventory cost for every line');
assert.equal(currentInventoryOrderCost({order:{id:'O6',product_cost:77},orderItems:[{product_id:'P1',qty:1},{product_id:'UNKNOWN',qty:1}],products,variants}),77,'partially unresolved multi-item orders must fall back to the saved whole-order cost instead of undercounting');

console.log('Dashboard current inventory cost regression passed: variant-first current cost overrides stale order snapshots and unresolved orders retain a safe historical fallback.');
