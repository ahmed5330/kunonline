import assert from 'node:assert/strict';
import {startEasyOrdersBeforeLegacy} from '../src/easyorders-cron-priority.js';

let finishLegacy;
let legacyCompleted=false,recoveryStarted=false;
const heldLegacy=new Promise(resolve=>{finishLegacy=()=>{legacyCompleted=true;resolve('legacy done');};});
const waits=[];
const ctx={waitUntil:task=>waits.push(task)};
const start=Date.now();
const result=await startEasyOrdersBeforeLegacy({
  ctx,
  recover:async()=>{recoveryStarted=true;return {ok:true,recovered:2};},
  launchLegacy:outer=>{
    assert.equal(recoveryStarted,true,'Easy Orders must start before legacy analytics');
    outer.waitUntil(heldLegacy);
  }
});
assert.equal(result.ok,true);
assert.equal(result.recovered,2);
assert.equal(legacyCompleted,false,
  'An unrelated slow scheduled analytics job must not block the order result');
assert.ok(Date.now()-start<1000,'The synthetic recovery did not wait for blocked legacy work');
assert.equal(waits.length,1,'Cloudflare waitUntil keeps the old job alive separately');
finishLegacy();
await Promise.all(waits);
assert.equal(legacyCompleted,true);

const badLegacy=startEasyOrdersBeforeLegacy({
  recover:async()=>({ok:true,recovered:1}),
  launchLegacy:()=>{throw Error('synthetic analytics failure')},
  ctx:{waitUntil:task=>{task.catch(()=>{});}}
});
assert.equal((await badLegacy).ok,true,'Analytics errors do not mark order recovery as failed');
await assert.rejects(
  startEasyOrdersBeforeLegacy({
    recover:async()=>{throw Object.assign(Error('synthetic provider rejection'),{code:'SYNC_PROVIDER_FAILED'});},
    launchLegacy:()=>Promise.resolve('unrelated success'),ctx:{waitUntil:()=>{}}
  }),
  {code:'SYNC_PROVIDER_FAILED'},
  'An Easy Orders provider failure must still fail the scheduler RPC'
);
console.log('PASS isolated Cron priority: orders start before unrelated jobs; analytics may hang or fail without blocking; order failures propagate.');
