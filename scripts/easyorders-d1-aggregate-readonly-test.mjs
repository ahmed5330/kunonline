import assert from 'node:assert/strict';
import {AGGREGATE_SQL,readEasyOrdersD1Aggregate,safeEasyOrdersD1Aggregate}
  from './easyorders-d1-aggregate-readonly.mjs';
assert.match(AGGREGATE_SQL,/^\s*WITH\s+scoped\s+AS/i);
assert.match(AGGREGATE_SQL,/FROM store_connections\s+WHERE provider='easyorders' AND status='connected'/);
for(const word of ['INSERT','UPDATE','DELETE','DROP','ALTER','REPLACE','PRAGMA','CREATE','ATTACH','DETACH']){
  assert.ok(!new RegExp('\\b'+word+'\\b','i').test(AGGREGATE_SQL),
    'Read-only aggregate SQL cannot contain '+word);
}
for(const sensitive of ['client_id','store_id','connection_id','api_key','token','last_error','orders WHERE']){
  assert.ok(!AGGREGATE_SQL.toLowerCase().includes(sensitive),
    'Read-only aggregate may not select sensitive field: '+sensitive);
}
const source={connected:2,errors:2,healthy:0,throttled:0,http400:2,
  httpAuth:0,http429:0,http5xx:0,errorsWithoutHttp:0,everCron:2,
  recentCron:2,positiveControlVerified:0,
  clientId:'DO_NOT_EXPOSE_CLIENT_ID',
  apiKey:'DO_NOT_EXPOSE_PROVIDER_KEY',
  lastError:'DO_NOT_EXPOSE_PROVIDER_RESPONSE'};
const fake=JSON.stringify([{success:true,results:[source],meta:{duration:2}}]);
let n=0;
const out=readEasyOrdersD1Aggregate({executor:(bin,args,options)=>{
  n++;
  assert.equal(bin,'./node_modules/.bin/wrangler');
  assert.deepEqual(args.slice(0,6),['d1','execute','kunonline-preview','--remote',
    '--config','wrangler.preview.toml']);
  assert.equal(args.at(-1),'--json');
  assert.equal(args[args.indexOf('--command')+1],AGGREGATE_SQL);
  assert.equal(options.stdio[0],'ignore');
  return fake;
}});
assert.equal(n,1);
assert.equal(out.errors,2);
assert.equal(out.recentCron,2);
assert.equal(out.http400,2);
assert.equal(out.ok,true);
for(const sensitive of ['DO_NOT_EXPOSE_CLIENT_ID','DO_NOT_EXPOSE_PROVIDER_KEY','DO_NOT_EXPOSE_PROVIDER_RESPONSE']){
 assert.ok(!JSON.stringify(out).includes(sensitive));
}
await assert.rejects(async()=>safeEasyOrdersD1Aggregate(JSON.stringify([{success:false,results:[source]}])),
  /D1_READONLY_AGGREGATE_UNAVAILABLE/);
await assert.rejects(async()=>safeEasyOrdersD1Aggregate(JSON.stringify([{success:true,results:[source,source]}])),
  /D1_READONLY_AGGREGATE_SHAPE_INVALID/);
await assert.rejects(async()=>safeEasyOrdersD1Aggregate(JSON.stringify([{success:true,results:[{...source,errors:10}]}])),
  /D1_READONLY_AGGREGATE_IMPOSSIBLE_COUNTS/);
assert.throws(()=>readEasyOrdersD1Aggregate({executor:()=>{
 throw Error('DO_NOT_EXPOSE_PROVIDER_RESPONSE');
}}),/D1_READONLY_AGGREGATE_UNAVAILABLE/);
console.log('Easy Orders protected D1 aggregate READ-ONLY offline test PASS: fixed SELECT only, sanitized provider error counts and real Cron receipts, never customer data.');
