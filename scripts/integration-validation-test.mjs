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
const invalidFetch=()=>response({error:{message:'Invalid OAuth access token.',type:'OAuthException',code:190}},400);
result=await validateMetaAdsConnection({env,secrets:{access_token:'bad'},fetcher:invalidFetch});assert.equal(result.ok,false);assert.equal(result.status,'disconnected');assert.equal(result.code,'META_TOKEN_INVALID');assert.match(result.message,/غير صالح|منتهي/);
result=await validateProviderConnection({env,provider:{id:'shopify',name:'Shopify'},secrets:{access_token:'x'},fetcher:oneAccountFetch});assert.equal(result.externalConnectivityChecked,false);assert.equal(result.status,'configured');
const worker=await readFile(new URL('../src/index-commerce-v19.js',import.meta.url),'utf8'),ui=await readFile(new URL('../public/v2/modules-v16.js',import.meta.url),'utf8');
for(const marker of ['validateProviderConnection','readConnectionSecrets','externalConnectivityChecked','requiresAccountSelection','adAccountId'])assert.ok(worker.includes(marker),`Integration validation missing ${marker}`);
assert.ok(worker.includes("requirePermission(m,'integrations','write')"),'Validation must require integrations.write');assert.ok(worker.includes('WHERE id=? AND client_id=?'),'Validation must be tenant scoped');
for(const marker of ['حفظ واختبار','اختيار حساب Meta Ads','requiresAccountSelection','إدارة الربط'])assert.ok(ui.includes(marker),`Integration UI missing ${marker}`);
console.log('Integration validation checks passed: Meta token is verified externally, ad accounts are discovered/selected, and connected state is real.');
