/* Offline scheduler outcome + real scheduled RPC wrapper contract.
 * No Cloudflare requests or D1 operations. Only synthetic aggregate results.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import scheduler from '../src/sync-scheduler-preview.js';
import {assertEasyOrdersCronRecovered,checkEasyOrdersCronRecovery}
  from '../src/easyorders-scheduler-outcome.js';
import {describeEasyOrdersProviderError} from '../src/easyorders-order-reconciliation.js';

// An ambiguous upstream "record not found" on HTTP 5xx is a provider error,
// not evidence of a missing Short ID: expose safe numeric status for diagnosis.
assert.deepEqual(
  describeEasyOrdersProviderError({status:503,code:'EASYORDERS_RECONCILIATION_PROVIDER_ERROR',message:'record not found'}),
  {providerHttpStatus:503,providerErrorCategory:'provider_server_error'}
);
assert.deepEqual(
  describeEasyOrdersProviderError({status:403,code:'EASYORDERS_ORDERS_READ_FORBIDDEN'}),
  {providerHttpStatus:403,providerErrorCategory:'provider_auth'}
);
assert.deepEqual(
  describeEasyOrdersProviderError({status:429,code:'EASYORDERS_RECONCILIATION_PROVIDER_ERROR'}),
  {providerHttpStatus:429,providerErrorCategory:'provider_throttle'}
);
assert.deepEqual(
  describeEasyOrdersProviderError({status:409,code:'EASYORDERS_RECOVERY_EXTERNAL_STORE_UNBOUND'}),
  {providerHttpStatus:null,providerErrorCategory:null},
  'Store-binding failure must not be attributed to the upstream API'
);
assert.deepEqual(
  describeEasyOrdersProviderError({status:500,code:'not-provider',message:'private'}),
  {providerHttpStatus:null,providerErrorCategory:null},
  'Non-provider errors must not leak sensitive strings into upstream metadata'
);

const healthy={ok:true,connections:3,checkedConnections:2,uncheckedConnections:1,
  results:[{status:'healthy'},{status:'healthy'}],recovered:1};
assert.equal(checkEasyOrdersCronRecovery({ok:false,status:'waiting_for_provider_order',waitingForProviderConnections:1,
  failedConnections:0,results:[{status:'waiting_for_provider_order'}]}).ok,false,
  'Deferred provider confirmation is never advertised as a completed Cron recovery');
const allowed=checkEasyOrdersCronRecovery(healthy);
const deferred={ok:false,waitingForProviderConnections:1,failedConnections:0,rateLimitedConnections:0,
  checkedConnections:1,uncheckedConnections:0,results:[{status:'waiting_for_provider_order',providerWaitingVerified:true,
    providerHttpStatus:400,providerErrorCategory:'provider_other_http',error:null,highestShortId:1700,nextShortId:1701,
    estimatedRemaining:0,unresolvedAheadCount:0,requests:2}]};
const deferredHealth=checkEasyOrdersCronRecovery(deferred);
assert.equal(deferredHealth.ok,true);assert.equal(deferredHealth.providerRecoveryComplete,false);
assert.equal(deferredHealth.deferredProviderConnections,1);assert.equal(assertEasyOrdersCronRecovered(deferred),deferred);
assert.equal(deferred.ok,false,'Preserve incomplete recovery for callers');
for(const row of [
  {providerWaitingVerified:false},{providerHttpStatus:503},{error:'error'},
  {estimatedRemaining:1},{unresolvedAheadCount:1},{requests:1},{nextShortId:1702}
])assert.equal(checkEasyOrdersCronRecovery({...deferred,results:[{...deferred.results[0],...row}]}).ok,false);
for(const patch of [{waitingForProviderConnections:2},{failedConnections:1},{rateLimitedConnections:1},{feeReconciliation:{failed:1}}])
  assert.equal(checkEasyOrdersCronRecovery({...deferred,...patch}).ok,false);
assert.equal(allowed.ok,true);
assert.equal(allowed.deferredConnections,1,'Normal global request-budget deferral is not provider failure');
assert.equal(assertEasyOrdersCronRecovered(healthy),healthy);
for(const [payload,code] of [
  [{...healthy,ok:false,failedConnections:1,results:[{status:'error'}]},'EASYORDERS_CRON_RECOVERY_FAILED'],
  [{...healthy,ok:false,rateLimitedConnections:1,results:[{status:'rate_limited'}]},'EASYORDERS_CRON_THROTTLED'],
  [{...healthy,ok:true,results:[{status:'error'}]},'EASYORDERS_CRON_RECOVERY_FAILED'],
  [{...healthy,ok:true,rateLimited:true,results:[]},'EASYORDERS_CRON_THROTTLED'],
  [{...healthy,ok:undefined},'EASYORDERS_CRON_RECOVERY_FAILED'],
  [null,'EASYORDERS_CRON_NO_RESULT']
]){
  assert.throws(()=>assertEasyOrdersCronRecovered(payload),error=>{
    assert.equal(error.code,code);
    assert.doesNotMatch(error.message,/tenantId|clientId|connectionId|private|token|customer/i,'Cloudflare scheduler failure must not leak tenant data');
    assert.ok(!('connectionId' in (error.aggregate||{})));
    return true;
  });
}
const protectedResult={
  ok:false,failedConnections:1,rateLimitedConnections:0,
  checkedConnections:1,uncheckedConnections:4,
  results:[{status:'error',connectionId:'DO_NOT_LEAK_CONNECTION_ID',
    error:'DO_NOT_LEAK_PRIVATE_API_TOKEN',clientId:'DO_NOT_LEAK_CUSTOMER_ID'}]
};
let found;
try{assertEasyOrdersCronRecovered(protectedResult);}
catch(error){found=error;}
assert.ok(found);
for(const value of ['DO_NOT_LEAK_CONNECTION_ID','DO_NOT_LEAK_PRIVATE_API_TOKEN','DO_NOT_LEAK_CUSTOMER_ID'])
  assert.ok(!JSON.stringify({message:found.message,code:found.code,aggregate:found.aggregate}).includes(value));

// Actual dedicated scheduler scheduled() passes 5m RPC success and rejection
// through; the canonical Preview handler MUST use the outcome guard above.
const calls=[],waits=[];
const ctx={waitUntil:promise=>waits.push(promise)};
const env={APP_SYNC:{
  runCron:async(cron)=>{calls.push(cron);return assertEasyOrdersCronRecovered(healthy);},
  health:async()=>({ok:true,build:'SYNTHETIC_PREVIEW_RPC'})
}};
const when={cron:'*/5 * * * *',scheduledTime:Date.now()};
const succeeded=await scheduler.scheduled(when,env,ctx);
assert.equal(succeeded.ok,true);
assert.equal(calls.at(-1),'*/5 * * * *');
assert.equal(waits.length,1);
await Promise.all(waits);
env.APP_SYNC.runCron=async()=>assertEasyOrdersCronRecovered(protectedResult);
const pending=[];
await assert.rejects(scheduler.scheduled(when,env,{waitUntil:p=>{pending.push(p.catch(()=>{}));}}),
  error=>error.code==='EASYORDERS_CRON_RECOVERY_FAILED');
await Promise.all(pending);
const v34=await readFile(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8');
assert.match(v34,/return assertEasyOrdersCronRecovered\(withFees\)/,
  'Canonical Preview runCron MUST turn bad Easy Orders recovery into failed RPC');
assert.match(v34,/const withFees=await reconcileRecoveredFees\(env,result\)/,
  'Preserve fee reconciliation even if the run is failed');
assert.match(v34,/if\(cron==='\*\/5 \* \* \* \*'\)/,
  'Only the five-minute Cron uses prioritized Easy Orders recovery');
assert.match(v34,/startEasyOrdersBeforeLegacy\(/,
  'Legacy background tasks must not precede the order recovery task');
assert.match(v34,/lookback:80,trigger:'cron'/,
  'Only a genuine five-minute scheduled call may record the Cron heartbeat');
console.log('Easy Orders scheduler result contract PASS: healthy/partial budget, 429, provider error, missing result, no PII and dedicated Worker RPC rejection. NO cloud calls.');
