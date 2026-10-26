import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyProviderWaitingReader} from './easyorders-provider-waiting-release-gate.mjs';
for(const payload of [{ok:true},{ok:true,supportsProviderWaitingState:false},{ok:false,supportsProviderWaitingState:true}])
  await assert.rejects(()=>verifyProviderWaitingReader({fetcher:async()=>Response.json(payload)}),/READER_NOT_READY/);
await assert.rejects(()=>verifyProviderWaitingReader({fetcher:async()=>new Response('unavailable',{status:503})}),/READER_NOT_READY/);
let calls=0;
assert.equal((await verifyProviderWaitingReader({fetcher:async(url,init)=>{
  calls++;assert.equal(url,'https://app.kun-online.com/health/easyorders-sync');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  return Response.json({ok:true,supportsProviderWaitingState:true});
}})).ok,true);
assert.equal(calls,1);
const workflow=readFileSync(new URL('../.github/workflows/preview.yml',import.meta.url),'utf8');
const gate=workflow.indexOf('node scripts/easyorders-provider-waiting-release-gate.mjs');
assert.ok(gate>0&&gate<workflow.indexOf('name: Create fresh verified rollback baseline'),'Reader compatibility must be proven before any customer Worker deployment');
console.log('PASS: provider waiting writer requires an already deployed compatible Production reader via one GET-only capability check.');
