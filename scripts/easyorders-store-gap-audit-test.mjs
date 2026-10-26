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
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers['Api-Key'],'FAKE-AUTH-SECRET');
  assert.match(url,/^https:\/\/api\.easy-orders\.net\/api\/v1\/external-apps\/orders\/short\/\d+$/);
  const id=Number(url.split('/').at(-1));calls.push(id);
  if(id===403)return Response.json({message:'record not found'},{status:404});
  if(id===404)return Response.json({message:'rate limit'},{status:429});
  if(id===405)return Response.json({message:'record not found'},{status:503});
  if(id===408)return Response.json({message:'denied'},{status:403});
  return Response.json({
    id:`EA-${id}`,short_id:id,store_id:id===402?'EO-OTHER':'EO-W',
    created_at:id===400?'2026-10-23T12:00:00Z':id===402?'2001-01-01T00:00:00Z':'2026-10-24T12:00:00Z',
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
assert.deepEqual(a.providerCreatedDays,{oldest:'2026-10-23',newest:'2026-10-24',datedOrders:2},'Only validated same-store dates may describe the audited range');
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

const identityMismatch=await run(400,401,{
  fetcher:async()=>Response.json({
    id:'WRONG-ORDER',store_id:'EO-W',short_id:999,
    phone:'DO_NOT_DISCLOSE_CUSTOMER_PHONE'
  })
});
assert.equal(identityMismatch.ok,false);
assert.equal(identityMismatch.status,'provider_short_id_mismatch');
assert.equal(identityMismatch.nextShortId,400);
assert.equal(identityMismatch.missingInKun,0);
assert.deepEqual(identityMismatch.gaps,[]);
assert.doesNotMatch(JSON.stringify(identityMismatch),/WRONG-ORDER|CUSTOMER_PHONE/);

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

const {auditEasyOrdersReadOnlyRpc,readonlyAuditDatabase}=await import('../src/easyorders-readonly-audit-rpc.js');
const safeDb=readonlyAuditDatabase(db);
for(const sql of ['UPDATE orders SET state=1','SELECT 1; DELETE FROM orders','PRAGMA writable_schema=1','SELECT 1 -- hidden'])
  assert.throws(()=>safeDb.prepare(sql),{code:'READONLY_AUDIT_SQL_REJECTED'});
assert.equal(safeDb.prepare('SELECT id FROM orders').run,undefined);
assert.equal(safeDb.batch,undefined);
const rpcRun=(from,to,fetcher=noWriteFetcher)=>auditEasyOrdersReadOnlyRpc(environment,{
  clientId:'TEN-W',storeId:'STORE-W',connectionId:'CON-W',fromShortId:from,toShortId:to
},{fetcher,readSecrets:options.readSecrets});
const rpc=await rpcRun(400,401);
assert.equal(rpc.ok,true);assert.equal(rpc.alreadyInKun,1);assert.deepEqual(rpc.missingShortIds,[401]);
assert.equal(rpc.dbWritesAllowed,false);assert.equal(rpc.recoveryPerformed,false);
assert.deepEqual(rpc.providerCreatedDays,{oldest:'2026-10-23',newest:'2026-10-24',datedOrders:2});
for(const value of ['TEN-W','STORE-W','CON-W','EA-401','PERSONAL_NAME','FAKE-AUTH-SECRET','01112345678'])
  assert.ok(!JSON.stringify(rpc).includes(value),'RPC returns only counts and Short IDs');
const continued=await rpcRun(409,410,async(url,init)=>url.endsWith('/409')?Response.json({message:'record not found'},{status:400}):noWriteFetcher(url,init));
assert.equal(continued.ok,false);assert.deepEqual(continued.unconfirmedShortIds,[409]);
assert.deepEqual(continued.missingShortIds,[410]);assert.equal(continued.missingAtProvider,0);
assert.equal(continued.httpStatusCounts[400],1);assert.equal(continued.requests,2);
assert.equal((await rpcRun(402,403)).status,'provider_store_mismatch');
assert.equal((await rpcRun(404,406)).requests,1,'429 stops further provider requests');
assert.equal((await rpcRun(405,406)).requests,1,'5xx stops further provider requests');
assert.deepEqual((await rpcRun(407,407)).ambiguousShortIds,[407]);
assert.equal((await rpcRun(400,410)).code,'READONLY_AUDIT_SCOPE_OR_RANGE_INVALID');
assert.equal((await auditEasyOrdersReadOnlyRpc(environment,{...options,storeId:'OTHER',fromShortId:400,toShortId:400},{readSecrets:options.readSecrets,fetcher:noWriteFetcher})).status,'audit_failed');
const caller=(await import('../sandbox/easyorders-readonly-audit-caller.mjs')).default;
let invoked=0,received;
const token='f'.repeat(64),callerEnv={KUN_READONLY_AUDIT:'true',AUDIT_READ_TOKEN:token,AUDIT_EXPIRES_AT:String(Date.now()+60000),
 AUDIT_MIN_SHORT_ID:'400',AUDIT_MAX_SHORT_ID:'410',AUDIT_CLIENT_ID:'TEN-W',AUDIT_STORE_ID:'STORE-W',AUDIT_CONNECTION_ID:'CON-W',
 APP_AUDIT:{auditEasyOrdersGapsReadOnly:async input=>{invoked++;received=input;return rpc;}}};
const request=(body,auth=token)=>new Request('https://audit.invalid/audit',{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify(body)});
assert.equal((await caller.fetch(request({fromShortId:400,toShortId:401},'wrong'),callerEnv)).status,404);
assert.equal((await caller.fetch(request({fromShortId:400,toShortId:401}),{...callerEnv,AUDIT_EXPIRES_AT:'1'})).status,404);
assert.equal((await caller.fetch(request({fromShortId:400,toShortId:411}),callerEnv)).status,400);
assert.equal(invoked,0,'Expired, unauthorized and out-of-range requests never invoke the app');
assert.equal((await caller.fetch(request({clientId:'ATTACKER',fromShortId:400,toShortId:401}),callerEnv)).status,200);
assert.equal(received.clientId,'TEN-W','Caller scope is pinned in deployment, never accepted from HTTP input');
console.log('PASS: private audit RPC is SELECT/GET-only, bounded to ten IDs, reports400 as unconfirmed, stops403/429/5xx/foreign data, strips PII/provider IDs, and requires a scope-pinned expiring caller token.');

const redirect=await rpcRun(400,401,async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/order'}}));
assert.equal(redirect.status,'provider_error');assert.equal(redirect.requests,1);
assert.equal(redirect.httpStatusCounts[302],1);assert.equal(redirect.missingInKun,0,'Redirect never proves absence or a missing Kun order');
const {syntheticProviderFetch,SYNTHETIC_API_KEY}=await import('../sandbox/easyorders-synthetic-provider.mjs');
await assert.rejects(()=>syntheticProviderFetch('https://api.easy-orders.net/api/v1/external-apps/orders/short/1',{method:'GET',headers:{'Api-Key':SYNTHETIC_API_KEY},body:'invalid GET body'}),TypeError,'QA must use the real Request constructor instead of ignoring invalid fetch options');
assert.equal((await syntheticProviderFetch('https://api.easy-orders.net/api/v1/external-apps/orders/short/1',{method:'GET',headers:{'Api-Key':SYNTHETIC_API_KEY},redirect:'manual'})).status,200);
