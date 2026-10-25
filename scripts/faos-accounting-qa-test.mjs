import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ACCOUNTS,moneyMinor,normalizeLines,trialBalance,syntheticCommerceScenario} from '../src/accounting-faos-core.js';

const scenario=syntheticCommerceScenario();
assert.equal(scenario.fakeOrders.length,4,'four isolated fake orders expected');
assert.equal(scenario.journalCount,17,'fixture must include exactly seventeen synthetic journals');
assert.equal(scenario.balanced,true,'all journals must be double entry balanced');
assert.deepEqual(scenario.actual,scenario.expected,'profit/COD/partial settlement expectations');
assert.equal(scenario.checks.length,8);
assert.ok(scenario.checks.every(item=>item.pass),'every rule must pass');
assert.equal(scenario.actual.assets,scenario.actual.liabilities+scenario.actual.equity,'accounting equation');
assert.equal(scenario.actual.storeAProfit+scenario.actual.storeBProfit,scenario.actual.netProfit,'stores must reconcile');
assert.equal(scenario.totals.debit,scenario.totals.credit,'debit and credit must balance');
assert.equal(scenario.fakeOrders.find(o=>o.state==='confirmed').recognizedRevenue,0);
assert.equal(scenario.fakeOrders.find(o=>o.state==='returned').recognizedRevenue,0);
assert.equal(trialBalance(scenario.journals,{storeId:'QA-STORE-A'}).netProfitMinor,29000);
assert.equal(trialBalance(scenario.journals,{storeId:'QA-STORE-B'}).netProfitMinor,30000);
assert.ok(ACCOUNTS.length>=25);
assert.equal(moneyMinor(102.34),10234);
assert.throws(()=>moneyMinor(-1),/INVALID_AMOUNT_PRECISION/);
assert.throws(()=>moneyMinor(1.001),/INVALID_AMOUNT_PRECISION/);
assert.throws(()=>normalizeLines([{accountCode:'1120',debit:100},{accountCode:'4100',credit:99}]),/JOURNAL_NOT_BALANCED/);
assert.throws(()=>normalizeLines([{accountCode:'BAD',debit:100},{accountCode:'4100',credit:100}]),/UNKNOWN_ACCOUNT_CODE/);
assert.throws(()=>normalizeLines([{accountCode:'1120',debit:100,credit:100},{accountCode:'4100',credit:100}]),/ONE_SIDED_LINE_REQUIRED/);
assert.throws(()=>normalizeLines([{accountCode:'1120',debit:100}]),/JOURNAL_LINES_REQUIRED/);

const api=fs.readFileSync('src/accounting-faos-api.js','utf8'),
      route=fs.readFileSync('src/index-commerce-v38.js','utf8'),
      migration=fs.readFileSync('migrations/0098_financial_ledger_v1.sql','utf8'),
      front=fs.readFileSync('public/v2/modules-v155-accounting-faos.js','utf8');
assert.match(api,/requirePermission\(me,'finance'/,'financial permission guard');
assert.match(api,/resolveStoreScope\(env,me,clientId,requested/,'tenant/store scope guard');
assert.match(api,/FAOS_PERIOD_CLOSED/,'close guards');
assert.match(api,/sourceType:'reversal'/,'immutable reversal journal');
assert.match(api,/moneyMinor|normalizeLines/,'balanced ledger validation');
assert.match(api,/FAOS_MIGRATION_REQUIRED/,'missing migrations must not produce fake report');
assert.match(migration,/UNIQUE\(client_id, source_type, source_key\)/,'idempotency');
assert.match(migration,/CHECK\(\(debit_minor>0 AND credit_minor=0\)/,'one-side-only SQL constraints');
assert.match(route,/handleFinancialAccountingOS/,'main Cloudflare entrypoint routes FAOS');
assert.match(route,/modules-v155-accounting-faos\.js/,'UI injection');
assert.match(front,/اختبار معزول 100٪/,'test scenario clearly marked simulated');
assert.doesNotMatch(front,/\/api\/orders.*method:\s*['"]POST/,'fixture may not create live orders');
assert.doesNotMatch(api,/INSERT INTO (orders|wallet_log|transactions)\b/,'FAOS must not mutate legacy accounts');
console.log('PASS: FAOS 4 simulated orders, 17 balanced journals, 2 stores, return, COD, partial payout, permission and scope guards.');
