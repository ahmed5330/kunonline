import assert from 'node:assert/strict';
import gateway from '../src/index-production-mobile-update.js';
let writes=0,legacyReads=0,upstreamCalls=0;
const env={APP_ENV:'production',FAOS_WRITE_ENABLED:'1',
 DB:{prepare(){legacyReads++;throw Error('Legacy DB must not serve canonical accounting');}},
 PREVIEW_DB:{prepare(sql){assert.match(sql,/\bFROM stores\b/i);return {bind(){return this;},async first(){return {id:'QA-FAOS-S',client_id:'QA-FAOS-C',status:'active'};},async run(){writes++;throw Error('FAOS write forbidden');}};},async batch(){writes++;throw Error('FAOS batch forbidden');}},
 PREVIEW_APP:{fetch:async input=>{upstreamCalls++;assert.equal(new URL(input.url).pathname,'/api/me','A Production financial POST must never be forwarded to a writable Preview API');return Response.json({role:'admin',uid:'QA-ADMIN'});}}
};
const request=new Request('https://qa.example.test/api/accounting/faos/journals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:'QA-FAOS-C',storeId:'QA-FAOS-S'})});
const response=await gateway.fetch(request,env,{});
assert.equal(response.status,403);assert.equal((await response.json()).code,'FAOS_WRITE_DISABLED');
assert.equal(writes,0);assert.equal(legacyReads,0);assert.equal(upstreamCalls,1);
const catalog=await gateway.fetch(new Request('https://qa.example.test/api/accounting/faos/catalog'),env,{});
assert.equal(catalog.status,200);assert.ok((await catalog.json()).accounts.length>0);
assert.equal(writes,0);assert.equal(legacyReads,0);
console.log('PASS: real Production gateway serves FAOS over canonical data and rejects financial writes even with the Preview posting flag enabled.');
