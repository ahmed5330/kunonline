/* Synthetic SQLite + real Easy Orders webhook contract, no external API,
 * no Cloudflare resources, no customer data.
 */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mutateEasyOrdersConfig,mergeEasyOrdersRecoveryPatch} from '../src/easyorders-connection-config.js';
import {easyOrdersWebhookPath,handleEasyOrdersWebhook} from '../src/commerce-order-sync.js';
import {fairEasyOrdersRecoveryOrder,reconcileEasyOrdersOrders} from '../src/easyorders-order-reconciliation.js';
import {encryptSecret} from '../src/integration-secrets.js';

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE store_connections(
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,
 config_json TEXT,last_error TEXT,last_sync_at TEXT,updated_at TEXT,external_store_id TEXT
);
CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,status TEXT NOT NULL,is_default INTEGER,created_at TEXT);
CREATE TABLE integration_secrets(client_id TEXT,connection_id TEXT,secret_name TEXT,ciphertext_b64 TEXT,iv_b64 TEXT);
CREATE TABLE customers(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,name TEXT,phone TEXT,gov TEXT,address TEXT,tags TEXT,note TEXT,created_at TEXT);
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,ref TEXT,customer_id TEXT,
 date TEXT,name TEXT,phone TEXT,gov TEXT,address TEXT,product TEXT,product_note TEXT,
 unit_price REAL,qty INTEGER,total REAL,product_cost REAL,shipping_cost REAL,source TEXT,note TEXT,
 state TEXT,checkpoint TEXT,contact_log TEXT,history TEXT,created_at TEXT);
