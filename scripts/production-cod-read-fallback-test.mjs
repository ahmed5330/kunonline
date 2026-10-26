import assert from 'node:assert/strict';
import {routeProductionCodRead} from '../src/production-cod-read-fallback.js';

async function scenario({path='/api/cod-reconciliation/summary?clientId=tenant-a&storeId=store-a',method='GET',status=404,payload={error:'مسار غير معروف'},previewBound=true}={}){
  const request=new Request('https://kun.example'+path,{method,...(method==='POST'?{body:'{}'}:{})});
  const calls={upstream:0,local:0};
  const result=await routeProductionCodRead({request,
    fetchPreview:async input=>{calls.upstream++;assert.equal(input,request);return previewBound?Response.json(payload,{status}):null;},
    fetchLocal:async input=>{calls.local++;assert.equal(input,request);return Response.json({ok:true,scope:'authorized-local-handler'});}
  });
  return {calls,result,body:result?await result.json():null};
}
for(const p of ['/api/cod-reconciliation/summary','/api/cod-reconciliation/candidates','/api/cod-reconciliation']){
  const x=await scenario({path:p});
  assert.equal(x.calls.upstream,1);assert.equal(x.calls.local,1);assert.equal(x.body.ok,true);
}
for(const status of [200,401,403,500]){
  const x=await scenario({status,payload:{error:'مسار غير معروف'}});
  assert.equal(x.calls.local,0,'non-404 response cannot be routed around the Preview service');
  assert.equal(x.result.status,status);
}
for(const payload of [{error:'لا تملك صلاحية'}, {error:'Not found'}, {code:'MISSING'}, null]){
  const x=await scenario({status:404,payload});
  assert.equal(x.calls.local,0,'generic 404 cannot trigger fallback');
  assert.equal(x.result.status,404);
}
for(const method of ['POST','PUT','DELETE']){
  const x=await scenario({method,path:'/api/cod-reconciliation'});
  assert.deepEqual(x.calls,{upstream:0,local:0},'never route or replay a financial mutation');
  assert.equal(x.result,null);
}
for(const path of ['/api/wallet','/api/orders','/api/cod-reconciliation/summary/export','/health/preview-parity']){
  const x=await scenario({path});assert.equal(x.result,null);assert.deepEqual(x.calls,{upstream:0,local:0});
}
const unbound=await scenario({previewBound:false});
assert.equal(unbound.calls.local,1,'missing service binding retains authenticated local handler');
assert.equal(unbound.calls.upstream,1);
console.log('Production COD fallback PASS: strict GET allowlist, exact unknown-route 404, auth/error preservation, no financial writes.');
