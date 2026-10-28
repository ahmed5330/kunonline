import assert from 'node:assert/strict';
import {createIsolatedQaFetch} from './isolated-qa-fetch.mjs';
const baseUrl='https://kunonline-isolated-qa-1230001.example.workers.dev',approvedDatabaseId='11111111-2222-4333-8444-555555555555';
const configText=`name = "kunonline-isolated-qa-1230001"\nmain = "sandbox/preview-isolated-worker.mjs"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "kunonline-isolated-qa-1230001"\ndatabase_id = "${approvedDatabaseId}"\n`;
const options={baseUrl,approvedDatabaseId,configText,wait:async()=>{}};
const failure=code=>Object.assign(new TypeError('network fixture'),{cause:{code}});
let calls=0;
const eventual=createIsolatedQaFetch(async()=>{if(++calls<3)throw failure('ECONNRESET');return new Response('ok');},options);
assert.equal(await (await eventual(baseUrl+'/read')).text(),'ok');assert.equal(calls,3);
for(const method of ['POST','PATCH','DELETE']){
  calls=0;const error=failure('ECONNRESET');
  const f=createIsolatedQaFetch(async()=>{calls++;throw error;},options);
  await assert.rejects(f(baseUrl+'/write',{method,body:'{}'}),e=>e===error);
  assert.equal(calls,1,'ambiguous writes are not replayed');
}
calls=0;
const connect=createIsolatedQaFetch(async(url,init)=>{assert.equal(init.redirect,'error');assert.equal(init.body,'{}');if(++calls===1)throw failure('UND_ERR_CONNECT_TIMEOUT');return new Response('created',{status:201});},options);
assert.equal((await connect(baseUrl+'/stores',{method:'POST',body:'{}'})).status,201);assert.equal(calls,2);
for(const status of [401,403,429,500,503]){
  calls=0;const f=createIsolatedQaFetch(async()=>{calls++;return new Response('',{status});},options);
  assert.equal((await f(baseUrl+'/read')).status,status);assert.equal(calls,1,'HTTP failures are not hidden');
}
calls=0;const exhausted=createIsolatedQaFetch(async()=>{calls++;throw failure('UND_ERR_CONNECT_TIMEOUT');},options);
await assert.rejects(exhausted(baseUrl+'/read'));assert.equal(calls,3);
for(const url of ['https://app.kun-online.com/read','https://other.example/read',`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/d1/database/other/query`]){
  calls=0;const f=createIsolatedQaFetch(async()=>{calls++;throw failure('UND_ERR_CONNECT_TIMEOUT');},options);
  await assert.rejects(f(url,{method:'POST',body:'{}'}));assert.equal(calls,1,'out of scope requests are not retried');
}
calls=0;const controller=new AbortController();controller.abort();
const aborted=createIsolatedQaFetch(async()=>{calls++;throw failure('UND_ERR_CONNECT_TIMEOUT');},options);
await assert.rejects(aborted(baseUrl+'/read',{signal:controller.signal}));assert.equal(calls,1);
calls=0;const oneShot=createIsolatedQaFetch(async()=>{calls++;throw failure('UND_ERR_CONNECT_TIMEOUT');},options);
await assert.rejects(oneShot(baseUrl+'/write',{method:'POST',body:new ReadableStream()}));assert.equal(calls,1);
calls=0;const redirectError=createIsolatedQaFetch(async()=>{calls++;throw new TypeError('redirect blocked');},options);
await assert.rejects(redirectError(baseUrl+'/write',{method:'POST',body:'{}'}));assert.equal(calls,1);
assert.throws(()=>createIsolatedQaFetch(fetch,{...options,baseUrl:'https://app.kun-online.com'}),/ISOLATION/);
console.log('Isolated QA transport PASS: bounded read recovery, pre-connect-only write recovery, HTTP/auth preservation and no ambiguous write replay.');
