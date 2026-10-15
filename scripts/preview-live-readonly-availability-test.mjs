import assert from 'node:assert/strict';
import {verifyD1Info,fetchD1Storage} from './preview-live-readonly-availability.mjs';
const db={uuid:'31cd5cdf-fc01-42d7-ba1e-571f3dd58495',name:'kunonline-preview',version:'production'};
assert.equal(verifyD1Info({success:true,result:db}).supportsTimeTravel,true);
assert.equal(verifyD1Info([db]).storage,'production');
for(const bad of [{...db,version:undefined},{...db,version:'alpha'},
  {...db,uuid:'other'},{...db,name:'other'},[db,db],
  {success:false,result:db},{errors:[{code:1000}],result:db}])assert.throws(()=>verifyD1Info(bad));
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-test-token'};
let calls=0;
assert.equal((await fetchD1Storage({env,fetcher:async(url,options)=>{
  calls++;assert.equal(options.method,'GET');
  assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+db.uuid);
  assert.equal(options.headers.Authorization,'Bearer synthetic-test-token');
  return {ok:true,json:async()=>({success:true,result:db})};
}})).storage,'production');
assert.equal(calls,1);
await assert.rejects(()=>fetchD1Storage({env,fetcher:async()=>({ok:false,status:403})}),/HTTP 403/);
await assert.rejects(()=>fetchD1Storage({env:{},fetcher:async()=>{throw Error('must not call')}}),/credentials/);
console.log('D1 storage metadata PASS: canonical identity, raw API version, GET only and failed responses rejected.');
