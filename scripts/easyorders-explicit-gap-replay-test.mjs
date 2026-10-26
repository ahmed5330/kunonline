import assert from 'node:assert/strict';
import {replayExplicitEasyOrdersStoreGaps} from '../src/easyorders-explicit-gap-replay.js';

const c={id:'CON-FAKE',client_id:'TEN-FAKE',external_store_id:'EO-FAKE',
  config_json:JSON.stringify({kunStoreId:'STORE-FAKE'})};
const orders=new Map([['PROVIDER-10',[{id:'order-known',store_id:'STORE-FAKE'}]],
  ['PROVIDER-13',[{id:'legacy',store_id:null}]],
  ['PROVIDER-14',[{id:'other-store',store_id:'STORE-OTHER'}]]]);
let writes=0,apiCalls=[],reads=0;
const env={
  EASYORDERS_TARGETED_RECOVERY_ENABLED:'false',
  DB:{prepare(sql){
    assert.ok(/^SELECT\b/i.test(sql.trim()),'All queries outside canonical webhook MUST be SELECT');
    return {bind(...values){
      reads++;
      return {
        first:async()=>sql.includes('store_connections')&&values[0]==='CON-FAKE'&&values[1]==='TEN-FAKE'?c:null,
        all:async()=>({results:orders.get(values[1])||[]})
      };
    }};
  }}
};
const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers['Api-Key'],'TEST_PROVIDER_TOKEN');
  const n=Number(url.split('/').at(-1));apiCalls.push(n);
  if(n===12)return Response.json({id:'OTHER-12',store_id:'EO-OTHER'});
  if(n===16)return Response.json({error:'record not found'},{status:503});
  if(n===17)return Response.json({error:'too many'},{status:429});
  if(n===18)return Response.json({error:'not found'},{status:404});
  return Response.json({
    id:`PROVIDER-${n}`,store_id:'EO-FAKE',short_id:n,
    full_name:'DO_NOT_LOG_NAME',phone:'01099998888'
  });
};
const ingest=async(_env,row,secrets,order)=>{
  assert.equal(row.id,'CON-FAKE');assert.equal(secrets.api_key,'TEST_PROVIDER_TOKEN');
  writes++;
  orders.set(order.id,[{id:'new-kun-'+order.id,store_id:'STORE-FAKE'}]);
  return {ok:true,id:'new-kun-'+order.id,clientId:'TEN-FAKE',storeId:'STORE-FAKE'};
};
const opts={
  clientId:'TEN-FAKE',storeId:'STORE-FAKE',connectionId:'CON-FAKE',
  confirmStoreId:'STORE-FAKE',confirmBackup:true,
  readSecrets:async()=>({api_key:'TEST_PROVIDER_TOKEN'}),
  fetcher,ingest,reconcileFee:async()=>({ok:true})
};
const recover=(shortIds,overrides={})=>
  replayExplicitEasyOrdersStoreGaps(env,{...opts,shortIds,...overrides});
await assert.rejects(()=>recover([11]),{code:'EASYORDERS_REPLAY_DISABLED'});
assert.equal(writes,0);assert.equal(apiCalls.length,0);assert.equal(reads,0);
env.EASYORDERS_TARGETED_RECOVERY_ENABLED='true';
for(const bad of [
  {confirmBackup:false},{confirmStoreId:'STORE-OTHER'},
  {clientId:'TEN-OTHER'},{connectionId:'CON-OTHER'},{storeId:'STORE-OTHER'}
])await assert.rejects(()=>recover([11],bad));
for(const ids of [[],Array.from({length:11},(_,i)=>i+1),[0],[-1],[10,10],['bad']])
  await assert.rejects(()=>recover(ids),{code:'EASYORDERS_REPLAY_SHORT_IDS_INVALID'});
const r=await recover([10,11,12,13,14,18],{
  reconcileFee:async(_env,id)=>({ok:id!=='never'})
});
assert.equal(r.ok,true);
assert.equal(r.alreadyInKun,1);
assert.equal(r.recovered,2,'Only absent provider orders are replayed to the correct store');
assert.equal(r.foreignStoreSkipped,1);
assert.equal(r.ambiguousLegacyOrders,1);
assert.equal(r.missingAtProvider,1);
assert.equal(writes,2);
assert.deepEqual(r.recoveredOrderIds,['new-kun-PROVIDER-11','new-kun-PROVIDER-14']);
assert.doesNotMatch(JSON.stringify(r),/DO_NOT_LOG_NAME|01099998888|TEST_PROVIDER_TOKEN/);
const again=await recover([11,14]);
assert.equal(again.recovered,0,'Replaying the same range does not overwrite existing orders');
assert.equal(again.alreadyInKun,2);
assert.equal(writes,2);

const beforeMismatchWrites=writes;
const mismatched=await recover([19,11],{
  fetcher:async()=>Response.json({
    id:'WRONG-CUSTOMER-ORDER',store_id:'EO-FAKE',short_id:3333,
    full_name:'DO_NOT_EXPORT_PRIVATE_CUSTOMER'
  })
});
assert.equal(mismatched.ok,false);
assert.equal(mismatched.status,'provider_short_id_mismatch');
assert.equal(mismatched.retryShortId,19);
assert.equal(mismatched.attempted,1);
assert.equal(writes,beforeMismatchWrites,'Wrong provider response must not write any order');
assert.doesNotMatch(JSON.stringify(mismatched),/WRONG-CUSTOMER|PRIVATE_CUSTOMER/);

const providerError=await recover([16,11]);
assert.equal(providerError.ok,false);
assert.equal(providerError.status,'provider_error');
assert.equal(providerError.retryShortId,16);
assert.equal(providerError.attempted,1,'Provider 503 must stop before later IDs');
const beforeRedirectWrites=writes;
const redirected=await recover([19],{fetcher:async(_url,options)=>{
  assert.equal(options.redirect,'manual','Never forward provider credentials to a redirect target');
  return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/order'}});
}});
assert.equal(redirected.ok,false);
assert.equal(redirected.status,'provider_error');
assert.equal(redirected.retryShortId,19);
assert.equal(writes,beforeRedirectWrites);
const throttled=await recover([17,11]);
assert.equal(throttled.ok,false);
assert.equal(throttled.status,'rate_limited');
assert.equal(throttled.retryShortId,17);
assert.equal(throttled.attempted,1);

const feeFailed=await recover([15],{reconcileFee:async()=>{throw Error('synthetic fee error')}});
assert.equal(feeFailed.recovered,1);
assert.equal(feeFailed.feeFailures,1);
assert.equal(feeFailed.ok,false);
assert.equal(feeFailed.status,'fee_reconciliation_failed');
assert.equal(writes,3);

assert.ok(reads>0);
console.log('PASS Easy Orders gated historical gap replay: disabled by default, exact store/tenant, 10-ID limit, no cursor reset, idempotent existing-order safety, 429/503 stop, fee error surfaced.');
