/* Synthetic SQLite + real Easy Orders webhook contract, no external API,
 * no Cloudflare resources, no customer data.
 */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mutateEasyOrdersConfig,mergeEasyOrdersRecoveryPatch} from '../src/easyorders-connection-config.js';
import {easyOrdersWebhookPath,handleEasyOrdersWebhook} from '../src/commerce-order-sync.js';
import {fairEasyOrdersRecoveryOrder,reconcileEasyOrdersOrders,easyOrdersRecoveryStatus} from '../src/easyorders-order-reconciliation.js';
import {replayExplicitEasyOrdersStoreGaps} from '../src/easyorders-explicit-gap-replay.js';
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

  // Historic replay cannot roll a shipped order back to pending, rewrite
  // staff notes, or replace history—even if its provider payload is stale.
  db.prepare("UPDATE orders SET state=?,note=?,history=?,contact_log=? WHERE id=?")
    .run('shipped','STAFF-NOTE-MUST-STAY','[{"source":"staff"}]','[{"call":"handled"}]',a.id);
  const pathA=await easyOrdersWebhookPath(env,connection('CON-A'));
  const asReplay=payload=>handleEasyOrdersWebhook(new Request('https://offline.invalid'+pathA,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  }),env,{connectionId:'CON-A',routeToken:pathA.split('/').at(-1),createOnly:true});
  const existingReplay=await asReplay({...p,status:'pending',full_name:'STALE_NAME'});
  assert.equal(existingReplay.skippedExisting,true);
  assert.deepEqual({...db.prepare('SELECT state,note,history,contact_log FROM orders WHERE id=?').get(a.id)},{
    state:'shipped',note:'STAFF-NOTE-MUST-STAY',
    history:'[{"source":"staff"}]',contact_log:'[{"call":"handled"}]'
  },'Create-only replay must never overwrite existing customer-service work');

  // A legacy order without a store ID must never be silently attributed
  // to Wefaq (or any other store) by the historical recovery path.
  db.prepare('INSERT INTO orders (id,client_id,store_id,ref,state,note) VALUES (?,?,?,?,?,?)')
    .run('LEGACY-UNSCOPED','TENANT-A',null,'easyorders:LEGACY-UNSCOPED','shipped','KEEP-LEGACY-NOTE');
  await assert.rejects(()=>asReplay({...p,id:'LEGACY-UNSCOPED',status:'pending'}),
    {code:'EASYORDERS_RECOVERY_LEGACY_ORDER_AMBIGUOUS'});
  assert.deepEqual({...db.prepare('SELECT store_id,state,note FROM orders WHERE id=?')
    .get('LEGACY-UNSCOPED')},{
    store_id:null,state:'shipped',note:'KEEP-LEGACY-NOTE'
  },'Create-only history replay cannot claim or rewrite an unscoped legacy record');

  // An actual insert may race AFTER the initial SELECT; create-only SQL must
  // treat same-store concurrent insertion as already present without an upsert.
  insertRaceId='RACE-SAME-STORE';
  const raceReplay=await asReplay({...p,id:'RACE-SAME-STORE',status:'pending'});
  assert.equal(raceReplay.skippedExisting,true,'Concurrent same-store creation should be idempotently skipped');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE id='RACE-SAME-STORE'").get().n,1);
  assert.equal(db.prepare("SELECT state FROM orders WHERE id='RACE-SAME-STORE'").get().state,null,
    'Incoming stale state must not overwrite concurrently inserted order');

  // Restore the original fixture state so unrelated legacy regression
  // assertions below still test the original pending-order scenario.
  db.prepare("UPDATE orders SET state='pending' WHERE id=?").run(a.id);

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
  assert.equal(recovery.results[0].status,'catching_up',JSON.stringify(recovery.results[0]));
  assert.equal(recovery.results[0].unresolvedAheadCount,1,
    'An unresolved HTTP 404 must not be reported as a fully healthy connection');
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
  // Scheduled catch-up repeats a provider order that is already confirmed
  // or shipped locally. It MUST NOT replay stale source fields over staff
  // notes, shipping state, contact history, or existing charges.
  db.prepare("UPDATE orders SET state='shipped',checkpoint='جاري الشحن',note='KEEP-STAFF-NOTE',contact_log='[{\"call\":\"saved\"}]',history='[{\"type\":\"staff-handled\"}]',address='KEEP-STAFF-ADDRESS' WHERE id=?")
    .run(recoveredId);
  const existingD=config('CON-D');
  db.prepare('UPDATE store_connections SET config_json=? WHERE id=?')
    .run(JSON.stringify({...existingD,easyOrdersRecoveryCursor:501}),'CON-D');
  const replayOfExisting=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-D',maxRequests:2,lookback:10,
    fetcher:fakeApi
  });
  assert.equal(replayOfExisting.recovered,0,'Scheduled recovery must not count existing orders as new');
  assert.equal(replayOfExisting.updated,1,'Already-imported orders are counted as skipped');
  assert.deepEqual({...db.prepare('SELECT state,checkpoint,note,contact_log,history,address FROM orders WHERE id=?').get(recoveredId)},{
    state:'shipped',checkpoint:'جاري الشحن',note:'KEEP-STAFF-NOTE',
    contact_log:'[{"call":"saved"}]',history:'[{"type":"staff-handled"}]',
    address:'KEEP-STAFF-ADDRESS'
  },'Scheduled recovery must never overwrite already handled live orders');

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
  assert.equal(config('CON-THROTTLE').easyOrdersRecoveryLastProviderHttpStatus,429);
  assert.equal(config('CON-THROTTLE').easyOrdersRecoveryLastProviderErrorCategory,'provider_throttle');
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
      {message:'record not found',privatePayload:'DO_NOT_PERSIST_PROVIDER_BODY'},{status:503});
    if(shortId===800)return Response.json({...p,
      id:'SERVER-RECOVER-800',store_id:'EO-SERVER',short_id:800,phone:'01000000800'});
    return Response.json({message:'record not found'},{status:404});
  };
  const failingServer=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-SERVER',maxRequests:2,fetcher:serverApi,trigger:'cron'
  });
  assert.equal(failingServer.ok,false,'HTTP 503 must never produce success');
  assert.equal(failingServer.status,'error');
  assert.equal(config('CON-SERVER').easyOrdersRecoveryLastProviderHttpStatus,503,'Cron must persist the actual upstream HTTP code, not infer 404 from text');
  assert.equal(config('CON-SERVER').easyOrdersRecoveryLastProviderErrorCategory,'provider_server_error');
  assert.ok(config('CON-SERVER').easyOrdersRecoveryLastCronAt);
  assert.ok(!JSON.stringify(config('CON-SERVER')).includes('DO_NOT_PERSIST_PROVIDER_BODY'),'Never persist the provider response body');

  assert.equal(failingServer.missing,0,'503 with missing-looking text is NOT a 404');
  assert.equal(failingServer.requests,1,'Failed HTTP call still uses provider request budget');
  assert.equal(config('CON-SERVER').easyOrdersRecoveryCursor,800,
    'Do not checkpoint past a failed provider read');
  assert.deepEqual(serverAttempts,[800]);
  serviceFail=false;
  const recoveredServer=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-SERVER',maxRequests:2,fetcher:serverApi,trigger:'cron'
  });
  assert.equal(recoveredServer.ok,true);
  assert.equal(config('CON-SERVER').easyOrdersRecoveryLastProviderHttpStatus,null,'Successful retry clears stale failure metadata');
  assert.equal(config('CON-SERVER').easyOrdersRecoveryLastProviderErrorCategory,null);
  assert.equal(recoveredServer.recovered,1);
  assert.equal(config('CON-SERVER').easyOrdersRecoveryCursor,802);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref='easyorders:SERVER-RECOVER-800'").get().n,1);
  assert.deepEqual(serverAttempts,[800,800,801],'503 retry must fetch exactly the failed Short ID');
  // Live-style 400 is still failure. One read-only known-order control can
  // establish API/store identity, but never marks the failed number absent.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-CONTROL','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-CONTROL','TENANT-A','easyorders','connected',JSON.stringify({kunStoreId:'STORE-CONTROL',webhookLastShortId:499,webhookLastOrderId:'KNOWN-499',easyOrdersRecoveryHighestShortId:501,easyOrdersRecoveryCursor:500}),now,'EO-CONTROL');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run('TENANT-A','CON-CONTROL','api_key',secret.ciphertextB64,secret.ivB64);
  const controlCalls=[];let controlMode='own';
  const controlApi=async(url,options)=>{
    const reference=url.split('/').at(-1),id=reference==='KNOWN-499'?499:Number(reference);controlCalls.push(id);
    if(id===500)return Response.json({message:'record not found'},{status:400});
    assert.equal(id,499,'The diagnostic must only read the known reference');
    assert.ok(options.signal instanceof AbortSignal,'The secondary diagnostic must have a bounded timeout');
    if(controlMode==='quota')return Response.json({message:'private quota payload'},{status:429});
    if(controlMode==='denied')return Response.json({message:'private permission payload'},{status:403});
    return Response.json({...p,id:'KNOWN-499',short_id:499,store_id:controlMode==='own'?'EO-CONTROL':'EO-FOREIGN'});
  };
  const controlRun=maxRequests=>reconcileEasyOrdersOrders(env,{clientId:'TENANT-A',connectionId:'CON-CONTROL',maxRequests,fetcher:controlApi,trigger:'cron'});
  const controlled=await controlRun(2);
  assert.equal(controlled.ok,false);assert.equal(controlled.results[0].providerHttpStatus,400);
  assert.equal(controlled.requests,2);assert.deepEqual(controlCalls,[500,499]);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryCursor,500);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlHttpStatus,200);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlIdentityVerified,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE store_id='STORE-CONTROL'").get().n,0,'Positive control is never ingested');
  await update('CON-CONTROL',current=>({...current,webhookLastShortId:498}));
  await controlRun(2);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlIdentityVerified,true,'A delayed webhook must not require a stale Short ID/UUID pair');
  await update('CON-CONTROL',current=>({...current,webhookLastOrderId:null,webhookLastShortId:499}));
  await controlRun(2);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlIdentityVerified,true,'Short ID fallback works when no order UUID is available');
  controlMode='foreign';await controlRun(2);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlIdentityVerified,false,'Another store never verifies the connection');
  controlMode='denied';await controlRun(2);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastProviderHttpStatus,400,'Secondary errors do not overwrite the primary HTTP status');
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlHttpStatus,403);
  assert.ok(!connection('CON-CONTROL').config_json.includes('private permission payload'));
  controlMode='quota';const quotaControl=await controlRun(2);
  assert.equal(quotaControl.rateLimited,true,'Secondary 429 must pause remaining connections');
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlHttpStatus,429);
  const beforeBudget=controlCalls.length;await controlRun(1);
  assert.equal(controlCalls.length-beforeBudget,1,'A diagnostic cannot exceed the shared request cap');
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryLastPositiveControlAt,null);
  assert.equal(config('CON-CONTROL').easyOrdersRecoveryCursor,500);
  // A later failed ahead probe must not erase the already verified prefix.
  // Keep the failed number unresolved and retry it; HTTP400 is never absence.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-PREFIX','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-PREFIX','TENANT-A','easyorders','connected',JSON.stringify({kunStoreId:'STORE-PREFIX',easyOrdersRecoveryHighestShortId:7002,easyOrdersRecoveryCursor:7000}),now,'EO-PREFIX');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)').run('TENANT-A','CON-PREFIX','api_key',secret.ciphertextB64,secret.ivB64);
  let prefixReady=false,prefixHole=false; const prefixCalls=[];
  const prefixApi=async url=>{
    const id=Number(url.match(/(\d+)$/)[1]);prefixCalls.push(id);
    if(id===7003&&!prefixReady)return Response.json({message:'record not found'},{status:400});
    if(id===7004&&prefixHole)return Response.json({message:'record not found'},{status:404});
    if(id>=7004)return Response.json({message:'record not found'},{status:503});
    return Response.json({...p,id:'PREFIX-'+id,short_id:id,store_id:'EO-PREFIX'});
  };
  const prefixRun=maxRequests=>reconcileEasyOrdersOrders(env,{clientId:'TENANT-A',connectionId:'CON-PREFIX',maxRequests,fetcher:prefixApi,trigger:'cron'});
  const prefixFailed=await prefixRun(5);
  assert.equal(prefixFailed.ok,false);assert.equal(prefixFailed.missing,0);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryCursor,7003,'Persist only the successful prefix before the400');
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryLastStatus,'error');
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryLastProviderHttpStatus,400);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryLastRecovered,3);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryRecoveredCount,3);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryLastRequests,5);
  assert.equal(prefixFailed.results[0].nextShortId,7003);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE store_id='STORE-PREFIX'").get().n,3);
  const prefixRetryStart=prefixCalls.length;await prefixRun(2);
  assert.equal(prefixCalls[prefixRetryStart],7003,'Retry the exact unresolved number, not the successful prefix');
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryCursor,7003);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryRecoveredCount,3,'A failed retry must not count the known-order diagnostic');
  prefixReady=true;const prefixResumed=await prefixRun(2);
  assert.equal(prefixResumed.ok,false,'A subsequent503 is still a genuine failure');
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryCursor,7004);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryLastProviderHttpStatus,503);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryRecoveredCount,4);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE store_id='STORE-PREFIX'").get().n,4);
  prefixHole=true;await prefixRun(2);
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryLastProviderHttpStatus,503);
  assert.deepEqual(config('CON-PREFIX').easyOrdersRecoveryPendingShortIds,[7004],'A404 ahead hole remains durably queued when a later request fails');
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryProbeCursor,7005,'Only the separately tracked probe may move past the queued404');
  assert.equal(config('CON-PREFIX').easyOrdersRecoveryCursor,7004,'The contiguous checkpoint never skips the next unresolved order');
  // A busy shared provider can return >30 consecutive orders owned by a
  // DIFFERENT storefront. Each verified foreign Short ID is safe to advance
  // past between cron runs. Without a separate ahead cursor the scheduler
  // would inspect the same first 30 forever, losing later local orders.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-PROBE','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-PROBE','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-PROBE',easyOrdersRecoveryHighestShortId:899,
      easyOrdersRecoveryCursor:900
    }),now,'EO-PROBE');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)')
    .run('TENANT-A','CON-PROBE','api_key',secret.ciphertextB64,secret.ivB64);
  const inspectedIds=[];
  const probeApi=async url=>{
    const shortId=Number(url.split('/').at(-1));inspectedIds.push(shortId);
    if(shortId>=900&&shortId<=934)return Response.json({
      ...p,id:'FOREIGN-'+shortId,short_id:shortId,store_id:'EO-FOREIGN'
    });
    if(shortId===935)return Response.json({
      ...p,id:'PROBE-935',short_id:935,store_id:'EO-PROBE'
    });
    return Response.json({message:'record not found'},{status:404});
  };
  const probeRun=()=>reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-PROBE',maxRequests:15,fetcher:probeApi
  });
  const firstProbe=await probeRun();
  assert.equal(firstProbe.recovered,0);
  assert.equal(config('CON-PROBE').easyOrdersRecoveryProbeCursor,915);
  const secondProbe=await probeRun();
  assert.equal(secondProbe.recovered,0);
  assert.equal(config('CON-PROBE').easyOrdersRecoveryProbeCursor,930);
  const finalProbe=await probeRun();
  assert.equal(finalProbe.recovered,1,'Same-store order beyond 30 foreign IDs must be reached');
  assert.ok(config('CON-PROBE').easyOrdersRecoveryProbeCursor>=936,
    'Ahead probe may continue after the own-store order when unused budget remains');
  assert.ok(config('CON-PROBE').easyOrdersRecoveryPendingShortIds.includes(936),
    'Unknown 404 after last own-store order is retained for future retry');
  assert.deepEqual(inspectedIds.slice(0,36),Array.from({length:36},(_,i)=>900+i));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE ref='easyorders:PROBE-935'").get().n,1);

  // Once a 404 is durably queued, newer Short IDs must remain discoverable.
  // Simulate 35 missing source IDs followed by a real store order: no infinite
  // rescans of the first 30, no permanent skip of the delayed source records.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-HOLES','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-HOLES','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-HOLES',easyOrdersRecoveryHighestShortId:1199,
      easyOrdersRecoveryCursor:1200
    }),now,'EO-HOLES');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)')
    .run('TENANT-A','CON-HOLES','api_key',secret.ciphertextB64,secret.ivB64);
  let lateHoleAvailable=false;
  const holeApi=async url=>{
    const id=Number(url.split('/').at(-1));
    if(id===1235||lateHoleAvailable&&id===1202)
      return Response.json({...p,id:'OWN-'+id,short_id:id,store_id:'EO-HOLES'});
    if(id>1235)return Response.json({...p,id:'FOREIGN-'+id,short_id:id,store_id:'EO-OTHER'});
    return Response.json({message:'record not found'},{status:404});
  };
  let foundBeyondHoles=false;
  for(let i=0;i<8;i++){
    const x=await reconcileEasyOrdersOrders(env,{
      clientId:'TENANT-A',connectionId:'CON-HOLES',maxRequests:15,fetcher:holeApi
    });
    if(x.recovered){foundBeyondHoles=true;break;}
  }
  assert.equal(foundBeyondHoles,true,'35 missing Short IDs cannot permanently hide a later own-store order');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE ref='easyorders:OWN-1235'").get().n,1);
  assert.ok(config('CON-HOLES').easyOrdersRecoveryPendingShortIds.includes(1202),
    'Unresolved 404 must remain durably queued after the ahead probe advances');
  const holeHealth=await easyOrdersRecoveryStatus(env,{
    clientId:'TENANT-A',connectionId:'CON-HOLES'
  });
  assert.ok(holeHealth.unresolvedAheadCount>=35,
    'Operator-visible health must include a truthful unresolved-ahead count');
  assert.equal(holeHealth.status,'catching_up',
    'Aggregate health must not say healthy when missing Short IDs are queued');
  assert.equal(holeHealth.results[0].status,'catching_up',
    'The store itself must stay catching_up despite cursor passing high-water');
  assert.equal(holeHealth.results[0].lastCronAt,null,
    'Manual-only scans must not masquerade as scheduled recovery');
  lateHoleAvailable=true;
  let delayedRecovered=false;
  for(let i=0;i<45;i++){
    const x=await reconcileEasyOrdersOrders(env,{
      clientId:'TENANT-A',connectionId:'CON-HOLES',maxRequests:15,fetcher:holeApi
    });
    if(x.recoveredOrderIds.some(id=>id==='OWN-1202')){delayedRecovered=true;break;}
  }
  assert.equal(delayedRecovered,true,'Late creation in a previously 404 slot must get recovered');
  assert.equal(config('CON-HOLES').easyOrdersRecoveryPendingShortIds.includes(1202),false);

  // An unconfirmed HTTP 404 is kept in a retry queue even as later verified
  // foreign-store IDs advance discovery.
  db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-FUTURE','TENANT-A','active',0,now);
  db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
    .run('CON-FUTURE','TENANT-A','easyorders','connected',JSON.stringify({
      kunStoreId:'STORE-FUTURE',easyOrdersRecoveryHighestShortId:1009,
      easyOrdersRecoveryCursor:1010
    }),now,'EO-FUTURE');
  db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)')
    .run('TENANT-A','CON-FUTURE','api_key',secret.ciphertextB64,secret.ivB64);
  let futurePublished=false;
  const futureApi=async url=>{
    const id=Number(url.split('/').at(-1));
    if(id===1010)return futurePublished
      ?Response.json({...p,id:'LATE-FUTURE-1010',short_id:id,store_id:'EO-FUTURE'})
      :Response.json({message:'record not found'},{status:404});
    return Response.json({...p,id:'FOREIGN-'+id,short_id:id,store_id:'EO-FOREIGN'});
  };
  await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-FUTURE',maxRequests:3,fetcher:futureApi
  });
  assert.equal(config('CON-FUTURE').easyOrdersRecoveryProbeCursor,1013,
    'Discovery advances only when the 404 was durably queued');
  assert.deepEqual(config('CON-FUTURE').easyOrdersRecoveryPendingShortIds,[1010]);
  futurePublished=true;
  const restoredFuture=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-FUTURE',maxRequests:5,fetcher:futureApi
  });
  assert.equal(restoredFuture.recovered,1);
  assert.equal(config('CON-FUTURE').easyOrdersRecoveryPendingShortIds.includes(1010),false);

  // Once a provider 429 arrives, avoid exhausting quota by querying every
  // other store in the same scheduled run. Their checkpoints remain intact.
  for(const id of ['CON-QUOTA-1','CON-QUOTA-2']){
    db.prepare('INSERT INTO store_connections (id,client_id,provider,status,config_json,updated_at,external_store_id) VALUES (?,?,?,?,?,?,?)')
      .run(id,'TENANT-QUOTA','easyorders','connected',JSON.stringify({
        kunStoreId:id,easyOrdersRecoveryHighestShortId:1100,
        easyOrdersRecoveryCursor:1100
      }),now,'EO-'+id);
    db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)')
      .run(id,'TENANT-QUOTA','active',0,now);
    db.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?,?)')
      .run('TENANT-QUOTA',id,'api_key',secret.ciphertextB64,secret.ivB64);
  }
  let quotaCalls=0;
  const quotaResult=await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-QUOTA',maxRequests:30,fetcher:async ()=>{
      quotaCalls++;return Response.json({message:'retry later'},{status:429});
    }
  });
  assert.equal(quotaCalls,1,'429 pauses all accounts in this scheduled run');
  assert.equal(quotaResult.checkedConnections,1);
  assert.equal(quotaResult.uncheckedConnections,1);
  assert.equal(quotaResult.ok,false);
  assert.equal(config('CON-QUOTA-2').easyOrdersRecoveryCursor,1100,
    'Unvisited store checkpoint is never consumed');

  // An owner can run a manual reconciliation even when the scheduler is
  // broken. Health must never mistake that manual activity for Cron proof.
  assert.equal(config('CON-PROBE').easyOrdersRecoveryLastCronAt,undefined);
  await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-PROBE',maxRequests:1,
    fetcher:probeApi,trigger:'cron'
  });
  const actualCronAt=config('CON-PROBE').easyOrdersRecoveryLastCronAt;
  assert.ok(Number.isFinite(Date.parse(actualCronAt)),'Scheduled task must save a real Cron receipt');
  await reconcileEasyOrdersOrders(env,{
    clientId:'TENANT-A',connectionId:'CON-PROBE',maxRequests:1,fetcher:probeApi
  });
  assert.equal(config('CON-PROBE').easyOrdersRecoveryLastCronAt,actualCronAt,
    'Manual recovery must never refresh the genuine Cron timestamp');

  // Exercise the ACTUAL explicit recovery -> canonical webhook -> SQLite path.
  // Earlier replay tests use mocked ingestion; this case proves the default
  // ingest adapter and request route token work without modifying live data.
  env.EASYORDERS_TARGETED_RECOVERY_ENABLED='true';
  const historicPayload={...p,id:'HISTORIC-WEFAQ-SYNTHETIC',short_id:1250,
    store_id:'EO-EXTERNAL-D',status:'pending',phone:'01000001250'};
  let reconciledFees=0;
  const explicitOptions={
    clientId:'TENANT-A',storeId:'STORE-D',connectionId:'CON-D',
    confirmStoreId:'STORE-D',confirmBackup:true,shortIds:[1250],
    fetcher:async(url,options)=>{
      assert.equal(options.method,'GET');assert.ok(url.endsWith('/1250'));
      return Response.json(historicPayload);
    },
    reconcileFee:async()=>{reconciledFees++;return {ok:true,skipped:'not_shipped_yet'};}
  };
  const firstHistoric=await replayExplicitEasyOrdersStoreGaps(env,explicitOptions);
  assert.equal(firstHistoric.ok,true,JSON.stringify(firstHistoric));
  assert.equal(firstHistoric.recovered,1);
  assert.equal(firstHistoric.alreadyInKun,0);
  const historicId=firstHistoric.recoveredOrderIds[0];
  assert.equal(db.prepare('SELECT store_id FROM orders WHERE id=?').get(historicId).store_id,'STORE-D');
  assert.equal(reconciledFees,1);
  db.prepare('UPDATE orders SET state=?,note=?,history=? WHERE id=?')
    .run('shipped','PRESERVE-STAFF-NOTE','[{"actor":"agent"}]',historicId);
  const replayedHistoric=await replayExplicitEasyOrdersStoreGaps(env,explicitOptions);
  assert.equal(replayedHistoric.recovered,0);
  assert.equal(replayedHistoric.alreadyInKun,1);
  assert.equal(reconciledFees,1,'Already existing order has no second fee reconciliation');
  assert.deepEqual({...db.prepare('SELECT state,note,history FROM orders WHERE id=?').get(historicId)},
    {state:'shipped',note:'PRESERVE-STAFF-NOTE',history:'[{"actor":"agent"}]'});
  env.EASYORDERS_TARGETED_RECOVERY_ENABLED='false';
  await assert.rejects(()=>replayExplicitEasyOrdersStoreGaps(env,explicitOptions),
    {code:'EASYORDERS_REPLAY_DISABLED'});

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
