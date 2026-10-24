/* Offline scheduler outcome + real scheduled RPC wrapper contract.
 * No Cloudflare requests or D1 operations. Only synthetic aggregate results.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import scheduler from '../src/sync-scheduler-preview.js';
import {assertEasyOrdersCronRecovered,checkEasyOrdersCronRecovery}
  from '../src/easyorders-scheduler-outcome.js';

const healthy={ok:true,connections:3,checkedConnections:2,uncheckedConnections:1,
  results:[{status:'healthy'},{status:'healthy'}],recovered:1};
const allowed=checkEasyOrdersCronRecovery(healthy);
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
assert.match(v34,/return assertEasyOrdersCronRecovered\(result\)/,
  'Canonical Preview runCron MUST turn bad Easy Orders recovery into failed RPC');
assert.match(v34,/await reconcileRecoveredFees\(env,result\)/,
  'Preserve fee reconciliation even if the run is failed');
assert.match(v34,/cron!=='\*\/5 \* \* \* \*'/,
  'Only 5-minute Easy Orders cron is changed');
console.log('Easy Orders scheduler result contract PASS: healthy/partial budget, 429, provider error, missing result, no PII and dedicated Worker RPC rejection. NO cloud calls.');
