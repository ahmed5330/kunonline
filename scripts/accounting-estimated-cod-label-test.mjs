/* Exercise the real accounting KPI rendering with mocked numerical helpers. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const ui=await readFile(new URL('../public/v2/modules-v36-accounting.js',import.meta.url),'utf8');
const monthly=await readFile(new URL('../src/accounting-monthly.js',import.meta.url),'utf8');
const backend=await readFile(new URL('../src/accounting.js',import.meta.url),'utf8');
const start=ui.indexOf('function kpis(m){'),end=ui.indexOf('function categories(m)',start);
assert.ok(start>=0&&end>start,'real accounting KPI renderer must be located');
const kpis=new Function('n','fmt','money',ui.slice(start,end)+'\nreturn kpis;')(
 x=>Number(x)||0,
 x=>String(Number(x)||0),
 x=>String(Number(x)||0)
);
function snapshot(unverified){
 return {currency:'EGP',quality:{unverifiedCollectedOrders:unverified},
  sales:{revenue:1200,collectedRevenue:700},
  costs:{productCost:200,operatingExpenses:60},
  profit:{accountingNetProfit:940,marginPct:78,otherIncome:20},
  cash:{registeredNetCash:610}};
}
const verified=kpis(snapshot(0));
assert.match(verified,/المحصل بمبلغ مسجل/);
assert.match(verified,/صافي التدفق المسجل/);
assert.doesNotMatch(verified,/تحصيل يشمل تقديرات/);
const uncertain=kpis(snapshot(2));
assert.match(uncertain,/تحصيل يشمل تقديرات/);
assert.match(uncertain,/2 طلب بدون مبلغ محصل موثق/);
assert.match(uncertain,/صافي تدفق تقديري/);
assert.match(uncertain,/ليس رصيد بنك/);
assert.doesNotMatch(uncertain,/المحصل فعليًا/);
assert.match(ui,/التحصيل \$\{n\(m\.quality\?\.unverifiedCollectedOrders\)>0/,'P&L explanatory note must be conditional');
assert.match(monthly,/unverifiedCollectedOrders:Number\(overview\.unverifiedCollectedOrders\)/,'monthly API must expose receipt verification status');
assert.match(backend,/SUM\(CASE WHEN o\.collected_amount IS NULL THEN 1 ELSE 0 END\) estimated_amount_orders/);
assert.doesNotThrow(()=>new Function(ui),'accounting browser module must be valid JavaScript');
console.log('Accounting COD label PASS: real KPI renderer distinguishes verified vs estimated collections and net cash with no mutations.');
