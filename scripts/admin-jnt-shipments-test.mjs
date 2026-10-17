import assert from 'node:assert/strict';
import {normalizeJntShipment,jntStatus,handleAdminJntShipments} from '../src/admin-jnt-shipments.js';

const valid=normalizeJntShipment({awb:'JT123456789',rawStatus:'Return Sign',sender:'Seller A',codAmount:'1,050.50',shippingFee:'65'});
assert.equal(valid.awb,'JT123456789');
assert.equal(valid.status,'returned','returns must be prioritized over signed');
assert.equal(valid.codAmount,1050.5);
assert.equal(valid.collectedAmount,null,'requested COD must not be misreported as collected COD');
assert.equal(jntStatus('Signed'),'delivered');
assert.equal(jntStatus('In transit'),'in_transit');
assert.equal(jntStatus('invented new state'),'unknown','unknown J&T states must not become shipped');
assert.equal(normalizeJntShipment({awb:'',status:'Signed'}),null);
assert.equal(normalizeJntShipment({awb:'JT12345',normalizedStatus:'untrusted',rawStatus:'Signed'}).status,'delivered');

function fakeDatabase(){
  const calls=[],batches=[];
  return {
    calls,batches,
    prepare(sql){
      const entry={sql,args:[]};calls.push(entry);
      return {
        bind(...args){entry.args=args;return this;},
        async run(){return {meta:{changes:1}};},
        async first(){return sql.includes('COUNT(*)')?{total:0,created:0,pickedUp:0,transit:0,delivered:0,returned:0,cancelled:0,unknown:0,codExpected:0,codReportedCollected:0,shippingFees:0,linkedToKun:0}:null;},
        async all(){return {results:[]};}
      };
    },
    async batch(statements){batches.push(statements);return statements.map(()=>({success:true}));}
  };
}
function req(method='GET',body,headers={}){
  return new Request('https://app.kun-online.com/api/admin/jnt-shipments',{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
}
const delegate=role=>({async fetch(r){assert.equal(new URL(r.url).pathname,'/api/me');return role?new Response(JSON.stringify({role,email:role+'@example.com'}),{status:200}):new Response('{}',{status:401});}});
for(const role of [null,'client','ops','support','viewer','accountant']){
  const db=fakeDatabase();
  const response=await handleAdminJntShipments({request:req(),env:{DB:db},delegate:delegate(role)});
  assert.equal(response.status,role?403:401,'not platform admin: '+role);
  assert.equal(db.calls.length,0,'forbidden callers must never touch J&T carrier data or create tables');
}
{
  const db=fakeDatabase();
  const response=await handleAdminJntShipments({request:req(),env:{DB:db},delegate:delegate('admin')});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.total,0);
  assert.equal(data.isCompleteCarrierHistory,false,'do not promise historical coverage without J&T bulk export');
  assert.ok(db.calls.some(x=>x.sql.includes('CREATE TABLE IF NOT EXISTS admin_jnt_shipments')));
  assert.ok(db.calls.some(x=>x.sql.includes('EXISTS(SELECT 1 FROM orders')),'only read linkage; do not mutate orders');
  assert.ok(!db.calls.some(x=>/UPDATE\s+orders|DELETE\s+FROM\s+orders|INSERT\s+INTO\s+orders/i.test(x.sql)));
}
{
  const db=fakeDatabase();
  const response=await handleAdminJntShipments({request:req('POST',{rows:[
    {awb:'JT123456789',rawStatus:'Signed',codAmount:1000,sender:'Merchant'},
    {awb:'JT888888888',rawStatus:'Returned',returnReason:'Receiver refused'}
  ]}),env:{DB:db},delegate:delegate('admin')});
  assert.equal(response.status,200);
  assert.equal((await response.json()).processed,2);
  assert.equal(db.batches.length,1);
  assert.equal(db.batches[0].length,2);
  assert.ok(db.calls.some(x=>x.sql.includes('ON CONFLICT(account,awb) DO UPDATE')));
  assert.ok(!db.calls.some(x=>/UPDATE\s+orders|INSERT\s+INTO\s+orders|DELETE\s+FROM\s+orders/i.test(x.sql)));
}
{
  const db=fakeDatabase();
  const response=await handleAdminJntShipments({request:req('POST',{rows:Array(201).fill({awb:'JT12345'})}),env:{DB:db},delegate:delegate('admin')});
  assert.equal(response.status,400);
  assert.equal(db.batches.length,0);
}
console.log('PASS: admin-only J&T carrier reports, classification, safe import and isolation');