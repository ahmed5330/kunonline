import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cancelJtShipment,CANCEL_ORDER_PATH} from '../src/jt-express-eg-cancel.js';
import {__jtApiInternals} from '../src/jt-express-eg-api.js';
import {__jtValidationInternals} from '../src/jt-express-eg-validation.js';

const secrets={api_account:'API-123',private_key:'PRIVATE-XYZ',source_code:'D452',customer_code:'J0088',customer_password:'secret'};
await assert.rejects(()=>cancelJtShipment({txlogisticId:'',secrets}),error=>error?.code==='JT_TXLOGISTIC_ID_REQUIRED'&&error?.status===400,'Cancellation must require txlogisticId');
let missingBusinessFetches=0;
await assert.rejects(()=>cancelJtShipment({txlogisticId:'QA-1',secrets:{api_account:'API-123',private_key:'PRIVATE-XYZ',source_code:'D452'},fetcher:async()=>{missingBusinessFetches++;throw new Error('must not fetch');}}),error=>error?.code==='JT_BUSINESS_CREDENTIALS_MISSING'&&error?.status===409,'Cancellation must require Business Info before network access');
assert.equal(missingBusinessFetches,0);

let calls=0;
const result=await cancelJtShipment({txlogisticId:'QA-ORDER-123',reason:'QA complete',secrets,fetcher:async(url,options)=>{
  calls++;
  assert.equal(url,`${__jtApiInternals.LIVE_BASE}${CANCEL_ORDER_PATH}`);
  assert.equal(options.method,'POST');
  assert.equal(options.headers.apiAccount,secrets.api_account);
  const bizContent=new URLSearchParams(options.body).get('bizContent');
  assert.ok(bizContent);
  assert.equal(options.headers.digest,__jtValidationInternals.md5Base64(bizContent+secrets.private_key));
  const payload=JSON.parse(bizContent);
  assert.deepEqual({orderType:payload.orderType,txlogisticId:payload.txlogisticId,reason:payload.reason,customerCode:payload.customerCode},{orderType:'1',txlogisticId:'QA-ORDER-123',reason:'QA complete',customerCode:'J0088'});
  assert.equal(payload.digest,__jtApiInternals.businessDigest('J0088','secret','PRIVATE-XYZ'));
  return new Response(JSON.stringify({code:'1',msg:'success',data:{txlogisticId:'QA-ORDER-123'}}),{status:200,headers:{'Content-Type':'application/json'}});
}});
assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.txlogisticId,'QA-ORDER-123');assert.equal(result.path,CANCEL_ORDER_PATH);

await assert.rejects(()=>cancelJtShipment({txlogisticId:'QA-ORDER-FAIL',secrets,fetcher:async()=>new Response(JSON.stringify({code:'145003050',msg:'Illegal parameters'}),{status:200,headers:{'Content-Type':'application/json'}})}),error=>error?.code==='JT_CANCEL_REJECTED'&&error?.status===422&&error?.jtCode==='145003050','J&T cancellation rejection must fail closed');

const worker=await readFile(new URL('../src/index-commerce-v37.js',import.meta.url),'utf8');
const qa=await readFile(new URL('./live-preview-jt-create-order-qa-once.mjs',import.meta.url),'utf8');
for(const marker of ["env.APP_ENV!=='preview'","me.role!=='admin'","row.source,80)!=='qa_jt_live'",'jt_shipment_cancelled','/api/jt/qa/shipments/'])assert.ok(worker.includes(marker),`Preview cancellation route missing ${marker}`);
for(const marker of ['AWB_CREATED_AND_CANCELLED','/api/jt/qa/shipments/','carrier cancellation failed',"cancelled.state!=='cancelled'","event_type='jt_shipment_cancelled'"])assert.ok(qa.includes(marker),`One-shot J&T QA missing safe cleanup guard ${marker}`);
assert.ok(qa.includes("base!=='https://kunonline-preview.mr-a-mnaa.workers.dev'"),'One-shot J&T QA must be hard-restricted to Preview');
console.log('J&T cancellation QA checks passed: cancelOrder uses Business Signature, fails closed, and one-shot live QA cannot succeed until its synthetic AWB is cancelled at J&T and audited locally.');
