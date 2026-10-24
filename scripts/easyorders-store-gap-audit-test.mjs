import assert from 'node:assert/strict';
import {auditEasyOrdersStoreGapRange} from '../src/easyorders-store-gap-audit.js';

// These tests do not call real Easy Orders, Cloudflare or production D1.
// Any attempt to mutate a DB record immediately fails.
const connection={
  id:'CON-W',client_id:'TEN-W',external_store_id:'EO-W',
  config_json:JSON.stringify({kunStoreId:'STORE-W'})
};
const known=new Map([
  ['EA-400',[{id:'kun-existing',store_id:'STORE-W'}]],
  ['EA-406',[{id:'conflict-in-another-store',store_id:'STORE-X'}]],
  ['EA-407',[{id:'ambiguous-legacy',store_id:null}]]
]);
const queries=[];
const db={
  prepare(sql){
    assert.ok(/^SELECT\b/i.test(sql.trim()),'Read-only D1 SELECT only');
    return {
      bind(...args){
        queries.push({sql,args});
        return {
          async first(){
            assert.match(sql,/store_connections/);
            return args[0]==='CON-W'&&args[1]==='TEN-W'?connection:null;
          },
          async all(){
            assert.match(sql,/\borders\b/);
            assert.equal(args[0],'TEN-W');
            return {results:known.get(args[1])||[]};
          },
          async run(){throw Error('Database writes forbidden');}
        };
      }
    };
  }
};
const calls=[];
const noWriteFetcher=async(url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers['Api-Key'],'FAKE-AUTH-SECRET');
  assert.match(url,/^https:\/\/api\.easy-orders\.net\/api\/v1\/external-apps\/orders\/short\/\d+$/);
  const id=Number(url.split('/').at(-1));calls.push(id);
  if(id===403)return Response.json({message:'record not found'},{status:404});
  if(id===404)return Response.json({message:'rate limit'},{status:429});
  if(id===405)return Response.json({message:'record not found'},{status:503});
  if(id===408)return Response.json({message:'denied'},{status:403});
  return Response.json({
    id:`EA-${id}`,short_id:id,store_id:id===402?'EO-OTHER':'EO-W',
    full_name:'PERSONAL_NAME_MUST_NOT_LEAK',phone:'01112345678'
  });
};
const options={
  clientId:'TEN-W',storeId:'STORE-W',connectionId:'CON-W',
  readSecrets:async()=>({api_key:'FAKE-AUTH-SECRET'}),
  fetcher:noWriteFetcher,env:'no'
};
const environment={DB:db};
const run=(fromShortId,toShortId,overrides={})=>
  auditEasyOrdersStoreGapRange(environment,{...options,fromShortId,toShortId,...overrides});

const a=await run(400,403);
assert.equal(a.ok,true);
assert.equal(a.mode,'read_only');
assert.equal(a.requests,4);
assert.equal(a.alreadyInKun,1);
assert.equal(a.missingInKun,1);
assert.equal(a.foreignStoreSkipped,1);
assert.equal(a.missingAtProvider,1);
assert.deepEqual(a.gaps,[{shortId:401,sourceOrderId:'EA-401'}]);
assert.equal(a.nextShortId,404);
assert.doesNotMatch(JSON.stringify(a),/PERSONAL_NAME|01112345678|FAKE-AUTH-SECRET/);

const throttle=await run(403,406);
assert.equal(throttle.status,'rate_limited');
assert.equal(throttle.nextShortId,404);
assert.equal(throttle.requests,2);
assert.ok(!calls.includes(405),'Do not skip a throttled Short ID');

const provider=await run(405,406);
assert.equal(provider.status,'provider_error');
assert.equal(provider.nextShortId,405);
assert.equal(provider.missingAtProvider,0,'503 body cannot masquerade as a missing order');

const collision=await run(406,407);
assert.equal(collision.missingInKun,1,'Cross-store same provider ID is not present in this store');
assert.equal(collision.ambiguousLegacyOrders,1,'Unscoped legacy collision requires operator review');
assert.deepEqual(collision.gaps,[{shortId:406,sourceOrderId:'EA-406'}]);

const forbidden=await run(408,409);
assert.equal(forbidden.status,'provider_forbidden');
assert.equal(forbidden.nextShortId,408);

for(const overrides of [
  {clientId:'TEN-OTHER'},
  {storeId:'STORE-OTHER'},
  {connectionId:'CON-OTHER'}
])await assert.rejects(()=>run(400,400,overrides));

for(const [from,to] of [[0,1],[10,9],[10,40],[-1,20],['NaN',5]]) {
  await assert.rejects(()=>run(from,to),{code:'EASYORDERS_AUDIT_RANGE_INVALID'});
}
await assert.rejects(()=>run(400,400,{readSecrets:async()=>({})}),{code:'EASYORDERS_AUDIT_KEY_MISSING'});
await assert.rejects(()=>run(400,400,{
  readSecrets:async()=>({api_key:'TEST'}),fetcher:()=>{throw Error('Unauthorized network use');}
}).then(x=>{assert.equal(x.status,'provider_network_error');return Promise.reject(Error('expected error'));}),/expected error/);
const unverified={...connection,external_store_id:'CON-W'};
const unverifiedDb={prepare(sql){return {bind(){return {first:async()=>unverified}}}}};
await assert.rejects(()=>auditEasyOrdersStoreGapRange({DB:unverifiedDb},{
  ...options,fromShortId:400,toShortId:400
}),{code:'EASYORDERS_AUDIT_EXTERNAL_STORE_UNVERIFIED'});

assert.ok(queries.length>0);
console.log('PASS Easy Orders historical gap audit: read-only scoped SQL, 30 max requests, tenant/store separation, 404/429/503 handling, redacted results');
