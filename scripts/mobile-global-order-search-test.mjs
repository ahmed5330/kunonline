import assert from 'node:assert/strict';
import {handleMobileOrderSearch,mobileOrderSearchParams} from '../src/mobile-global-order-search.js';

assert.deepEqual(
  mobileOrderSearchParams(new URL('https://example.com/?q=ali&limit=999&offset=9999')),
  {q:'ali',limit:40,offset:1000}
);

function fakeEnv() {
  const calls=[];
  const env={
    DB:{
      prepare(sql) {
        return {
          bind(...params) {
            calls.push({sql,params});
            return {
              async all() {
                return {results:[{
                  id:'K1',ref:'R1',clientId:'C1',storeId:'S1',
                  storeName:'Store',name:'Ali',phone:'010',state:'pending'
                }]};
              }
            };
          }
        };
      }
    }
  };
  return {calls,env};
}

function delegateFor(me) {
  return {
    fetch:async()=>new Response(JSON.stringify(me),{
      status:200,headers:{'Content-Type':'application/json'}
    })
  };
}
async function search(url,me,env) {
  return handleMobileOrderSearch({
    request:new Request(url,{headers:{Cookie:'ko_session=test'}}),
    env,ctx:{},delegate:delegateFor(me)
  });
}
const base='https://app.kun-online.com/api/mobile/orders/search';

{
  const f=fakeEnv();
  const response=await search(base+'?q=ali',{role:'support',uid:'U1',clientId:null},f.env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.orders.length,1);
  assert.match(f.calls[0].sql,/user_store_access/);
  assert.ok(f.calls[0].params.includes('U1'));
  assert.equal(f.calls[0].params.at(-2),26);
}
{
  const f=fakeEnv();
  const response=await search(base+'?q=ali',{role:'support',uid:'U1',clientId:'C1'},f.env);
  assert.equal(response.status,200);
  assert.match(f.calls[0].sql,/user_store_access/);
  assert.equal(f.calls[0].params.includes('C1'),false,'legacy staff default tenant must not restrict explicitly granted stores');
}
{
  const f=fakeEnv();
  const response=await search(base+'?q=ali&clientId=OTHER',{role:'client',clientId:'OWN'},f.env);
  assert.equal(response.status,403);
  assert.equal(f.calls.length,0);
}
{
  const f=fakeEnv();
  const response=await search(base+'?q=a',{role:'admin',clientId:null},f.env);
  assert.equal(response.status,200);
  assert.equal(f.calls.length,0);
}
{
  const f=fakeEnv();
  const response=await search(base+'?q=ali',{role:'viewer',uid:'U2'},f.env);
  assert.equal(response.status,200);
  assert.match(f.calls[0].sql,/user_store_access/);
}
console.log('Mobile global order search scope and pagination checks passed');
