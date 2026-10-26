import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {easyOrdersRecoveryStatus} from '../src/easyorders-order-reconciliation.js';
import {handleProductionEasyOrdersHealth} from '../src/production-easyorders-health.js';
import {renderGuard} from './dashboard-sync-guard-test.mjs';
let config={easyOrdersRecoveryHighestShortId:1700,easyOrdersRecoveryCursor:1701,
  easyOrdersRecoveryLastStatus:'waiting_for_provider_order',easyOrdersRecoveryLastError:null,
  easyOrdersRecoveryLastRunAt:new Date().toISOString()};
const database={prepare(sql){assert.ok(sql.startsWith('SELECT '));return {bind(){return this;},all:async()=>({results:[{id:'SYNTHETIC-CONNECTION',client_id:'SYNTHETIC-TENANT',config_json:JSON.stringify(config)}]})};}};
const health=await easyOrdersRecoveryStatus({DB:database});
assert.equal(health.status,'waiting_for_provider_order');assert.equal(health.healthyConnections,0);
assert.equal(health.waitingConnections,1);assert.equal(health.errorConnections,0);
const response=await handleProductionEasyOrdersHealth(new Request('https://app.kun-online.com/health/easyorders-sync'),{PREVIEW_DB:database,PREVIEW_APP:{fetch(){throw Error('No service/provider request permitted');}}});
const payload=await response.json();assert.equal(payload.supportsProviderWaitingState,true);
assert.equal(payload.status,'waiting_for_provider_order');assert.equal(payload.canonical.healthyConnections,0);
assert.doesNotMatch(JSON.stringify(payload),/SYNTHETIC-CONNECTION|SYNTHETIC-TENANT/);
const source=readFileSync(new URL('../public/v2/modules-v121-dashboard-sync-guard.js',import.meta.url),'utf8');
const ui=await renderGuard(source,{...payload,source:'tenant',scope:'client'});
assert.match(ui.html,/بانتظار تأكيد رقم الطلب التالي/);assert.doesNotMatch(ui.html,/مكتمل وسليم|توجد مشكلة في مزامنة/);
config={...config,easyOrdersRecoveryHighestShortId:1701};
assert.equal((await easyOrdersRecoveryStatus({DB:database})).status,'catching_up');
config={...config,easyOrdersRecoveryHighestShortId:1700,easyOrdersRecoveryPendingShortIds:[1690]};
assert.equal((await easyOrdersRecoveryStatus({DB:database})).status,'catching_up');
console.log('PASS: Production recognizes deferred provider confirmation without healthy claims, exposes a reader capability and preserves backlog and tenant isolation.');
