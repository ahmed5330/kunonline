import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditEffectiveBindings,parseWorkerConfig} from './cloudflare-effective-bindings-readonly.mjs';

const productionConfig=readFileSync(new URL('../wrangler.production.toml',import.meta.url),'utf8');
const previewConfig=readFileSync(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const prod=parseWorkerConfig(productionConfig),prev=parseWorkerConfig(previewConfig);
assert.equal(prod.name,'kunonline');
assert.equal(prev.name,'kunonline-preview');
const prodId=prod.d1.find(b=>b.binding==='DB').database_id;
const canonical=prev.d1.find(b=>b.binding==='DB').database_id;
assert.equal(prod.d1.find(b=>b.binding==='PREVIEW_DB').database_id,canonical);
assert.notEqual(prodId,canonical,'Production and shared Preview D1 IDs differ');

const settings={
  'kunonline':[
    {name:'DB',type:'d1',database_id:prodId},
    {name:'PREVIEW_DB',type:'d1',database_id:canonical},
    {name:'PREVIEW_APP',type:'service',service:'kunonline-preview'},
    {name:'ASSETS',type:'assets'}
  ],
  'kunonline-preview':[{name:'DB',type:'d1',database_id:canonical}]
};
const accountId='a'.repeat(32),token='SYNTHETIC-TEST-TOKEN';
const requests=[];
const fetcher=async(url,options)=>{
  requests.push({url,options});
  const worker=url.includes('/scripts/kunonline-preview/')?'kunonline-preview':'kunonline';
  return Response.json({success:true,result:{bindings:settings[worker]}});
};
const args={productionConfig,previewConfig,accountId,token,fetcher};
let output=await auditEffectiveBindings(args);
assert.equal(output.ok,true);
assert.equal(output.remoteBindingsVerified,true);
assert.equal(output.customerDataIsolationVerified,false,
  'Correct remote bindings are NOT proof that shared Preview D1 is isolated');
assert.equal(output.backupRestoreVerified,false,
  'A settings GET does NOT verify a restored customer-data backup');
assert.equal(output.releaseApproved,false,
  'Runtime audit must never authorize Production deployment');
assert.equal(requests.length,2);
for(const {url,options} of requests){
  assert(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'));
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.body,undefined,'Never send SQL, credentials or writes');
}
async function rejected(mutator,reason){
  const copy=JSON.parse(JSON.stringify(settings));
  mutator(copy);
  await assert.rejects(()=>auditEffectiveBindings({...args,fetcher:async url=>{
    const worker=url.includes('/scripts/kunonline-preview/')?'kunonline-preview':'kunonline';
    return Response.json({success:true,result:{bindings:copy[worker]}});
  }}),reason);
}
await rejected(s=>{s.kunonline[1].database_id=prodId},/DATABASE_ID_MISMATCH_PREVIEW_DB/);
await rejected(s=>{s.kunonline[2].service='malicious-preview'},/SERVICE_MISMATCH_PREVIEW_APP/);
await rejected(s=>{s['kunonline-preview'][0].database_id=prodId},/DATABASE_ID_MISMATCH_DB/);
await rejected(s=>{s.kunonline.push({...s.kunonline[0]})},/MISSING_OR_DUPLICATE_DB/);
await assert.rejects(()=>auditEffectiveBindings({...args,token:''}),/AUTH_UNAVAILABLE/);
await assert.rejects(()=>auditEffectiveBindings({...args,fetcher:async()=>Response.json({errors:[{message:'private'}]}, {status:403})}),/SETTINGS_HTTP_403/);
await assert.rejects(()=>auditEffectiveBindings({...args,fetcher:async()=>Response.json({success:true,result:{}})}),/SETTINGS_SHAPE/);
await assert.rejects(()=>auditEffectiveBindings({...args,previewConfig:previewConfig.replace(canonical,prodId)}),/SHARED_PREVIEW_CONFIG/);
console.log('PASS read-only Cloudflare Worker/D1/service binding audit: 2 GETs, strict IDs, fail-closed, zero production mutations');
