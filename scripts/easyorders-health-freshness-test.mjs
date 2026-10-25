import assert from 'node:assert/strict';
import {assessEasyOrdersRecoveryFreshness,handleProductionEasyOrdersHealth}
  from '../src/production-easyorders-health.js';

const now=Date.parse('2026-10-24T03:30:00.000Z');
const recent=new Date(now-5*60_000).toISOString();
const stale=new Date(now-50*60_000).toISOString();
const valid=assessEasyOrdersRecoveryFreshness([{lastRunAt:recent}],now);
assert.deepEqual(valid,{staleConnections:0,neverRanConnections:0,mostRecentRunAt:recent,staleAfterMinutes:20});
const mixed=assessEasyOrdersRecoveryFreshness([
  {lastRunAt:stale},{lastRunAt:null},{lastRunAt:recent},
  {lastRunAt:new Date(now+5*60_000).toISOString()}
],now);
assert.equal(mixed.staleConnections,3);
assert.equal(mixed.neverRanConnections,1);
assert.equal(mixed.mostRecentRunAt,recent);
assert.equal(assessEasyOrdersRecoveryFreshness([{lastRunAt:recent}],now+21*60_000).staleConnections,1);

const fixtureConnection=(id,runAt,explicit='healthy',error='')=>({
 id,client_id:'SYNTHETIC-CLIENT-'+id,status:'connected',
 config_json:JSON.stringify({
   kunStoreId:'SYNTHETIC-STORE-'+id,
   easyOrdersRecoveryHighestShortId:100,
   easyOrdersRecoveryCursor:101,
   easyOrdersRecoveryLastStatus:explicit,
   easyOrdersRecoveryLastRunAt:runAt,
   easyOrdersRecoveryLastError:error,
   api_key:'DO-NOT-EXPOSE-IN-HEALTH'
 })
});
let rows=[fixtureConnection('OLD',stale)];
const env={
  PREVIEW_APP:{fetch:async()=>{throw Error('Must not call live Preview RPC from health');}},
  PREVIEW_DB:{
    prepare(sql){
      assert.match(sql,/^SELECT \* FROM store_connections WHERE /);
      return {bind(){return {all:async()=>({results:rows})}}};
    }
  }
};
const request=new Request('https://synthetic.invalid/health/easyorders-sync');
const check=async()=>{
  const res=await handleProductionEasyOrdersHealth(request,env);
  assert.equal(res.status,200);
  const d=await res.json();
  const source=JSON.stringify(d);
  assert.doesNotMatch(source,/SYNTHETIC-CLIENT|SYNTHETIC-STORE|DO-NOT-EXPOSE|api_key|config_json/);
  assert.equal(d.canonical.connections,rows.length);
  return d;
};
const old=await check();
assert.equal(old.status,'scheduler_stale');
assert.equal(old.runtimeDiagnostics.failureCode,'EASYORDERS_RECOVERY_STALE');
assert.equal(old.runtimeDiagnostics.staleRecoveryConnections,1);

rows=[fixtureConnection('RECENT',new Date().toISOString())];
const healthy=await check();
assert.equal(healthy.status,'healthy');
assert.equal(healthy.runtimeDiagnostics.failureCode,null);

rows=[fixtureConnection('NEVER',null)];
const missing=await check();
assert.equal(missing.status,'scheduler_stale');
assert.equal(missing.runtimeDiagnostics.neverRanRecoveryConnections,1);

rows=[];
const none=await check();
assert.equal(none.status,'no_connections');
assert.equal(none.runtimeDiagnostics.failureCode,'EASYORDERS_NOT_CONNECTED');

rows=[fixtureConnection('INVALID',new Date().toISOString(),'error','HTTP 401 invalid api key: private-synthetic-token')];
const bad=await check();
assert.equal(bad.status,'error');
assert.equal(bad.runtimeDiagnostics.failureCode,'EASYORDERS_API_KEY_INVALID');
assert.doesNotMatch(JSON.stringify(bad),/private-synthetic-token/);
console.log('Read-only Easy Orders health QA PASS: stale, stopped, fresh, disconnected, invalid-key and no metadata leakage.');
