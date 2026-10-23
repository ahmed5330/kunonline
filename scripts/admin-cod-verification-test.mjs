/* Verified-vs-estimated COD data: source SQL, real in-memory SQLite, zero live writes. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolveAdminBriefRange} from '../src/admin-client-command-center.js';

const [source,ui,loader]=await Promise.all([
 readFile(new URL('../src/admin-client-command-center.js',import.meta.url),'utf8'),
 readFile(new URL('../public/v2/modules-v74-admin-client-command-center.js',import.meta.url),'utf8'),
 readFile(new URL('../public/v2/modules-v23-admin.js',import.meta.url),'utf8')
]);
const tick=String.fromCharCode(96);
function extract(prefix,suffix){
 const start=source.indexOf(prefix),end=source.indexOf(suffix,start+prefix.length);
 assert.ok(start>=0&&end>start,'real Admin COD SQL must be locatable');
 return source.slice(start+prefix.length,end);
}
const home=extract('env.DB.prepare('+tick,tick+').bind(period.from,period.to).all()');
const brief='SELECT COUNT(*) total'+extract('env.DB.prepare('+tick+'SELECT COUNT(*) total',tick+').bind(clientId,from,to).first()');
for(const sql of [home,brief]){
 assert.match(sql,/verified_collected_amount/,'verified COD amount must exist');
 assert.match(sql,/estimated_unverified_collection/,'unknown amount estimate must exist');
 assert.match(sql,/unverified_collected_orders/,'unknown amount order count must exist');
 assert.match(sql,/NOT EXISTS \(SELECT 1 FROM order_duplicate_links dup WHERE dup.duplicate_order_id=orders.id\)/,'duplicate orders never inflate collections');
 assert.match(sql,/state='collected' AND collected_amount IS NOT NULL THEN collected_amount/,'only explicit carrier amount is verified');
 assert.match(sql,/state='collected' AND collected_amount IS NULL THEN COALESCE\(total,0\)/,'missing amount is an estimate, not receipt');
}
const db=new DatabaseSync(':memory:');
try{
 db.exec('CREATE TABLE orders (id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,collected_amount REAL,customer_id TEXT)');
 db.exec('CREATE TABLE order_duplicate_links (duplicate_order_id TEXT PRIMARY KEY)');
 const add=db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?)');
 for(const row of [
  ['a-verified','tenant-a','store-a',null,'2026-10-20T11:00:00Z','collected',300,250,'one'],
  ['a-unverified','tenant-a','store-a',null,'2026-10-21T11:00:00Z','collected',400,null,'two'],
  ['a-zero','tenant-a','store-a','2026-10-22','2026-10-22T11:00:00Z','collected',100,0,'three'],
  ['a-signed','tenant-a','store-a','2026-10-22','2026-10-22T11:00:00Z','signed',200,null,'four'],
  ['a-duplicate','tenant-a','store-a','2026-10-22','2026-10-22T11:00:00Z','collected',1000,null,'five'],
  ['b-verified','tenant-b','store-x','2026-10-21','2026-10-21T10:00:00Z','collected',80,70,'six'],
  ['b-unverified','tenant-b','store-x','2026-10-21','2026-10-21T10:00:00Z','collected',500,null,'seven']
 ])add.run(...row);
 db.prepare('INSERT INTO order_duplicate_links VALUES (?)').run('a-duplicate');
 const period=resolveAdminBriefRange({preset:'30d',now:new Date('2026-10-23T12:00:00Z')});
 const homeRows=new Map(db.prepare(home).all(period.from,period.to).map(x=>[x.client_id,x]));
 for(const [id,expected] of [
  ['tenant-a',{collected:3,collected_amount:650,verified_collected_amount:250,estimated_unverified_collection:400,unverified_collected_orders:1}],
  ['tenant-b',{collected:2,collected_amount:570,verified_collected_amount:70,estimated_unverified_collection:500,unverified_collected_orders:1}]
 ]){
  const row=homeRows.get(id);
  assert.ok(row,'all tenants with data included');
  for(const [key,value] of Object.entries(expected))assert.equal(row[key],value,'home '+id+' '+key);
  assert.equal(row.collected_amount,row.verified_collected_amount+row.estimated_unverified_collection,'legacy total is a labelled mix');
  const client=db.prepare(brief).get(id,period.from,period.to);
  for(const [key,value] of Object.entries(expected))assert.equal(client[key],value,'per-tenant '+id+' '+key);
 }
 const unknown=db.prepare(brief).get('tenant-c',period.from,period.to);
 assert.equal(unknown.verified_collected_amount,0);
 assert.equal(unknown.unverified_collected_orders,null);
 assert.equal(homeRows.size,2,'a tenant cannot inherit another account collections');
 const sourceUi=['تحصيل موثق','تقديري غير موثق','verifiedCollectedAmount','estimatedUnverifiedCollection','unverifiedCollectedOrders','verifiedCollectedAmountPct'];
 for(const term of sourceUi)assert.ok(ui.includes(term)||source.includes(term),'COD explanation/contract missing: '+term);
 assert.match(loader,/modules-v74-admin-client-command-center\.js\?v=74\.1/,'changed finance explanation must bust cached asset');
 assert.doesNotThrow(()=>new Function(ui),'browser module must remain parseable');
 console.log('Admin COD verification PASS: explicit vs estimated receipts, zero confirmed amount, duplicates excluded, tenant/period parity, clear labels.');
}finally{db.close();}
