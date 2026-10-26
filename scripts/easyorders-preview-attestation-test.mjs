import assert from 'node:assert/strict';
import * as entrypoint from '../src/index-commerce-v38.js';
import {readFileSync} from 'node:fs';
const preview=entrypoint.default;
const source=readFileSync(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8');
const KUN_PREVIEW_ENTRYPOINT_BUILD=source.match(/const\s+KUN_PREVIEW_ENTRYPOINT_BUILD\s*=\s*'([^']+)'/)[1];
for(const [name,value] of Object.entries(entrypoint))assert.ok(typeof value==='function'||(name==='default'&&typeof value?.fetch==='function'),'Worker exports must be executable entrypoints');
import scheduler from '../src/sync-scheduler-preview.js';

let reads=0,writes=0,providerCalls=0;
const env={
  APP_ENV:'test-isolated',
  DB:{prepare(){reads++;throw new Error('Version must not read DB');}},
  APP_SYNC:{async health(){return {
    ok:true,entrypoint:'index-commerce-v36.js',build:'preview-v35-legacy-inner',
    outerEntrypoint:'index-commerce-v38.js',outerBuild:KUN_PREVIEW_ENTRYPOINT_BUILD,
    cronExecutionProven:false
  }}}
};
const request=new Request('https://preview.invalid/api/preview/version',{method:'GET'});
const result=await preview.fetch(request,env,{});
assert.equal(result.status,200);
assert.equal(result.headers.get('X-Kun-Build'),KUN_PREVIEW_ENTRYPOINT_BUILD);
assert.match(result.headers.get('Cache-Control')||'',/no-store/);
const body=await result.json();
assert.equal(body.entrypoint,'index-commerce-v38.js');
assert.equal(body.build,KUN_PREVIEW_ENTRYPOINT_BUILD);
assert.equal(body.cronExecutionProven,false);
assert.equal(body.liveOrderRecoveryProven,false);
assert.equal(body.environment,'test-isolated');
const health=await scheduler.fetch(new Request('https://scheduler.invalid/healthz'),env);
assert.equal(health.status,200);
const payload=await health.json();
assert.equal(payload.upstream.outerEntrypoint,'index-commerce-v38.js');
assert.equal(payload.upstream.outerBuild,KUN_PREVIEW_ENTRYPOINT_BUILD);
assert.equal(payload.upstream.build,'preview-v35-legacy-inner');
assert.equal(payload.policy.easyOrdersRecovery,'every-5-minutes');
assert.equal(reads,0);assert.equal(writes,0);assert.equal(providerCalls,0);
console.log('PASS: outer Preview entrypoint is distinguishable from nested v35/v36 compatibility metadata; no live reads/writes.');
