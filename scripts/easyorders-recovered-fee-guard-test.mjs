import assert from 'node:assert/strict';
import {reconcileEasyOrdersRecoveredFees} from '../src/easyorders-recovered-fee-guard.js';
import {assertEasyOrdersCronRecovered} from '../src/easyorders-scheduler-outcome.js';

const fake={ok:true,recoveredOrderIds:['SYNTHETIC-ORDER-1','SYNTHETIC-ORDER-2',
  'SYNTHETIC-ORDER-2','SYNTHETIC-ORDER-3'],checkedConnections:2,
  uncheckedConnections:1,results:[{status:'healthy'},{status:'healthy'}]};
const called=[];
const good=await reconcileEasyOrdersRecoveredFees(fake,async id=>{
  called.push(id);
  return id==='SYNTHETIC-ORDER-2'?{ok:true,skipped:'not_shipped_yet'}:
    {ok:true,status:'active'};
});
assert.deepEqual(called,['SYNTHETIC-ORDER-1','SYNTHETIC-ORDER-2','SYNTHETIC-ORDER-3'],
  'Never create duplicate management fees for a duplicate recovered ID');
assert.deepEqual(good.feeReconciliation,{
  attempted:3,failed:0,skipped:1,succeeded:3,status:'complete'
});
assert.equal(good.ok,true);
assert.equal(assertEasyOrdersCronRecovered(good),good);
const partial=await reconcileEasyOrdersRecoveredFees(fake,async id=>{
  if(id==='SYNTHETIC-ORDER-2')throw new Error('DO_NOT_LEAK_CLIENT_ID_OR_TOKEN');
  if(id==='SYNTHETIC-ORDER-3')return {ok:false,skipped:'order_not_found'};
  return {ok:true,status:'active'};
});
assert.equal(partial.ok,false);
assert.equal(partial.feeReconciliation.attempted,3);
assert.equal(partial.feeReconciliation.failed,2);
assert.equal(partial.feeReconciliation.succeeded,1);
let captured;
try{assertEasyOrdersCronRecovered(partial);}catch(error){captured=error;}
assert.equal(captured.code,'EASYORDERS_CRON_FEE_RECONCILIATION_FAILED');
assert.equal(captured.aggregate.failedFeeReconciliations,2);
assert.doesNotMatch(JSON.stringify({message:captured.message,aggregate:captured.aggregate}),
  /DO_NOT_LEAK|SYNTHETIC-ORDER|client|customer|tenant|token/i,
  'Cron error and logs must never expose IDs or provider/customer data');
assert.ok(!Object.hasOwn(fake,'feeReconciliation'),'Original result must not be mutated');
const upstream={...fake,ok:false,failedConnections:1,results:[{status:'error'}]};
const combined=await reconcileEasyOrdersRecoveredFees(upstream,async()=>({ok:true,status:'active'}));
assert.equal(combined.ok,false,'Fee success must not mask failed provider ingest');
assert.equal(assert.throws(()=>assertEasyOrdersCronRecovered(combined)).code,
  'EASYORDERS_CRON_RECOVERY_FAILED');

await assert.rejects(reconcileEasyOrdersRecoveredFees(null,async()=>({ok:true})),
  /EASYORDERS_FEE_RECONCILIATION_RESULT_INVALID/);
await assert.rejects(reconcileEasyOrdersRecoveredFees(fake,null),
  /EASYORDERS_FEE_RECONCILIATION_CALLBACK_INVALID/);
const noNewOrders=await reconcileEasyOrdersRecoveredFees({...fake,recoveredOrderIds:[]},
  async()=>{throw new Error('Must not be called');});
assert.equal(noNewOrders.ok,true);
assert.equal(noNewOrders.feeReconciliation.attempted,0);
console.log('Easy Orders recovered management fee PASS: dedupe, active/pending, exception, result failure, sanitized Cloudflare Cron and no duplicate writes.');
