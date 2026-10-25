import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleProductionPreviewParity} from '../src/production-preview-parity.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const req=new Request('https://kun.example/health/preview-parity');
let reads=0;
const database={prepare(){reads++;throw new Error('database must not be accessed before auth');}};
const env={DB:database,PREVIEW_DB:database};
let r=await handleProductionPreviewParity(req,env);
assert.equal(r.status,403,'direct unauthenticated handler must fail closed');
assert.equal(reads,0,'no query may run without an authorizer');
r=await handleProductionPreviewParity(req,env,{authorizeAdmin:async()=>null});
assert.equal(r.status,401,'missing session rejected');
assert.equal(reads,0);
r=await handleProductionPreviewParity(req,env,{authorizeAdmin:async()=>({role:'client'})});
assert.equal(r.status,403,'client role rejected');
assert.equal(reads,0);
for(const identity of [{role:'admin'},{role:'admin',uid:''},{role:'admin',uid:null},{role:'admin',uid:42},{role:'admin',uid:'  '}]){
  r=await handleProductionPreviewParity(req,env,{authorizeAdmin:async()=>identity});
  assert.equal(r.status,403,'admin role without real user id must be denied');
  assert.equal((await r.json()).error,'ADMIN_IDENTITY_REQUIRED');
  assert.equal(reads,0,'incomplete admin identity must not read either database');
}
r=await handleProductionPreviewParity(req,{},{authorizeAdmin:async()=>({role:'admin',uid:'admin-fixture'})});
assert.equal(r.status,503,'authenticated admin reaches binding validation only after auth');
let validReads=0;
const syntheticDb={prepare(){validReads++;return {bind(){return this;},async first(){return null;},async all(){return {results:[]};}};}};
r=await handleProductionPreviewParity(req,{DB:syntheticDb,PREVIEW_DB:syntheticDb},{authorizeAdmin:async()=>({role:'admin',uid:'admin-fixture'})});
assert.equal(r.status,200,'full admin identity may access read-only synthetic snapshot');
assert.ok(validReads>0,'authorized snapshot should query fake D1');
assert.equal((await r.json()).ok,true);
r=await handleProductionPreviewParity(new Request('https://kun.example/health/not-parity'),env);
assert.equal(r,null,'unrelated routes are untouched');

console.log('PASS: parity diagnostics require a complete authenticated Admin identity before any D1 access; missing/forged roles and auth failure remain denied.');

// Exercise the real gateway as well, including forged client role headers.
const {default:gateway}=await import('../src/index-production-mobile-update.js');
for(const [status,identity,expected] of [[401,{error:'AUTH_REQUIRED'},401],[200,{role:'client',uid:'client-a'},403],[200,{role:'admin'},403]]){
 let upstreamCalls=0,diagnosticReads=0;
 const forbiddenDb={prepare(){diagnosticReads++;throw Error('diagnostic DB must remain untouched');}};
 const guardedEnv={DB:forbiddenDb,PREVIEW_DB:forbiddenDb,PREVIEW_APP:{fetch:async input=>{upstreamCalls++;assert.equal(new URL(input.url).pathname,'/api/me');return Response.json(identity,{status});}}};
 const response=await gateway.fetch(new Request('https://kun.example/health/preview-parity',{headers:{'X-Role':'admin','X-User-Id':'forged-admin'}}),guardedEnv,{});
 assert.equal(response.status,expected);assert.equal(upstreamCalls,1);assert.equal(diagnosticReads,0);
}
console.log('PASS: real Production gateway ignores forged role headers and obtains canonical session identity before diagnostics.');
