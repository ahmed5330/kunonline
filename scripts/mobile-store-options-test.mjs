import assert from 'node:assert/strict';
import {handleMobileStoreOptions} from '../src/mobile-store-options.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const sample=[
  {store_id:'s1',client_id:'c1',name:'متجر 1',role:'member'},
  {store_id:'s2',client_id:'c2',name:'متجر 2',role:'manager'},
  {store_id:'s3',client_id:'c3',name:'متجر مخصص',role:'manager'}
];
const request=new Request('https://app.kun-online.com/api/mobile/store-options',{headers:{Cookie:'ko_session=test'}});
function fake(role,clientId=null,clients=['c1','c2'],contextStatus=200){
  let calls=[],queries=[];
  const delegate={async fetch(req){
    const path=new URL(req.url).pathname;
    calls.push([path,req.headers.get('Cookie')]);
    if(path==='/api/me')return json({role,uid:'user-1',clientId});
    if(path==='/api/my-client-context')return json({ok:contextStatus===200,clients:clients.map(id=>({id,name:id+' name'}))},contextStatus);
    throw Error('Unexpected network request: '+path);
  }};
  const env={DB:{prepare(sql){
    queries.push(sql);
    return {bind(...args){return {async all(){
      // Every returned row is a real, user-scoped explicit store grant.
      if(sql.includes('user_store_access')){assert.deepEqual(args,['user-1']);return {results:sample};}
      return {results:sample.filter(r=>args.includes(r.client_id))};
    }};},async all(){return {results:sample};}};
  }}};
  return {delegate,env,calls,queries};
}
let f=fake('support');
let res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});
assert.equal(res.status,200);
let data=await res.json();
assert.deepEqual(data.stores.map(s=>s.storeId),['s1','s2','s3']);
assert.deepEqual(data.stores.map(s=>s.clientId),['c1','c2','c3']);
assert.equal(data.stores[2].clientName,'c3','explicit grant from a missing legacy client context remains visible');
assert.deepEqual(f.calls.map(c=>c[0]),['/api/me','/api/my-client-context'],'exactly two identity calls regardless of number of stores');
assert(f.calls.every(x=>x[1]==='ko_session=test'),'preserve session on trusted calls');
assert.equal(f.queries.length,1,'one D1 query for all staff assignments');
assert.match(f.queries[0],/a.user_id=\?/,'filter staff by server-authenticated user');

f=fake('support',null,[]);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});data=await res.json();
assert.deepEqual(data.stores.map(s=>s.storeId),['s1','s2','s3'],'an unbound employee keeps all explicitly granted stores even with an empty client context');
assert.equal(data.clients,3);
f=fake('support',null,[],503);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});data=await res.json();
assert.equal(res.status,200,'explicit unbound staff grants remain available during legacy context outage');
assert.deepEqual(data.stores.map(s=>s.storeId),['s1','s2','s3']);
f=fake('client','c1',['c1'],503);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});
assert.equal(res.status,503,'tenant-bound user must not bypass a failed client context');
f=fake('support',null,[],401);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});
assert.equal(res.status,401,'expired context authentication must deny even explicitly granted staff');
f=fake('admin',null,['c1']);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});data=await res.json();
assert.deepEqual(data.stores.map(s=>s.storeId),['s1'],"administrator client context remains authoritative");
assert(f.queries[0].includes('s.client_id IN'),'owner store query must be client-scoped');
f=fake('client','c2',['c1','c2']);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});data=await res.json();
assert.deepEqual(data.stores.map(s=>s.storeId),['s2'],'tenant-bound users cannot see another tenant');
f=fake('support','c3',['c1']);res=await handleMobileStoreOptions({request,env:f.env,delegate:f.delegate});data=await res.json();
assert.equal(res.status,200,'staff default client is a preference, explicit grants authorize other tenants');
assert.deepEqual(data.stores.map(s=>s.storeId),['s1','s2','s3']);
assert.equal(data.defaultClientId,'c3');
res=await handleMobileStoreOptions({request:new Request('https://app.kun-online.com/api/other'),env:f.env,delegate:f.delegate});
assert.equal(res,null,'do not intercept other routes');
console.log('PASS: store grants drive unbound staff discovery while client/owner isolation stays strict');
