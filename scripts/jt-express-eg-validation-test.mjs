import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateJtExpressConnection,__jtValidationInternals} from '../src/jt-express-eg-validation.js';
import {validateProviderConnection} from '../src/integration-provider-validation.js';

const b64=value=>createHash('md5').update(String(value),'utf8').digest('base64');
const hex=value=>createHash('md5').update(String(value),'utf8').digest('hex');
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

assert.equal(__jtValidationInternals.md5Hex('abc'),hex('abc'),'Worker-safe MD5 must match Node MD5');
assert.equal(__jtValidationInternals.md5Base64('abc'),b64('abc'),'J&T raw-MD5 Base64 must match Node');

const secrets={api_account:'API-ACCOUNT-123',private_key:'PRIVATE-KEY-XYZ',customer_code:'J0099999999',customer_password:'CUSTOMER-PASSWORD'};
const calls=[];
const fetcher=async(url,options={})=>{
  calls.push({url,options});
  assert.equal(url,'https://openapi.jtjms-eg.com/webopenplatformapi/api/order/getOrders');
  assert.equal(options.method,'POST');
  assert.equal(options.headers.apiAccount,secrets.api_account);
  assert.match(options.headers.timestamp,/^\d+$/);
  assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');
  const params=new URLSearchParams(options.body),bizContent=params.get('bizContent');assert.ok(bizContent,'bizContent form field is required');
  assert.equal(options.headers.digest,b64(bizContent+secrets.private_key),'Header digest must sign the exact transmitted bizContent + privateKey');
  const payload=JSON.parse(bizContent);assert.equal(payload.command,1);assert.equal(payload.customerCode,secrets.customer_code);assert.equal(Array.isArray(payload.serialNumber),true);assert.match(payload.serialNumber[0],/^KUN-VALIDATE-/,'Validation must use a synthetic read-only reference');
  const hashedPassword=hex(secrets.customer_password+'jadada236t2').toUpperCase();assert.equal(payload.digest,b64(secrets.customer_code+hashedPassword+secrets.private_key),'Egypt salted inner digest must match protocol');
  return response({code:'1',msg:'success',data:[]});
};
let result=await validateJtExpressConnection({secrets,fetcher});
assert.equal(result.ok,true);assert.equal(result.status,'connected');assert.equal(result.externalConnectivityChecked,true);assert.equal(result.externalStoreId,secrets.customer_code);assert.equal(result.config.jtEnvironment,'production');assert.equal(result.config.digestMode,'salted');assert.equal(calls.length,1);

// Compatibility fallback: some Egypt account libraries use raw customer password for getOrders.
let attempt=0;
result=await validateJtExpressConnection({secrets,fetcher:async(_url,options)=>{
  attempt++;const bizContent=new URLSearchParams(options.body).get('bizContent'),payload=JSON.parse(bizContent);
  if(attempt===1)return response({code:'145003031',msg:'Business parameter signature verification failed'});
  assert.equal(payload.digest,b64(secrets.customer_code+secrets.customer_password+secrets.private_key));return response({code:'1',msg:'success',data:[]});
}});
assert.equal(result.status,'connected');assert.equal(result.config.digestMode,'raw');assert.equal(attempt,2);

result=await validateProviderConnection({env:{},provider:{id:'jt',name:'J&T Express'},secrets,fetcher:()=>response({code:'1',msg:'success',data:[]})});
assert.equal(result.status,'connected');assert.equal(result.externalConnectivityChecked,true);assert.notEqual(result.code,'PROVIDER_EXTERNAL_VALIDATION_PENDING');

result=await validateJtExpressConnection({secrets:{api_account:'x'},fetcher:()=>{throw new Error('must not call')}});
assert.equal(result.code,'JT_CREDENTIALS_MISSING');assert.equal(result.externalConnectivityChecked,false);
result=await validateJtExpressConnection({secrets,fetcher:()=>response({code:'145003030',msg:'Headers signature verification failed'})});
assert.equal(result.ok,false);assert.equal(result.status,'disconnected');assert.equal(result.code,'JT_CREDENTIALS_REJECTED');assert.equal(result.externalConnectivityChecked,true);

console.log('J&T Express Egypt validation checks passed: four credentials, Worker-safe MD5, exact signed form request, read-only getOrders probe, salted/raw digest compatibility and real provider routing.');
