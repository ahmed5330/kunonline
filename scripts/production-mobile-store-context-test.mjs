import assert from 'node:assert/strict';
import {handleProductionCustomerService} from '../src/production-customer-service.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const calls=[];
const delegate={fetch:async request=>{
  const url=new URL(request.url);
  calls.push({path:url.pathname,cookie:request.headers.get('Cookie')});
  if(url.pathname==='/api/me')return json({role:'support',uid:'staff-1',email:'qa-staff@example.invalid',clientId:null});
  if(url.pathname==='/api/my-client-context')return json({ok:true,allClients:false,clients:[{id:'client-a',name:'متجر أ'}]});
  throw new Error('Unexpected Preview endpoint: '+url.pathname);
}};
const sessions={Cookie:'ko_session=ci-test-cookie'};
let rowQuery='';const orders=[{id:'order-a',client_id:'client-a',store_id:'store-a',ref:'A-1',name:'عميل تجريبي',state:'pending',total:99},{id:'order-b',client_id:'client-a',store_id:'store-b',ref:'B-1',name:'عميل مؤكد',state:'confirmed',total:199}];
const env={DB:{prepare(sql){return {bind(...binds){return {
  async all(){
    if(sql.includes('SELECT a.store_id,a.role,s.name,s.status'))return {results:[{store_id:'store-a',role:'member',name:'فرع أ',status:'active'}]};
    if(sql.includes('SELECT s.id,s.name,s.code'))return {results:[{id:'store-a',name:'فرع أ',code:'A',status:'active',role:'member'},{id:'store-b',name:'فرع ب',code:'B',status:'active',role:'member'}]};
    if(sql.includes('FROM orders WHERE')){rowQuery=sql;assert.deepEqual(binds.slice(0,7),['client-a','pending','no_answer','confirmed','preparing','shipped','deferred']);const ids=sql.includes('store_id IN')?binds.slice(7):sql.includes('store_id=?')?[binds[7]]:[];return {results:orders.filter(row=>ids.includes(row.store_id))};}
    throw new Error('Unexpected SQL: '+sql);
  }
};}};}}};
const scoped=url=>new Request(url,{headers:sessions});
let response=await handleProductionCustomerService({request:scoped('https://app.kun-online.com/api/my-client-context'),env,delegate});
assert.equal(response.status,200);
let payload=await response.json();
assert.deepEqual(payload.clients.map(c=>c.id),['client-a']);
assert.equal(calls.length,1,'Discovery must call the actual authorized Preview endpoint only');
assert.deepEqual(calls[0],{path:'/api/my-client-context',cookie:sessions.Cookie});
assert.equal(calls.some(c=>c.path==='/api/state'),false,'Unscoped legacy state must never be used for discovery');

response=await handleProductionCustomerService({request:scoped('https://app.kun-online.com/api/customer-service?clientId=client-a&storeId=store-a'),env,delegate});
assert.equal(response.status,200);
payload=await response.json();
assert.equal(payload.selectedStoreId,'store-a');
assert.equal(payload.allStores,false);
assert.deepEqual(payload.orders.map(o=>[o.id,o.storeId]),[['order-a','store-a']]);
assert.match(rowQuery,/store_id=\?/);
assert.equal(payload.stores.length,2,'Assigned-store selector must show every authorized store');
response=await handleProductionCustomerService({request:scoped('https://app.kun-online.com/api/customer-service?clientId=client-a'),env,delegate});
assert.equal(response.status,200,'Multi-store support staff must not be forced to choose a single store');
payload=await response.json();
assert.equal(payload.selectedStoreId,null);
assert.deepEqual(payload.orders.map(o=>[o.id,o.storeId,o.state]),[['order-a','store-a','pending'],['order-b','store-b','confirmed']]);
assert.match(rowQuery,/store_id IN \(\?,\?\)/);
assert.equal(payload.orders[1].storeName,'فرع ب');


response=await handleProductionCustomerService({request:scoped('https://app.kun-online.com/api/customer-service?clientId=client-a&storeId=store-b'),env,delegate});
assert.equal(response.status,403,'User cannot select an unassigned store');
assert.equal((await response.json()).code,'STORE_ISOLATION');
console.log('Production authorized client discovery and store-scoped customer-service regression PASS.');
