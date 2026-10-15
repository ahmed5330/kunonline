import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePreviewRelease,preflightPreview,REQUIRED_RELEASE,REQUIRED_CAPABILITIES}
  from './production-preview-release-gate.mjs';

const complete={ok:true,release:REQUIRED_RELEASE,capabilities:REQUIRED_CAPABILITIES,environment:'preview'};
assert.equal(validatePreviewRelease(complete).ok,true);
for(const bad of [
  {...complete,release:'outdated'},
  {...complete,environment:'production'},
  {...complete,ok:false},
  {...complete,capabilities:REQUIRED_CAPABILITIES.slice(1)},
  {ok:true},
]){
  assert.equal(validatePreviewRelease(bad).ok,false);
}
const response=(data,status=200)=>({status,json:async()=>data});
assert.equal((await preflightPreview({fetcher:async()=>response(complete)})).ok,true);
await assert.rejects(()=>preflightPreview({fetcher:async()=>response({error:'not found'},404)}),/backend first/);
await assert.rejects(()=>preflightPreview({fetcher:async()=>response({...complete,release:'outdated'})}),/incompatible/);
await assert.rejects(()=>preflightPreview({origin:'https://app.kun-online.com',fetcher:async()=>response(complete)}),/unexpected Preview origin/);
const endpoint=await readFile(new URL('../src/index-commerce-v27.js',import.meta.url),'utf8');
assert.ok(endpoint.includes("path==='/api/preview/growth-release'"));
assert.ok(endpoint.includes(REQUIRED_RELEASE));
const workflow=await readFile(new URL('../.github/workflows/production.yml',import.meta.url),'utf8');
assert.ok(workflow.includes('node scripts/production-preview-release-gate.mjs'));
console.log('Production Preview handshake gate contract PASS');
