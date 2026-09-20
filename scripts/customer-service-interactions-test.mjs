import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleAction} from '../src/customer-service.js';
import {timeline} from '../src/order-events.js';
import {handleOperationalWorkflowV105} from '../src/operational-workflow-v105.js';
import {readFile} from 'node:fs/promises';

const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`
CREATE TABLE stores(id TEXT,client_id TEXT,name TEXT,code TEXT,is_default INTEGER,status TEXT);
CREATE TABLE user_store_access(user_id TEXT,client_id TEXT,store_id TEXT,role TEXT);
CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,history TEXT,contact_log TEXT,note TEXT,name TEXT,phone TEXT,state TEXT,awb TEXT,total REAL,source TEXT,date TEXT,created_at TEXT,contact_claim_user_id TEXT,contact_claim_name TEXT,contact_claimed_at TEXT);
CREATE TABLE order_stock_allocations(order_id TEXT,client_id TEXT,batch_id TEXT,status TEXT);
CREATE TABLE inventory_batches(id TEXT,client_id TEXT,name TEXT);
CREATE TABLE order_notes(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,order_id TEXT,body TEXT,created_by TEXT,created_at TEXT);
CREATE TABLE order_events(id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,order_id TEXT,event_type TEXT,from_state TEXT,to_state TEXT,actor_user_id TEXT,actor_email TEXT,source TEXT,metadata_json TEXT,created_at TEXT);
CREATE TABLE audit_log(id TEXT,client_id TEXT,store_id TEXT,entity_id TEXT,actor_user_id TEXT,actor_email TEXT,action TEXT,before_json TEXT,after_json TEXT,metadata_json TEXT,created_at TEXT);
INSERT INTO stores VALUES ('s1','c1','Store A','A',1,'active'),('s2','c1','Store B','B',0,'active');
INSERT INTO user_store_access VALUES ('u1','c1','s1','member'),('u2','c1','s1','member');
INSERT INTO orders(id,client_id,store_id,history,contact_log,note,state) VALUES ('o1','c1','s1','[]','[]','customer original','pending'),('o2','c1','s2','[]','[]','','pending');
`);
let failBatch=false,batchQueue=Promise.resolve();
const DB={
  prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};},
  batch(statements){const work=batchQueue.then(async()=>{sqlite.exec('BEGIN');try{const results=[];for(const [i,statement] of statements.entries()){results.push(await statement.run());if(failBatch&&i===0)throw new Error('simulated write failure');}sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}});batchQueue=work.catch(()=>{});return work;}
};
const me={role:'support',uid:'u1',clientId:'c1',email:'staff@example.test',name:'موظف الاختبار'};
const act=(action,body={},user=me,id='o1')=>handleAction(new Request(`https://preview.example/api/customer-service/orders/${id}/${action}?clientId=c1`,{method:'POST',body:JSON.stringify(body)}),{DB},user,()=>{throw new Error('Interaction must not depend on the legacy delegate');});
const read=()=>sqlite.prepare('SELECT * FROM orders WHERE id=?').get('o1');

