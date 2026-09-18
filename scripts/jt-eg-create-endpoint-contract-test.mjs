import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {__jtApiInternals} from '../src/jt-express-eg-api.js';

const source=await readFile(new URL('../src/jt-express-eg-api.js',import.meta.url),'utf8');

assert.equal(__jtApiInternals.ADD_ORDER_PATH,'/webopenplatformapi/api/order/addOrder','J&T Egypt shipment creation must use addOrder');
assert.equal(__jtApiInternals.CREATE_ORDER_PATH,undefined,'The invalid J&T Egypt createOrder fallback must not be exported');
assert.ok(!source.includes('/webopenplatformapi/api/order/createOrder'),'The J&T Egypt integration must not contain the invalid createOrder endpoint');
assert.ok(!source.includes('CREATE_ORDER_PATH'),'The removed createOrder fallback must not be reintroduced');
assert.match(source,/async function postCreate\([\s\S]*?return signedPost\(ADD_ORDER_PATH,payload,secrets,\{fetcher\}\);/,'Create shipment must go directly through addOrder only');

console.log('J&T Egypt create endpoint contract passed: addOrder is the only shipment-create endpoint; invalid createOrder fallback is absent.');
