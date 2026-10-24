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
  assert.equal(recovery.results[0].status,'healthy',JSON.stringify(recovery.results[0]));
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

  console.log('Easy Orders SQLite sync PASS: concurrent webhook/cron CAS, monotonic high-water, correct catching-up, tenant+store collision isolation, idempotent retries.');
}finally{db.close();}
