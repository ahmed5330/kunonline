/* Offline safety/semantics contract for real dedicated scheduler events.
 * No Cloudflare credentials, routes, providers or user data are contacted. */
import assert from 'node:assert/strict';
import scheduler from '../src/sync-scheduler-preview.js';
const realInfo=console.info,realError=console.error;
const log=[];
console.info=(...x)=>log.push(['info',...x]);
console.error=(...x)=>log.push(['error',...x]);
try{
  const runs=[];
  const base={
    APP_SYNC:{
      async runCron(cron,scheduledTime){runs.push({cron,scheduledTime});return {ok:true,recovered:2};},
      async health(){return {ok:true,service:'kunonline-sync-rpc',build:'fake-test'};}
    }
  };
  const successWait=[];
  const delivered=await scheduler.scheduled(
    {cron:'*/5 * * * *',scheduledTime:1700000000000},
    base,{waitUntil:x=>successWait.push(x)}
  );
  assert.equal(delivered.ok,true);
  assert.deepEqual(runs,[{cron:'*/5 * * * *',scheduledTime:1700000000000}]);
  assert.equal(successWait.length,1);
  await Promise.all(successWait);
  assert.equal(log.filter(x=>x[1]==='KUN_SYNC_CRON_STARTED').length,1);
  assert.equal(log.filter(x=>x[1]==='KUN_SYNC_CRON_COMPLETED').length,1);
  assert.equal(log.filter(x=>x[1]==='KUN_SYNC_CRON_FAILED').length,0);
  const page=await scheduler.fetch(new Request('https://fake.invalid/healthz'),base);
  assert.equal(page.status,200);
  const body=await page.json();
  assert.match(body.build,/v2\.4/);
  assert.equal(body.policy.easyOrdersRecovery,'every-5-minutes');
  assert.equal(log.length,2,'Health endpoint must not imply Cron execution');
  const sensitive='SYNTHETIC_PRIVATE_ORDER_ID_AND_API_KEY';
  base.APP_SYNC.runCron=async()=>{throw Object.assign(new Error(sensitive),{
    code:'EASYORDERS_CRON_RECOVERY_FAILED'
  });};
  const failedWait=[];
  await assert.rejects(scheduler.scheduled({cron:'*/5 * * * *'},
    base,{waitUntil:promise=>failedWait.push(promise.catch(()=>{}))}),
    /SYNTHETIC_PRIVATE_ORDER_ID_AND_API_KEY/);
  await Promise.all(failedWait);
  assert.deepEqual(log.at(-1).slice(0,2),['error','KUN_SYNC_CRON_FAILED']);
  assert.equal(log.at(-1).at(-1),'EASYORDERS_CRON_RECOVERY_FAILED');
  assert.ok(!JSON.stringify(log).includes(sensitive),
    'Cron logs must never contain provider response body, order ID or secret');
  base.APP_SYNC.runCron=async()=>{throw Object.assign(Error(sensitive),{
    code:'TENANT_PRIVATE_SECRET_IN_ERROR_CODE'
  });};
  const scrubWait=[];
  await assert.rejects(scheduler.scheduled({cron:'*/5 * * * *'},
    base,{waitUntil:promise=>scrubWait.push(promise.catch(()=>{}))}));
  await Promise.all(scrubWait);
  assert.equal(log.at(-1).at(-1),'SYNC_TASK_FAILED',
    'Unrecognized provider exception codes may not enter Cloudflare logs');
  assert.ok(!JSON.stringify(log).includes(sensitive));
  base.APP_SYNC.runCron=async cron=>{runs.push({cron});return {ok:true};};
  const metaWait=[];
  await scheduler.scheduled({cron:'*/15 * * * *'},base,{waitUntil:p=>metaWait.push(p)});
  await Promise.all(metaWait);
  assert.equal(runs.at(-1).cron,'* * * * *',
    'Existing native 15-minute Meta policy is preserved');
  console.info=realInfo;
  console.error=realError;
  console.log('Dedicated Scheduler synthetic real-Cron telemetry PASS: private RPC, 5m tick, failure propagation, redacted logs, health never claims Cron ran.');
}catch(error){
  console.info=realInfo;console.error=realError;throw error;
}