`);
const now='2026-10-23T07:00:00.000Z';
for(const [id,clientId,storeId] of [['CON-A','TENANT-A','STORE-A'],['CON-B','TENANT-B','STORE-B'],['CON-C','TENANT-B','STORE-C']]){
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run(id,clientId,'easyorders','connected',JSON.stringify({kunStoreId:storeId}),now,'');
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run(storeId,clientId,'active',1,now);
}
let race=null,forcedConflicts=0,insertRaceId=null;
const env={APP_ENV:'preview',SESSION_SECRET:'SYNTHETIC_TEST_ROUTE_SECRET_ONLY',DB:{
  prepare(sql){
    return {bind(...params){return {
      async first(){return db.prepare(sql).get(...params)||null;},
      async all(){return {results:db.prepare(sql).all(...params)};},
      async run(){
        if(insertRaceId&&sql.startsWith('INSERT INTO orders')&&params[0]===insertRaceId){
          const contested=insertRaceId;insertRaceId=null;
          db.prepare('INSERT INTO orders (id,client_id,store_id,ref) VALUES (?,?,?,?)')
            .run(contested,'TENANT-A','STORE-A','easyorders:'+contested);
        }
        if(race&&sql.includes('SET config_json=?')){
          const mutation=race;race=null;
          const id=params[params.length-4],clientId=params[params.length-3];
          const record=db.prepare('SELECT config_json FROM store_connections WHERE id=? AND client_id=?').get(id,clientId);
          const current=JSON.parse(record.config_json||'{}');
          db.prepare('UPDATE store_connections SET config_json=? WHERE id=? AND client_id=?')
            .run(JSON.stringify(mutation(current)),id,clientId);
          forcedConflicts++;
        }
        const result=db.prepare(sql).run(...params);
        return {success:true,meta:{changes:result.changes}};
      }
    }}};
  }
}};
const connection=id=>db.prepare('SELECT * FROM store_connections WHERE id=?').get(id);
const config=id=>JSON.parse(connection(id).config_json);
const update=(id,mutate,extra)=>mutateEasyOrdersConfig(env,connection(id),mutate,extra);
try{
  const roundOne=[
    {id:'A',config_json:JSON.stringify({easyOrdersRecoveryLastRunAt:'2026-10-24T02:30:00Z'})},
    {id:'B',config_json:JSON.stringify({easyOrdersRecoveryLastRunAt:'2026-10-23T01:00:00Z'})},
    {id:'C',config_json:'{}'},
  ];
  assert.deepEqual(fairEasyOrdersRecoveryOrder(roundOne).map(x=>x.id),['C','B','A'],
    'Never-run and oldest-checked Easy Orders stores must get recovery budget first');
  roundOne[2].config_json=JSON.stringify({easyOrdersRecoveryLastRunAt:'2026-10-24T03:00:00Z'});
  assert.deepEqual(fairEasyOrdersRecoveryOrder(roundOne).map(x=>x.id),['B','A','C'],
    'After being checked a store must move behind older unchecked stores');
  const initial=mergeEasyOrdersRecoveryPatch(
    {easyOrdersRecoveryHighestShortId:100,easyOrdersRecoveryCursor:101,easyOrdersRecoveryLastStatus:'healthy'},
    {easyOrdersRecoveryHighestShortId:99,easyOrdersRecoveryCursor:100,easyOrdersRecoveryLastStatus:'healthy'}
  );
  assert.equal(initial.easyOrdersRecoveryHighestShortId,100);
  assert.equal(initial.easyOrdersRecoveryCursor,101);
  const savedGaps=mergeEasyOrdersRecoveryPatch(
    {easyOrdersRecoveryPendingShortIds:[10,11],easyOrdersRecoveryProbeCursor:50,
      easyOrdersRecoveryCursor:32},
    {easyOrdersRecoveryPendingAdd:[11,12],easyOrdersRecoveryPendingRemove:[10],
      easyOrdersRecoveryProbeCursor:49,easyOrdersRecoveryCursor:31,
      easyOrdersRecoveryLastStatus:'healthy'}
  );
  assert.deepEqual(savedGaps.easyOrdersRecoveryPendingShortIds,[11,12],
    'Pending retries must be unioned against fresh CAS state, not overwritten');
  assert.equal(savedGaps.easyOrdersRecoveryProbeCursor,50);
  assert.equal(savedGaps.easyOrdersRecoveryCursor,32);
  assert.equal(savedGaps.easyOrdersRecoveryLastStatus,'catching_up',
    'Unresolved provider Short IDs can never show healthy');
  assert.throws(()=>mergeEasyOrdersRecoveryPatch(
    {easyOrdersRecoveryPendingShortIds:Array.from({length:120},(_,i)=>i+1)},
    {easyOrdersRecoveryPendingAdd:[121]}
  ),/safe limit/,'Never silently drop pending IDs when the queue reaches 120');

  race=current=>({...current,webhookLastShortId:222,easyOrdersRecoveryHighestShortId:222});
  const saved=await update('CON-A',current=>mergeEasyOrdersRecoveryPatch(current,{
    easyOrdersRecoveryHighestShortId:200,easyOrdersRecoveryCursor:201,
    easyOrdersRecoveryLastStatus:'healthy',easyOrdersRecoveryRecoveredCount:18
  }));
  assert.equal(forcedConflicts,1,'Stale config_json CAS must retry');
  assert.equal(saved.easyOrdersRecoveryHighestShortId,222,'Webhook high-water is never overwritten by a scheduled sync');
  assert.equal(saved.webhookLastShortId,222);
  assert.equal(saved.easyOrdersRecoveryCursor,201);
  assert.equal(saved.easyOrdersRecoveryLastStatus,'catching_up','New webhook gap must not report healthy');
  await update('CON-A',current=>mergeEasyOrdersRecoveryPatch(current,{
    webhookLastShortId:199,easyOrdersRecoveryHighestShortId:199
  }));
  assert.equal(config('CON-A').webhookLastShortId,222,'Delayed webhook may not regress high-water');
  await update('CON-A',current=>({...current,webhookLastProbeAt:'probe-only'}));
  assert.equal(config('CON-A').easyOrdersRecoveryCursor,201,'Health probe cannot erase cursor');
  assert.equal(config('CON-A').webhookLastProbeAt,'probe-only');
  await assert.rejects(
    mutateEasyOrdersConfig(env,{id:'CON-UNKNOWN',client_id:'TENANT-A'},c=>c),
    /not connected/,'Well-scoped but nonexistent connection must be denied'
  );
  await assert.rejects(mutateEasyOrdersConfig(env,null,c=>c),
    /scope missing/,'Unscoped connection rejected before DB access');
  const p={id:'EXTERNAL-SAME',store_id:'EO-EXTERNAL-A',short_id:300,
    full_name:'QA Synthetic',phone:'01000000001',government:'Test Province',
    address:'Fake Address',status:'pending',total_cost:135,cart_items:[]};
  const post=async(id,data)=>{
    const conn=connection(id),path=await easyOrdersWebhookPath(env,conn);
    return handleEasyOrdersWebhook(new Request('https://qa.invalid'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
    }),env,{connectionId:id,routeToken:path.split('/').at(-1)});
  };
  const a=await post('CON-A',p);assert.equal(a.ok,true);
  assert.equal(a.id,'EXTERNAL-SAME','Existing legacy external IDs remain supported');
  const b=await post('CON-B',{...p,store_id:'EO-EXTERNAL-B',phone:'01000000002'});
  assert.equal(b.ok,true);assert.notEqual(b.id,a.id,
    'Second tenant with same external id must be stored under separate scoped Kun ID');
  assert.match(b.id,/^EO-[a-f0-9]{32}$/);
  const again=await post('CON-B',{...p,store_id:'EO-EXTERNAL-B',status:'confirmed',phone:'01000000002'});
  assert.equal(again.id,b.id,'Retrying provider webhook remains idempotent');
  const third=await post('CON-C',{...p,store_id:'EO-EXTERNAL-C',phone:'01000000003'});
  assert.notEqual(third.id,b.id,'Second store in same tenant must not overwrite first store');
  const rows=db.prepare('SELECT id,client_id,store_id,state FROM orders ORDER BY client_id,store_id').all();
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(x=>x.store_id),['STORE-A','STORE-B','STORE-C']);
  assert.deepEqual(rows.map(x=>x.client_id),['TENANT-A','TENANT-B','TENANT-B']);
  assert.equal(rows[0].state,'pending');
  assert.equal(rows[1].state,'confirmed');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE ref='easyorders:EXTERNAL-SAME'").get().n,3);
  // Status callbacks carrying the SAME provider ID must affect only the
  // connected Kun store, including a second store under the same tenant.
  const statusB=await post('CON-B',{
    event_type:'order-status-update',order_id:'EXTERNAL-SAME',new_status:'shipped'
  });
  assert.equal(statusB.id,b.id);
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(b.id).state,'shipped');
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(a.id).state,'pending',
    'One tenant status callback must not change another tenant');
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(third.id).state,'pending',
    'Same tenant status callback must not update a different store');
  const statusC=await post('CON-C',{
    event_type:'order-status-update',order_id:'EXTERNAL-SAME',new_status:'confirmed'
  });
  assert.equal(statusC.id,third.id);
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(third.id).state,'confirmed');
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(b.id).state,'shipped');

  // Inject a real insert between the initial SELECT and the first upsert:
  // both stores originally believe the external ID is unused. The losing
  // webhook must retry using a stable scoped ID, without overwriting a.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-E','TENANT-B','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-E','TENANT-B','easyorders','connected',JSON.stringify({kunStoreId:'STORE-E'}),now,'');
  insertRaceId='RACE-NEW';
  const inserted=await post('CON-E',{...p,id:'RACE-NEW',store_id:'EO-EXTERNAL-E'});
  assert.equal(insertRaceId,null,'First insert raced with another tenant');
  assert.notEqual(inserted.id,'RACE-NEW','Concurrent loser must use a scoped ID');
  assert.match(inserted.id,/^EO-[a-f0-9]{32}$/);
  assert.equal(db.prepare('SELECT store_id FROM orders WHERE id=?').get(inserted.id).store_id,'STORE-E');
  assert.equal(db.prepare('SELECT client_id FROM orders WHERE id=?').get('RACE-NEW').client_id,'TENANT-A');
  const repeated=await post('CON-E',{...p,id:'RACE-NEW',store_id:'EO-EXTERNAL-E'});
  assert.equal(repeated.id,inserted.id,'Race recovery remains idempotent');

  // Recovery may fetch different Easy Orders stores through the same API
  // key. The foreign shop must not block or silently enter the Kun tenant.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-D','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-D','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-D',easyOrdersRecoveryHighestShortId:501,easyOrdersRecoveryCursor:500
    }),now,'EO-EXTERNAL-D');
  const secret=await encryptSecret(env,'ONLY-A-SYNTHETIC-EASYORDERS-API-KEY');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run(
    'TENANT-A','CON-D','api_key',secret.ciphertextB64,secret.ivB64
  );
  const seen=[];
  const fakeApi=async (url,options)=>{
    assert.equal(options.headers['Api-Key'],'ONLY-A-SYNTHETIC-EASYORDERS-API-KEY');
    const id=Number(url.split('/').at(-1));seen.push(id);
    if(id===500)return Response.json({...p,id:'FOREIGN-ORDER',store_id:'EO-FOREIGN',short_id:500});
    if(id===501)return Response.json({...p,store_id:'EO-EXTERNAL-D',short_id:501,phone:'01000000004'});
    return Response.json({message:'record not found'},{status:404});
  };
  const recovery=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-D',maxRequests:3,lookback:10,fetcher:fakeApi
  });
  assert.equal(recovery.results[0].status,'catching_up','Confirmed 404 must stay queued, not falsely report healthy');
  assert.deepEqual(config('CON-D').easyOrdersRecoveryPendingShortIds,[502],
    'Short ID 502 was missing at provider; preserve it for future retry');
  assert.deepEqual(seen,[500,501,502],'Foreign storefront response cannot terminate recovery scan');
  assert.equal(recovery.foreignStoreSkipped,1,'Foreign storefront is observed but never ingested');
  assert.equal(recovery.recovered,1,'Sibling Kun store with same provider ID is a NEW recovery');
  assert.equal(recovery.ok,true);
  assert.equal(recovery.completedAllConnections,true);
  assert.equal(recovery.checkedConnections,1);
  assert.equal(recovery.failedConnections,0);
  assert.equal(recovery.recoveredOrderIds.length,1,'Accounting reconciliation receives recovered order IDs');
  const recoveredId=recovery.recoveredOrderIds[0];
  assert.notEqual(recoveredId,a.id);
  assert.equal(db.prepare('SELECT store_id FROM orders WHERE id=?').get(recoveredId).store_id,'STORE-D');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE ref='easyorders:FOREIGN-ORDER'").get().n,0,
    'No order from another Easy Orders store may enter the Kun database');
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(a.id).state,'pending',
    'Recovery must not change existing sibling store order');
  // A previously HTTP 404 Short ID can arrive later. Revisit the durable
  // queue and import once to this tenant/store, never update sibling orders.
  const recovered502=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-D',maxRequests:4,lookback:10,
    fetcher:async url=>{
      const id=Number(url.split('/').at(-1));
      return id===502
        ?Response.json({...p,id:'LATE-ORDER-502',short_id:502,store_id:'EO-EXTERNAL-D'})
        :Response.json({message:'record not found'},{status:404});
    }
  });
  assert.equal(recovered502.recovered,1,'Delayed 404 must be recoverable from the pending queue');
  assert.equal(config('CON-D').easyOrdersRecoveryPendingShortIds.includes(502),false,
    'Recovered Short ID must leave the durable retry list');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:LATE-ORDER-502'").get().n,1,
    'Delayed order must import exactly once into the same tenant and store');

  // Unbound integrations must be explicitly repaired via authenticated
  // webhook rather than assigning the first random provider store from API.
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-UNBOUND','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-D',easyOrdersRecoveryHighestShortId:501,easyOrdersRecoveryCursor:501
    }),now,'');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run(
    'TENANT-A','CON-UNBOUND','api_key',secret.ciphertextB64,secret.ivB64
  );
  const unbound=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-UNBOUND',maxRequests:2,fetcher:fakeApi
  });
  assert.equal(unbound.results[0].status,'error','Unbound provider store must fail closed');
  assert.equal(unbound.ok,false,'A failed connection must never be reported as global ok:true');
  assert.equal(unbound.failedConnections,1);
  assert.equal(unbound.checkedConnections,1);
  assert.equal(connection('CON-UNBOUND').external_store_id,'');
  // Regression for the Oct 23 recovery gap: HTTP 429 midway through a
  // bounded scan must NOT advance its checkpoint past the unprocessed ID.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-THROTTLE','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-THROTTLE','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-THROTTLE',easyOrdersRecoveryHighestShortId:701,
      easyOrdersRecoveryCursor:700
    }),now,'EO-THROTTLE');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run(
    'TENANT-A','CON-THROTTLE','api_key',secret.ciphertextB64,secret.ivB64
  );
  let throttled=true;
  const throttleRequests=[];
  const throttleApi=async(url,options)=>{
    assert.equal(options.headers['Api-Key'],'ONLY-A-SYNTHETIC-EASYORDERS-API-KEY');
    const shortId=Number(url.split('/').at(-1));
    throttleRequests.push(shortId);
    if(shortId===701&&throttled)return Response.json(
      {message:'too many requests'},{status:429});
    if(shortId===700||shortId===701)return Response.json({
      ...p,id:'THROTTLE-'+shortId,store_id:'EO-THROTTLE',short_id:shortId,
      phone:'01000000'+String(shortId).padStart(3,'0')
    });
    return Response.json({message:'record not found'},{status:404});
  };
  const rateLimited=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-THROTTLE',maxRequests:3,fetcher:throttleApi
  });
  assert.equal(rateLimited.rateLimited,true,'429 must be surfaced to operations');
  assert.equal(rateLimited.ok,false,'A 429 cannot be represented as successful recovery');
  assert.equal(rateLimited.rateLimitedConnections,1);
  assert.equal(rateLimited.failedConnections,0);
  assert.equal(rateLimited.results[0].status,'rate_limited');
  assert.equal(rateLimited.recovered,1,'The first successfully read order was imported');
  assert.equal(config('CON-THROTTLE').easyOrdersRecoveryCursor,701,
    '429 must not checkpoint the unprocessed Short ID 701 as completed');
  assert.deepEqual(throttleRequests,[700,701]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:THROTTLE-701'").get().n,0);
  throttled=false;
  const resumed=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-THROTTLE',maxRequests:3,fetcher:throttleApi
  });
  assert.equal(resumed.rateLimited,false);
  assert.equal(resumed.ok,true,'Retry after provider 429 may become healthy only on confirmed success');
  assert.equal(resumed.rateLimitedConnections,0);
  assert.equal(resumed.recovered,1,'Previously throttled order must be recovered in the next run');
  assert.equal(resumed.recoveredOrderIds.length,1);
  assert.equal(db.prepare('SELECT store_id FROM orders WHERE id=?')
    .get(resumed.recoveredOrderIds[0]).store_id,'STORE-THROTTLE');
  assert.equal(config('CON-THROTTLE').easyOrdersRecoveryCursor,702);
  assert.equal(config('CON-THROTTLE').easyOrdersRecoveryRecoveredCount,2);
  assert.deepEqual(throttleRequests.slice(0,3),[700,701,701],
    'Retry must begin with EXACT unprocessed Short ID after throttling');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:THROTTLE-701'").get().n,1);
  // A 503 containing "record not found" is a SERVER ERROR, not proof
  // that the provider order can be skipped. Checkpoint and retry same ID.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-SERVER','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-SERVER','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-SERVER',easyOrdersRecoveryHighestShortId:801,
      easyOrdersRecoveryCursor:800
    }),now,'EO-SERVER');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run(
    'TENANT-A','CON-SERVER','api_key',secret.ciphertextB64,secret.ivB64
  );
  let serviceFail=true;
  const serverAttempts=[];
  const serverApi=async(url,options)=>{
    assert.equal(options.headers['Api-Key'],'ONLY-A-SYNTHETIC-EASYORDERS-API-KEY');
    const shortId=Number(url.split('/').at(-1));serverAttempts.push(shortId);
    if(shortId===800&&serviceFail)return Response.json(
      {message:'record not found'},{status:503});
    if(shortId===800)return Response.json({...p,
      id:'SERVER-RECOVER-800',store_id:'EO-SERVER',short_id:800,phone:'01000000800'});
    return Response.json({message:'record not found'},{status:404});
  };
  const failingServer=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-SERVER',maxRequests:2,fetcher:serverApi
  });
  assert.equal(failingServer.ok,false,'HTTP 503 must never produce success');
  assert.equal(failingServer.status,'error');
  assert.equal(failingServer.missing,0,'503 with missing-looking text is NOT a 404');
  assert.equal(failingServer.requests,1,'Failed HTTP call still uses provider request budget');
  assert.equal(config('CON-SERVER').easyOrdersRecoveryCursor,800,
    'Do not checkpoint past a failed provider read');
  assert.deepEqual(serverAttempts,[800]);
  serviceFail=false;
  const recoveredServer=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-SERVER',maxRequests:2,fetcher:serverApi
  });
  assert.equal(recoveredServer.ok,true);
  assert.equal(recoveredServer.recovered,1);
  assert.equal(config('CON-SERVER').easyOrdersRecoveryCursor,802);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:SERVER-RECOVER-800'").get().n,1);
  assert.deepEqual(serverAttempts,[800,800,801],'503 retry must fetch exactly the failed Short ID');
  // Live-safe regression: Easy Orders actually returns HTTP 400 "record
  // not found" for some Short IDs, yet a known order from the SAME store
  // returns HTTP 200. Require a fresh positive control AND a second 400;
  // queue the hole durably for later retry rather than losing the order.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-400','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-400','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-400',webhookLastShortId:401,
      easyOrdersRecoveryHighestShortId:401,easyOrdersRecoveryCursor:400
    }),now,'EO-EXTERNAL-400');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run(
    'TENANT-A','CON-400','api_key',secret.ciphertextB64,secret.ivB64
  );
  let delayed400=true,attempts400=[];
  const proven400Api=async (url,opts)=>{
    assert.equal(opts.headers['Api-Key'],'ONLY-A-SYNTHETIC-EASYORDERS-API-KEY');
    const id=Number(url.split('/').at(-1));attempts400.push(id);
    if(id===400)return delayed400
      ?Response.json({message:'record not found'},{status:400})
      :Response.json({...p,id:'LATE-ORDER-400',short_id:400,store_id:'EO-EXTERNAL-400'});
    if(id===401)return Response.json({...p,
      id:'KNOWN-SHOP-401',short_id:401,store_id:'EO-EXTERNAL-400'});
    return Response.json({message:'record not found'},{status:404});
  };
  const confirmed400=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-400',maxRequests:4,
    fetcher:proven400Api,trigger:'cron'
  });
  assert.equal(confirmed400.ok,true,JSON.stringify(confirmed400));
  assert.deepEqual(attempts400,[400,401,400,401],
    'First 400 requires known 200 identity proof and second independent 400');
  assert.equal(confirmed400.requests,4,'Positive control and verification retry use bounded Cron quota');
  assert.equal(config('CON-400').easyOrdersRecoveryCursor,402);
  assert.deepEqual(config('CON-400').easyOrdersRecoveryPendingShortIds,[400],
    'A 400 not-found historical gap is DURABLY queued, never forgotten');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:LATE-ORDER-400'").get().n,0);
  delayed400=false;attempts400=[];
  const restored400=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-400',maxRequests:8,
    fetcher:proven400Api,trigger:'cron'
  });
  assert.equal(restored400.recovered,1,
    'The previously missing 400 Short ID must be ingested when provider publishes it');
  assert.equal(config('CON-400').easyOrdersRecoveryPendingShortIds.includes(400),false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:LATE-ORDER-400'").get().n,1);
  // No known positive reference means HTTP 400 must NOT be accepted as a
  // missing order, even if the body says "record not found".
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-400-UNSAFE','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-400-UNSAFE','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-400-UNSAFE',
      easyOrdersRecoveryHighestShortId:900,easyOrdersRecoveryCursor:900
    }),now,'EO-EXTERNAL-UNSAFE');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run(
    'TENANT-A','CON-400-UNSAFE','api_key',secret.ciphertextB64,secret.ivB64
  );
  const unsafe400=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-400-UNSAFE',maxRequests:5,
    trigger:'cron',fetcher:async()=>Response.json({message:'record not found'},{status:400})
  });
  assert.equal(unsafe400.ok,false);
  assert.equal(config('CON-400-UNSAFE').easyOrdersRecoveryCursor,900,
    'Unverified 400 never checkpoints or marks the order absent');
  console.log('Easy Orders SQLite sync PASS: concurrent webhook/cron CAS, monotonic high-water, correct catching-up, tenant+store collision isolation, idempotent retries.');
}finally{db.close();}
