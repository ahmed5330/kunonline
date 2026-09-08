import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateJtExpressConnection,__jtValidationInternals} from '../src/jt-express-eg-validation.js';
import {validateProviderConnection} from '../src/integration-provider-validation.js';

const b64=value=>createHash('md5').update(String(value),'utf8').digest('base64');
const hex=value=>createHash('md5').update(String(value),'utf8').digest('hex');

assert.equal(__jtValidationInternals.md5Hex('abc'),hex('abc'),'Worker-safe MD5 must match Node MD5');
assert.equal(__jtValidationInternals.md5Base64('abc'),b64('abc'),'J&T raw-MD5 Base64 must match Node');

const secrets={api_account:'API-ACCOUNT-123',private_key:'PRIVATE-KEY-XYZ',source_code:'D452'};
let fetchCalled=false;
let result=await validateJtExpressConnection({secrets,fetcher:async()=>{fetchCalled=true;throw new Error('developer-field validation must not make an undocumented endpoint call')}});
assert.equal(result.ok,true);
assert.equal(result.status,'configured');
assert.equal(result.externalConnectivityChecked,false);
assert.equal(result.code,'JT_DEVELOPER_INFO_READY');
assert.equal(result.externalStoreId,secrets.source_code);
assert.equal(result.config.sourceCode,secrets.source_code);
assert.equal(result.config.developerCredentialsReady,true);
assert.equal(fetchCalled,false);

result=await validateProviderConnection({env:{},provider:{id:'jt',name:'J&T Express'},secrets,fetcher:async()=>{throw new Error('must not call')}});
assert.equal(result.status,'configured');
assert.equal(result.code,'JT_DEVELOPER_INFO_READY');
assert.equal(result.externalConnectivityChecked,false);
assert.notEqual(result.code,'PROVIDER_EXTERNAL_VALIDATION_PENDING');

result=await validateJtExpressConnection({secrets:{api_account:'x',private_key:'y'},fetcher:async()=>{throw new Error('must not call')}});
assert.equal(result.code,'JT_CREDENTIALS_MISSING');
assert.equal(result.externalConnectivityChecked,false);
assert.match(result.message,/Source Code/);

console.log('J&T Express Egypt validation checks passed: current Developer Info requires API Account + Private Key + Source Code, with Source Name optional and no undocumented live probe.');
