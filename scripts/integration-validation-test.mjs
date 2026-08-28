import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateMetaAdsConnection,validateProviderConnection} from '../src/integration-provider-validation.js';

const env={META_GRAPH_API_VERSION:'v25.0'};
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
function oneAccountFetch(url){const u=new URL(url);if(u.pathname.endsWith('/me'))return response({id:'USR-1',name:'QA User'});if(u.pathname.endsWith('/me/adaccounts'))return response({data:[{id:'act_12345',account_id:'12345',name:'Wefaq Ads',account_status:1,currency:'EGP',timezone_name:'Africa/Cairo'}]});if(u.pathname.endsWith('/act_12345'))return response({id:'act_12345',account_id:'12345',name:'Wefaq Ads',account_status:1,currency:'EGP',timezone_name:'Africa/Cairo'});return response({error:{message:'unexpected URL',code:100}},400);}
let result=await validateMetaAdsConnection({env,secrets:{access_token:'qa-token'},fetcher:oneAccountFetch});
assert.equal(result.ok,true);assert.equal(result.status,'connected');assert.equal(result.externalConnectivityChecked,true);assert.equal(result.account.accountId,'12345');assert.equal(result.config.adAccountId,'12345');assert.equal(result.externalStoreId,'act_12345');

const multiFetch=url=>{const u=new URL(url);if(u.pathname.endsWith('/me'))return response({id:'USR-2',name:'QA User'});if(u.pathname.endsWith('/me/adaccounts'))return response({data:[{id:'act_1',account_id:'1',name:'Account One',account_status:1,currency:'EGP'},{id:'act_2',account_id:'2',name:'Account Two',account_status:1,currency:'USD'}]});if(u.pathname.endsWith('/act_2'))return response({id:'act_2',account_id:'2',name:'Account Two',account_status:1,currency:'USD'});return response({error:{message:'unexpected URL',code:100}},400);};
result=await validateMetaAdsConnection({env,secrets:{access_token:'qa-token'},fetcher:multiFetch});assert.equal(result.ok,true);assert.equal(result.status,'configured');assert.equal(result.requiresAccountSelection,true);assert.equal(result.accounts.length,2);
result=await validateMetaAdsConnection({env,secrets:{access_token:'qa-token'},selectedAdAccountId:'act_2',fetcher:multiFetch});assert.equal(result.status,'connected');assert.equal(result.account.accountId,'2');

// Multi-tenant regression: the validator must be stateless and derive every Meta identity/account from that tenant's token.
function tenantFetch({token,userId,accountId,accountName,currency}){return (url,options={})=>{assert.equal(options?.headers?.Authorization,`Bearer ${token}`,'Meta request must use only the current tenant token');const u=new URL(url);if(u.pathname.endsWith('/me'))return response({id:userId,name:`User ${userId}`});if(u.pathname.endsWith('/me/adaccounts'))return response({data:[{id:`act_${accountId}`,account_id:accountId,name:accountName,account_status:1,currency}]});if(u.pathname.endsWith(`/act_${accountId}`))return response({id:`act_${accountId}`,account_id:accountId,name:accountName,account_status:1,currency});return response({error:{message:'unexpected tenant URL',code:100}},400);};}
const tenantA=await validateMetaAdsConnection({env,secrets:{access_token:'tenant-a-token'},fetcher:tenantFetch({token:'tenant-a-token',userId:'USR-A',accountId:'111',accountName:'Tenant A Ads',currency:'EGP'})});
const tenantB=await validateMetaAdsConnection({env,secrets:{access_token:'tenant-b-token'},fetcher:tenantFetch({token:'tenant-b-token',userId:'USR-B',accountId:'222',accountName:'Tenant B Ads',currency:'SAR'})});
assert.equal(tenantA.status,'connected');assert.equal(tenantB.status,'connected');
assert.equal(tenantA.identity.id,'USR-A');assert.equal(tenantB.identity.id,'USR-B');
assert.equal(tenantA.account.accountId,'111');assert.equal(tenantB.account.accountId,'222');
assert.equal(tenantA.externalStoreId,'act_111');assert.equal(tenantB.externalStoreId,'act_222');
assert.notEqual(tenantA.account.accountId,tenantB.account.accountId,'Tenant Meta accounts must never bleed across validations');

const invalidFetch=()=>response({error:{message:'Invalid OAuth access token.',type:'OAuthException',code:190}},400);
result=await validateMetaAdsConnection({env,secrets:{access_token:'bad'},fetcher:invalidFetch});assert.equal(result.ok,false);assert.equal(result.status,'disconnected');assert.equal(result.code,'META_TOKEN_INVALID');assert.match(result.message,/غير صالح|منتهي/);
result=await validateProviderConnection({env,provider:{id:'shopify',name:'Shopify'},secrets:{access_token:'x'},fetcher:oneAccountFetch});assert.equal(result.externalConnectivityChecked,false);assert.equal(result.status,'configured');

const worker=await readFile(new URL('../src/index-commerce-v19.js',import.meta.url),'utf8');
const validator=await readFile(new URL('../src/integration-provider-validation.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/v2/modules-v16.js',import.meta.url),'utf8');
for(const marker of ['validateProviderConnection','readConnectionSecrets','externalConnectivityChecked','requiresAccountSelection','adAccountId'])assert.ok(worker.includes(marker),`Integration validation missing ${marker}`);
assert.ok(worker.includes("requirePermission(m,'integrations','write')"),'Validation must require integrations.write');
for(const marker of [
  'SELECT * FROM store_connections WHERE id=? AND client_id=?',
  'SELECT secret_name FROM integration_secrets WHERE client_id=? AND connection_id=?',
  'UPDATE store_connections SET status=?'
])assert.ok(worker.includes(marker),`Tenant-scoped integration persistence missing ${marker}`);
assert.ok(validator.includes('WHERE client_id=? AND connection_id=?'),'Secret reads must be tenant + connection scoped');
for(const marker of ['حفظ واختبار','اختيار حساب Meta Ads','requiresAccountSelection','إدارة الربط'])assert.ok(ui.includes(marker),`Integration UI missing ${marker}`);
const runtimeSources=`${worker}\n${validator}\n${ui}`;
assert.equal(runtimeSources.includes('Wefaq Ads'),false,'Production runtime must never hard-code the QA customer/account name');
assert.equal(runtimeSources.includes('وفاق'),false,'Production runtime must never hard-code a customer name');
console.log('Integration validation checks passed: real Meta verification, account selection, tenant isolation and no customer-specific hard-coding.');
