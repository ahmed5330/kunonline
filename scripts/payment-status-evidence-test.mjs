/* Offline contract: payment proof must never advance fulfilment/COD lifecycle. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createProviderPaymentEvent,paymentFromHistory,paymentFromOrder} from '../src/order-payment-status.js';
import {handleEasyOrdersWebhook,easyOrdersWebhookPath,mapEasyOrdersStatus} from '../src/commerce-order-sync.js';

assert.equal(mapEasyOrdersStatus('paid'),'pending','Paid online must NOT imply collected');
assert.equal(mapEasyOrdersStatus('refunded'),'pending','Refund must NOT imply returned parcel');
assert.equal(createProviderPaymentEvent('confirmed'),null);
assert.equal(paymentFromHistory([{state:'collected'}]).status,'unknown','COD collection does not prove electronic payment');
assert.equal(paymentFromOrder({history:[{state:'confirmed'}],providerStatus:'paid'}).status,'paid');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE store_connections(id TEXT PRIMARY KEY,client_id TEXT,provider TEXT,status TEXT,config_json TEXT,
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
db.prepare('INSERT INTO stores VALUES (?,?,?,?,?)').run('STORE-1','CLIENT-1','active',1,'2026-11-06');
db.prepare('INSERT INTO store_connections(id,client_id,provider,status,config_json,external_store_id) VALUES (?,?,?,?,?,?)')
 .run('CON-1','CLIENT-1','easyorders','connected',JSON.stringify({kunStoreId:'STORE-1'}),'EO-SHOP-1');
const env={SESSION_SECRET:'SYNTHETIC_PAYMENT_ONLY',DB:{
  prepare(sql){return {bind(...values){return {
    first:async()=>db.prepare(sql).get(...values)||null,
    all:async()=>({results:db.prepare(sql).all(...values)}),
    run:async()=>({success:true,meta:{changes:db.prepare(sql).run(...values).changes}})
  }}};}
}};
const connection=db.prepare('SELECT * FROM store_connections WHERE id=?').get('CON-1');
const path=await easyOrdersWebhookPath(env,connection);
const webhook=async body=>handleEasyOrdersWebhook(new Request('https://fake.invalid'+path,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
}),env,{connectionId:'CON-1',routeToken:path.split('/').at(-1)});
const current=()=>db.prepare('SELECT id,state,checkpoint,history FROM orders WHERE id=?').get('ORDER-1');
try{
  await webhook({id:'ORDER-1',store_id:'EO-SHOP-1',status:'pending',
    full_name:'Synthetic Customer',phone:'01012345678',cart_items:[],total_cost:250});
  assert.equal(current().state,'pending');
  assert.equal(paymentFromHistory(current().history).status,'unknown');

  await webhook({event_type:'order-status-update',order_id:'ORDER-1',new_status:'confirmed'});
  assert.equal(current().state,'confirmed');
  await webhook({event_type:'order-status-update',order_id:'ORDER-1',
    new_status:'paid',payment_ref_id:'SANDBOX-TRANSACTION-1'});
  assert.equal(current().state,'confirmed','Payment callback must preserve confirmation stage');
  assert.equal(paymentFromHistory(current().history).status,'paid');
  assert.equal(paymentFromHistory(current().history).reference,'SANDBOX-TRANSACTION-1');
  await webhook({event_type:'order-status-update',order_id:'ORDER-1',new_status:'shipped'});
  assert.equal(current().state,'shipped');
  assert.equal(paymentFromHistory(current().history).status,'paid','Shipping must not clear paid badge');
  await webhook({event_type:'order-status-update',order_id:'ORDER-1',new_status:'refunded'});
  assert.equal(current().state,'shipped','Refund status must not rewrite shipping history');
  assert.equal(paymentFromHistory(current().history).status,'refunded');

  await webhook({id:'ORDER-2',store_id:'EO-SHOP-1',status:'paid',cart_items:[],total_cost:100});
  const direct=db.prepare('SELECT state,history FROM orders WHERE id=?').get('ORDER-2');
  assert.equal(direct.state,'pending');
  assert.equal(paymentFromHistory(direct.history).status,'paid');

  const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  for(const p of ['src/index.js','src/customer-service.js','src/production-customer-service.js']){
    assert(file(p).includes('paymentFromHistory'),'Payment proof is missing from '+p);
  }
  for(const p of ['public/v2/modules-v31-customer-service.js',
       'public/v2/modules-v40-order-details.js',
       'public/v2/modules-v42-customer-service-rich-cards.js']){
    assert(file(p).includes('مدفوع بالكامل'),'Web must show verified payment in '+p);
  }
  for(const p of ['android/app/src/main/java/com/kunonline/callerid/CallerOverlay.kt',
       'android/app/src/main/java/com/kunonline/callerid/CallerCardActivity.kt',
       'android/app/src/main/java/com/kunonline/callerid/KunPaymentBadge.kt']){
    assert(file(p).includes('مدفوع بالكامل'),'Android must show verified payment in '+p);
  }
  console.log('PASS: verified paid/refunded evidence, COD separation, webhook->board->Android/Web UI contracts');
}finally{db.close();}
