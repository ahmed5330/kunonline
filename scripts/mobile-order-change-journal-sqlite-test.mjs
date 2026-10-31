import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {handleMobileOrderChanges} from '../src/mobile-order-changes.js';

globalThis.crypto ||= webcrypto;
const migration=readFileSync(new URL('../migrations/0100_order_change_journal.sql',import.meta.url),'utf8');
const columns=[...new Set([...migration.matchAll(/(?:OLD|NEW)\.([a-z_]+)/g)].map(m=>m[1]))];
const db=new DatabaseSync(':memory:');
const defs=columns.filter(c=>!['id','client_id','store_id'].includes(c)).map(c=>c+' TEXT').join(',');
db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,'+defs+');');
db.exec('CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,name TEXT,is_default INTEGER,status TEXT);');
db.exec("INSERT INTO stores VALUES ('a','t1','Store A',1,'active'),('b','t1','Store B',0,'active'),('c','t2','Store C',0,'active')");
db.exec(migration);
const query={
  prepare(sql){return {
    bind(...args){
      const statement=db.prepare(sql);
      return {first:async()=>statement.get(...args),all:async()=>({results:statement.all(...args)})};
    },
    first:async()=>db.prepare(sql).get(),all:async()=>({results:db.prepare(sql).all()})
  }}
};
const count=()=>db.prepare('SELECT COUNT(*) c FROM order_change_log').get().c;
const save=(id,client='t1',store='a')=>db.prepare('INSERT INTO orders(id,client_id,store_id,state) VALUES (?,?,?,?)').run(id,client,store,'pending');
save('o1');
assert.equal(count(),1);
db.prepare("UPDATE orders SET state='pending' WHERE id='o1'").run();
assert.equal(count(),1,'No-op order update must not create a change');
db.prepare("UPDATE orders SET state='confirmed' WHERE id='o1'").run();
assert.equal(count(),2);
db.prepare("UPDATE orders SET store_id='b' WHERE id='o1'").run();
assert.equal(count(),4,'Store moves create tombstone + upsert in one transaction');
assert.deepEqual(db.prepare('SELECT store_id,operation FROM order_change_log WHERE seq IN (3,4) ORDER BY seq').all()
  .map(x=>[x.store_id,x.operation]),[['a','remove'],['b','upsert']]);
db.exec('BEGIN');
save('will-rollback');
db.exec('ROLLBACK');
assert.equal(count(),4,'Journal entry must rollback atomically with order mutation');
db.prepare("DELETE FROM orders WHERE id='o1'").run();
assert.equal(count(),5);

const delegate=(cookie='session-a')=>({fetch:async request=>{
  if(request.url.endsWith('/api/me'))return Response.json(
    cookie==='invalid'?{error:'Denied'}:{role:'client',clientId:'t1',uid:'u1'},
    {status:cookie==='invalid'?401:200});
  if(request.url.endsWith('/api/my-client-context'))
    return Response.json({clients:[{id:'t1',name:'Tenant One'}]});
  return Response.json({error:'unhandled'}, {status:404});
}});
function request(cursor,storeId='a',cookie='session-a',clientId='t1'){
  const u=new URL('https://app.example/api/mobile/order-changes');
  if(cursor)u.searchParams.set('cursor',cursor);
  if(storeId)u.searchParams.set('storeId',storeId);
  if(clientId)u.searchParams.set('clientId',clientId);
  return new Request(u,{headers:{Cookie:'ko_session='+cookie}});
}
const env={DB:query,SESSION_SECRET:'synthetic-secret'};
const call=async(cursor,storeId='a',cookie='session-a',clientId='t1',e=env)=>{
  const res=await handleMobileOrderChanges({request:request(cursor,storeId,cookie,clientId),env:e,delegate:delegate(cookie)});
  return {status:res.status,data:await res.json()};
};
const first=await call();
assert.equal(first.data.mode,'reset','A new app must get an authoritative snapshot before saving cursor');
assert.equal((await call(first.data.cursor)).data.mode,'unchanged');
save('a2');
let next=await call(first.data.cursor);
assert.equal(next.data.mode,'changes');
assert.deepEqual(next.data.changes.map(x=>x.orderId),['a2']);
assert.equal(next.data.changes[0].storeId,'a');
assert.equal((await call(next.data.cursor)).data.mode,'unchanged');
assert.equal((await call(next.data.cursor,'b')).data.mode,'reset','Store scope changes invalidate cursor');
assert.equal((await call(next.data.cursor,'a','session-b')).data.mode,'reset','Session switch invalidates cursor');
assert.equal((await call(null,'c')).status,403,'Unauthorized store cannot be selected');
assert.equal((await call(null,'a','session-a','t2')).status,403,'Other tenant cannot be selected');
assert.equal((await call(null,'a','invalid')).status,401,'Revoked session denied before journal read');

for(let i=0;i<56;i++)save('page-'+i);
let page=await call(next.data.cursor);
assert.equal(page.data.mode,'changes');assert.equal(page.data.hasMore,true);assert.equal(page.data.changes.length,50);
let remaining=await call(page.data.cursor);
assert.equal(remaining.data.changes.length,6);assert.equal(remaining.data.hasMore,false);
assert.equal(new Set([...page.data.changes,...remaining.data.changes].map(x=>x.seq)).size,56);

const missing={SESSION_SECRET:'synthetic-secret',DB:{prepare(sql){if(sql.includes('order_change_log'))throw new Error('missing table');return query.prepare(sql);}}};
const unavailable=await call(null,'a','session-a','t1',missing);
assert.equal(unavailable.status,503);
assert.equal(unavailable.data.resetRequired,true);
db.close();
console.log('PASS: atomic triggers, tombstones, rollback, ACL, cursor integrity, pagination, missing schema fail-closed');
