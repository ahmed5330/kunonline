import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
const previewWorkflow=await readFile(new URL('../.github/workflows/preview.yml',import.meta.url),'utf8');
assert.ok(previewWorkflow.includes('GROWTH_RELEASE_OUTCOME'),'Preview promotion must include backend compatibility handshake');
assert.ok(previewWorkflow.includes('id: growth_release'),'Preview rollback must be able to identify failed growth release handshakes');
// Exercise the actual CLI entry point: Windows paths must not silently skip it.
const script=fileURLToPath(new URL('./production-preview-release-gate.mjs',import.meta.url));
for(const status of [200,401]){
  const preload='globalThis.fetch=async()=>({status:'+status+',json:async()=>('+JSON.stringify(complete)+')});';
  const child=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),script],
    {encoding:'utf8',timeout:15000});
  assert.ifError(child.error);
  if(status===200){
    assert.equal(child.status,0,child.stderr);
    assert.match(child.stdout,/compatibility PASS/,'CLI must execute the release gate');
  }else{
    assert.notEqual(child.status,0,'CLI must fail closed on HTTP 401');
    assert.match(child.stderr,/HTTP 401/);
  }
}
console.log('Production Preview handshake gate contract PASS');
