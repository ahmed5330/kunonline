/* Synthetic Easy Orders -> canonical D1 -> Android state-sync transport.
 * Tests the source-to-mobile contract, NOT a signed APK or deployed Worker.
 * No Cloudflare or live Easy Orders network requests are made.
 */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleEasyOrdersWebhook,easyOrdersWebhookPath} from '../src/commerce-order-sync.js';
import {createMobileSync} from '../src/mobile-state-sync.js';

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE store_connections (id TEXT PRIMARY KEY,client_id TEXT,provider TEXT,status TEXT,config_json TEXT,
 last_error TEXT,last_sync_at TEXT,updated_at TEXT,external_store_id TEXT);
CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT,status TEXT,is_default INTEGER,created_at TEXT);
CREATE TABLE integration_secrets(client_id TEXT,connection_id TEXT,secret_name TEXT,ciphertext_b64 TEXT,iv_b64 TEXT);
CREATE TABLE customers(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,name TEXT,phone TEXT,gov TEXT,address TEXT,
 tags TEXT,note TEXT,created_at TEXT);
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,ref TEXT,customer_id TEXT,date TEXT,
 name TEXT,phone TEXT,gov TEXT,address TEXT,product TEXT,product_note TEXT,unit_price REAL,qty INTEGER,
 total REAL,product_cost REAL,shipping_cost REAL,source TEXT,note TEXT,state TEXT,checkpoint TEXT,
 contact_log TEXT,history TEXT,created_at TEXT);
`);
const conn=(id,client,store,external)=>{
  db.prepare('INSERT INTO store_connections(id,client_id,provider,status,config_json,external_store_id) VALUES(?,?,?,?,?,?)')
    .run(id,client,'easyorders','connected',JSON.stringify({kunStoreId:store}),external);
  db.prepare('INSERT INTO stores VALUES(?,?,?,?,?)').run(store,client,'active',1,'2026-10-23T00:00:00Z');
};
conn('CON-1','CLIENT-1','STORE-1','EO-SHOP-1');
conn('CON-2','CLIENT-2','STORE-2','EO-SHOP-2');
const env={SESSION_SECRET:'SYNTHETIC_MOBILE_SYNC_AUTH_ONLY',DB:{
  prepare(sql){return {bind(...p){return {
    first:async()=>db.prepare(sql).get(...p)||null,
    all:async()=>({results:db.prepare(sql).all(...p)}),
    run:async()=>({success:true,meta:{changes:db.prepare(sql).run(...p).changes}})
  }}};}
}};
async function webhook(connectionId,body){
  const connection=db.prepare('SELECT * FROM store_connections WHERE id=?').get(connectionId);
  const url=await easyOrdersWebhookPath(env,connection);
  return handleEasyOrdersWebhook(new Request('https://fake.invalid'+url,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  }),env,{connectionId,routeToken:url.split('/').at(-1)});
}
const tokens={'CLIENT-1':'fake-client-1','CLIENT-2':'fake-client-2'};
const load=async request=>{
  assert.equal(new URL(request.url).pathname,'/api/state');
  const client=request.headers.get('X-Kun-Client-Id');
  if(tokens[client]!==request.headers.get('Authorization'))return Response.json({error:'AUTH_REQUIRED'},{status:401});
  const store=request.headers.get('X-Kun-Store-Id');
  const orders=db.prepare('SELECT id,ref,state,checkpoint,store_id FROM orders WHERE client_id=? AND store_id=? ORDER BY id')
    .all(client,store).map(x=>({id:x.id,ref:x.ref,state:x.state,checkpoint:x.checkpoint,storeId:x.store_id}));
  return Response.json({orders,storeId:store,updatedAt:'deterministic-test-snapshot'});
};
const mobile=createMobileSync();
async function poll({client,store,cursor='',auth=tokens[client]}){
  const url=new URL('https://fake.invalid/api/mobile/state-sync');
  if(cursor)url.searchParams.set('cursor',cursor);
  const response=await mobile({request:new Request(url,{headers:{
    'X-Kun-Client-Id':client,'X-Kun-Store-Id':store,Authorization:auth
  }}),load});
  return {status:response.status,data:await response.json()};
}
try{
  const initial=await webhook('CON-1',{id:'DUPLICATE-EXTERNAL-ID',store_id:'EO-SHOP-1',
    full_name:'Fake Customer 1',status:'pending',created_at:'2026-10-23T01:00:00Z',
    total_cost:125,cart_items:[]});
  assert.equal(initial.ok,true);
  const first=await poll({client:'CLIENT-1',store:'STORE-1'});
  assert.equal(first.status,200);
  assert.equal(first.data.mode,'reset');
  assert.equal(first.data.state.orders.length,1);
  assert.equal(first.data.state.orders[0].state,'pending');

  const second=await webhook('CON-2',{id:'DUPLICATE-EXTERNAL-ID',store_id:'EO-SHOP-2',
    full_name:'Fake Customer 2',status:'pending',created_at:'2026-10-23T01:00:00Z',
    total_cost:250,cart_items:[]});
  assert.notEqual(second.id,initial.id,'External collision must not merge separate clients');
  const foreign=await poll({client:'CLIENT-2',store:'STORE-2',cursor:first.data.cursor});
  assert.equal(foreign.status,200);
  assert.equal(foreign.data.mode,'reset','Never reuse a cursor across different authorization/store');
  assert.equal(foreign.data.state.orders.length,1);
  assert.equal(foreign.data.state.orders[0].id,second.id);
  assert.notEqual(foreign.data.state.orders[0].id,initial.id);

  const status=await webhook('CON-1',{event_type:'order-status-update',
    order_id:'DUPLICATE-EXTERNAL-ID',new_status:'shipped'});
  assert.equal(status.id,initial.id);
  const changed=await poll({client:'CLIENT-1',store:'STORE-1',cursor:first.data.cursor});
  assert.equal(changed.data.mode,'delta','Android transport should receive updated status without full reload');
  assert.equal(changed.data.orders.upsert.length,1);
  assert.equal(changed.data.orders.upsert[0].id,initial.id);
  assert.equal(changed.data.orders.upsert[0].state,'shipped');
  const unchanged=await poll({client:'CLIENT-1',store:'STORE-1',cursor:changed.data.cursor});
  assert.equal(unchanged.data.mode,'unchanged','No re-fetch of unchanged order payload');
  const forbidden=await poll({client:'CLIENT-1',store:'STORE-1',cursor:changed.data.cursor,auth:'invalid'});
  assert.equal(forbidden.status,401,'Authorization must be reevaluated before using saved delta');
  assert.equal(db.prepare('SELECT state FROM orders WHERE id=?').get(second.id).state,'pending',
    'Different tenant did not receive or inherit first shop state');
  console.log('Easy Orders -> synthetic D1 -> Android state-sync PASS: creation, scoped collision, status delta, unchanged, auth recheck.');
}finally{db.close();}
