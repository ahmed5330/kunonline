/* Synthetic SQLite + real Easy Orders webhook contract, no external API,
 * no Cloudflare resources, no customer data.
 */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mutateEasyOrdersConfig,mergeEasyOrdersRecoveryPatch} from '../src/easyorders-connection-config.js';
import {easyOrdersWebhookPath,handleEasyOrdersWebhook} from '../src/commerce-order-sync.js';

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
let race=null,forcedConflicts=0;
const env={SESSION_SECRET:'SYNTHETIC_TEST_ROUTE_SECRET_ONLY',DB:{
  prepare(sql){
    return {bind(...params){return {
      async first(){return db.prepare(sql).get(...params)||null;},
      async all(){return {results:db.prepare(sql).all(...params)};},
      async run(){
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

  console.log('Easy Orders SQLite sync PASS: concurrent webhook/cron CAS, monotonic high-water, correct catching-up, tenant+store collision isolation, idempotent retries.');
}finally{db.close();}