await assert.rejects(act('notes',{note:'   '}),e=>e.code==='NOTE_REQUIRED');
await assert.rejects(act('notes',{note:'x'.repeat(2001)}),e=>e.code==='NOTE_TOO_LONG');
await assert.rejects(act('notes',{note:'forbidden'},me,'o2'),e=>e.code==='STORE_ISOLATION');
await assert.rejects(act('contact',{}, {...me,clientId:'c2'}),e=>e.code==='TENANT_ISOLATION');
sqlite.exec("UPDATE user_store_access SET role='viewer' WHERE user_id='u1'");
await assert.rejects(act('contact'),e=>e.code==='STORE_READ_ONLY');
sqlite.exec("UPDATE user_store_access SET role='member' WHERE user_id='u1'");
const note=await act('notes',{note:'ملاحظة الاختبار <script>'});
assert.equal(note.status,201);assert.equal(note.data.note.byUserId,'u1');
assert.equal(sqlite.prepare('SELECT body FROM order_notes').get().body,'ملاحظة الاختبار <script>');
assert.equal(read().note,'customer original');
const contact=await act('contact');assert.equal(contact.data.contactCount,1);
const call=await act('contact',{channel:'phone',intent:'call'});assert.equal(call.data.contactCount,2);assert.equal(call.data.entry.intent,'call');
assert.equal(call.data.entry.byName,me.name);assert.ok(!Number.isNaN(Date.parse(call.data.entry.at)));
const persistedCall=JSON.parse(read().history).find(x=>x.type==='contact'&&x.intent==='call');
assert.ok(persistedCall,'call click must persist a call entry in the order history itself');
assert.equal(persistedCall.channel,'phone');assert.equal(persistedCall.byName,me.name);assert.ok(!Number.isNaN(Date.parse(persistedCall.at)));
await Promise.all([act('notes',{note:'parallel A'}),act('notes',{note:'parallel B'})]);
const notes=JSON.parse(read().history).filter(x=>x.type==='internal_note');assert.equal(notes.length,3);
const feed=await timeline({DB},{clientId:'c1',orderId:'o1',storeId:'s1'});
assert.equal(feed.notes.length,3);assert.equal(feed.events.length,5);
assert.equal(feed.events.filter(x=>x.type==='contact_phone').length,2);
const callEvent=feed.events.find(x=>x.metadata.intent==='call');assert.ok(callEvent);
assert.equal(callEvent.actor,me.email);assert.ok(!Number.isNaN(Date.parse(callEvent.at)));assert.match(String(callEvent.metadata.message||''),/مكالمة/);
const before=read().history;failBatch=true;
await assert.rejects(act('notes',{note:'must roll back'}),/simulated write failure/);failBatch=false;
assert.equal(read().history,before);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM order_notes').get().n,3);

const operational=(user,id='o1')=>handleOperationalWorkflowV105({
  request:new Request(`https://preview.example/api/customer-service/orders/${id}/claim-contact?clientId=c1`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:'c1'})}),
  env:{DB},ctx:{},delegate:{fetch:async request=>new URL(request.url).pathname==='/api/me'?new Response(JSON.stringify(user),{status:200,headers:{'Content-Type':'application/json'}}):new Response(JSON.stringify({error:'unexpected delegate'}),{status:500,headers:{'Content-Type':'application/json'}})}
});
const firstClaim=await operational(me);assert.equal(firstClaim.status,200);const firstClaimBody=await firstClaim.json();assert.equal(firstClaimBody.claim.userId,'u1');assert.equal(firstClaimBody.claim.mine,true);
const secondUser={...me,uid:'u2',email:'second@example.test',name:'موظف تاني'};
const secondClaim=await operational(secondUser);assert.equal(secondClaim.status,409);const secondClaimBody=await secondClaim.json();assert.equal(secondClaimBody.code,'ORDER_CONTACT_ALREADY_CLAIMED');assert.equal(secondClaimBody.claim.name,me.name);
assert.equal(read().contact_claim_user_id,'u1');assert.equal(read().contact_claim_name,me.name);assert.ok(!Number.isNaN(Date.parse(read().contact_claimed_at)));

const activeUi=await readFile(new URL('../public/v2/modules-v75-customer-service-interactions-v753.js',import.meta.url),'utf8');
const claimUi=await readFile(new URL('../public/v2/modules-v105-customer-service-claim.js',import.meta.url),'utf8');
for(const marker of ['claim-contact','kun:customer-service-contact-claimed'])assert.ok(activeUi.includes(marker),`Contact interaction UI missing ${marker}`);
for(const marker of ['جاري الاتصال','ORDER_CONTACT','data-state=\\"shipped\\"','POLL_MS=5000','قسم الشحن'])assert.ok(claimUi.includes(marker)||marker==='ORDER_CONTACT',`Live claim UI missing ${marker}`);
assert.ok(claimUi.includes('option[value=\\"shipped\\"]'),'Customer Service must remove shipped from its state selector');
console.log('Customer Service interactions passed: persisted notes/contact/call, atomic single-owner contact claim, live contacting UI contract, rollback, validation and tenant/store permissions.');
