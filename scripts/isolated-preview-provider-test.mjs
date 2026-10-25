import assert from 'node:assert/strict';
import {syntheticProviderFetch,SYNTHETIC_API_KEY} from '../sandbox/easyorders-synthetic-provider.mjs';
const headers={'Api-Key':SYNTHETIC_API_KEY};
for(const id of [1,2,3,4,429,503]){
  const response=await syntheticProviderFetch(`https://api.easy-orders.net/api/v1/external-apps/orders/short/${id}`,{headers});
  assert.equal(response.status,id===429?429:id===503?503:id===4?404:200);
  if(id<4){const order=await response.json();assert.equal(order.id,`QA-PROVIDER-${id}`);assert.equal(order.store_id,'EO-SYNTHETIC-QA');}
}
await assert.rejects(syntheticProviderFetch('https://api.easy-orders.net/api/v1/external-apps/orders/short/1',{headers:{'Api-Key':'REAL_KEY_MUST_NEVER_BE_ACCEPTED'}}),/FORBIDDEN/);
await assert.rejects(syntheticProviderFetch('https://example.com/',{headers}),/FORBIDDEN/);
await assert.rejects(syntheticProviderFetch('https://api.easy-orders.net/api/v1/external-apps/orders/short/1',{method:'POST',headers}),/FORBIDDEN/);
console.log('PASS: synthetic-only provider fixtures cover found/404/429/503 and reject real credentials, writes and other hosts without network access.');
