import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {__jtApiInternals} from '../src/jt-express-eg-api.js';

const source=await readFile(new URL('../src/jt-express-eg-api.js',import.meta.url),'utf8');
const v38Core=await readFile(new URL('../src/index-commerce-v38-core.js',import.meta.url),'utf8');
const v37=await readFile(new URL('../src/index-commerce-v37.js',import.meta.url),'utf8');

assert.equal(__jtApiInternals.ADD_ORDER_PATH,'/webopenplatformapi/api/order/addOrder','J&T Egypt shipment creation must use addOrder');
assert.equal(__jtApiInternals.CREATE_ORDER_PATH,undefined,'The invalid J&T Egypt createOrder fallback must not be exported');
assert.ok(!source.includes('/webopenplatformapi/api/order/createOrder'),'The J&T Egypt integration must not contain the invalid createOrder endpoint');
assert.ok(!source.includes('CREATE_ORDER_PATH'),'The removed createOrder fallback must not be reintroduced');
assert.match(source,/async function postCreate\([\s\S]*?return signedPost\(ADD_ORDER_PATH,payload,secrets,\{fetcher\}\);/,'Create shipment must go directly through addOrder only');

assert.ok(!v38Core.includes('/webopenplatformapi/api/order/printOrder'),'J&T auth validation/diagnostics must never call printOrder');
assert.ok(!v38Core.includes('PRINT_ORDER_PATH'),'J&T auth validation/diagnostics must not own a print endpoint constant');
assert.match(v38Core,/validateSavedAuth[\s\S]*?attemptPath\(__jtApiInternals\.ADD_ORDER_PATH/,'J&T auth validation must use a deliberately invalid addOrder probe, never printOrder');
assert.match(v38Core,/weight:0/,'J&T auth validation addOrder probe must remain deliberately invalid and non-creating');
assert.match(v37,/async function printShipmentRoute\(/,'The explicit shipment print route must remain present');
assert.match(v37,/\/webopenplatformapi\/api\/order\/printOrder/,'Only the explicit shipment print implementation may own the J&T printOrder endpoint');

console.log('J&T Egypt endpoint contract passed: addOrder is the only create endpoint, auth validation cannot print, and printOrder remains isolated to the explicit print route.');
