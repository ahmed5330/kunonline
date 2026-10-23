/* Execute real Admin Client Command Center SQL against synthetic in-memory SQLite.
 * Never queries Cloudflare or any customer account. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolveAdminBriefRange,adminClientCommandCenter} from '../src/admin-client-command-center.js';

const source=await readFile(new URL('../src/admin-client-command-center.js',import.meta.url),'utf8');
const businessSource=await readFile(new URL('../src/business-intelligence.js',import.meta.url),'utf8');
assert.match(businessSource,/FROM orders WHERE client_id=\? \$\{storeSql\} AND date\(COALESCE\(NULLIF\(TRIM\(date\),''\),created_at\)\)/,'business brief order date must agree with admin 30d metric');
assert.match(businessSource,/AND NOT EXISTS \(SELECT 1 FROM order_duplicate_links dup WHERE dup.duplicate_order_id=orders.id\)/,'business brief must exclude linked duplicates');
const tick=String.fromCharCode(96);
function actualSql(prefix,closing){
  const start=source.indexOf(prefix),end=source.indexOf(closing,start);
  assert.ok(start>=0&&end>start,'Missing real admin SQL '+prefix);
  return source.slice(start+prefix.length,end);
}
const globalOrders=actualSql('env.DB.prepare('+tick,tick+').bind(period.from,period.to).all()');
assert.match(globalOrders,/FROM orders/);
const briefSql=actualSql('env.DB.prepare('+tick+'SELECT COUNT(*) total',tick+').bind(clientId,from,to).first()');
const clientOrders='SELECT COUNT(*) total'+briefSql;
assert.match(globalOrders,/COALESCE\(NULLIF\(TRIM\(date\),''\),created_at\)/);
assert.match(clientOrders,/COALESCE\(NULLIF\(TRIM\(date\),''\),created_at\)/);
for(const query of [globalOrders,clientOrders]){
  assert.match(query,/confirmed','preparing','shipped','signed','collected'/,'confirmed includes downstream states');
  assert.match(query,/NOT EXISTS \(SELECT 1 FROM order_duplicate_links dup WHERE dup.duplicate_order_id=orders.id\)/,'admin report must exclude linked duplicate orders');
}

const db=new DatabaseSync(':memory:');
try{
  db.exec('CREATE TABLE orders (id TEXT PRIMARY KEY,client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,collected_amount REAL,customer_id TEXT)');
  db.exec('CREATE TABLE order_duplicate_links (duplicate_order_id TEXT PRIMARY KEY)');
  const stmt=db.prepare('INSERT INTO orders (id,client_id,store_id,date,created_at,state,total,collected_amount,customer_id) VALUES (?,?,?,?,?,?,?,?,?)');
  for(const row of [
    ['order-a1','tenant-a','store-a',null,'2026-10-20T11:20:00Z','confirmed',100,null,'customer-a1'],
    ['order-a2','tenant-a','store-a','','2026-10-21T15:00:00Z','shipped',200,null,'customer-a2'],
    ['order-a3','tenant-a','store-a','2026-10-22','2026-10-02T09:00:00Z','collected',300,250,'customer-a3'],
    ['old-a','tenant-a','store-a','2026-08-30','2026-10-22T09:00:00Z','cancelled',999,null,'old-date-is-authoritative'],
    ['outside-a','tenant-a','store-a',null,'2026-09-23T10:00:00Z','pending',444,null,'outside-window'],
    ['dup-a','tenant-a','store-a',null,'2026-10-21T15:00:00Z','collected',1200,900,'duplicate-a'],
    ['order-b1','tenant-b','store-b',null,'2026-10-22T08:00:00Z','signed',400,null,'customer-b1'],
    ['dup-b','tenant-b','store-b',null,'2026-10-22T08:00:00Z','collected',500,490,'duplicate-b']
  ])stmt.run(...row);
  db.prepare('INSERT INTO order_duplicate_links (duplicate_order_id) VALUES (?)').run('dup-a');
  db.prepare('INSERT INTO order_duplicate_links (duplicate_order_id) VALUES (?)').run('dup-b');
  const period=resolveAdminBriefRange({preset:'30d',now:new Date('2026-10-23T12:00:00Z')});
  assert.equal(period.from,'2026-09-24');
  assert.equal(period.to,'2026-10-23');
  const global=db.prepare(globalOrders).all(period.from,period.to);
  const clients=new Map(global.map(row=>[row.client_id,row]));
  assert.equal(global.length,2);
  assert.equal(clients.get('tenant-a').total,3,'include missing/blank date via created_at');
  assert.equal(clients.get('tenant-a').confirmed,3,'count downstream statuses as confirmed');
  assert.equal(clients.get('tenant-a').collected_amount,250);
  assert.equal(clients.get('tenant-b').total,1,'tenant B isolated from tenant A');
  assert.equal(clients.get('tenant-b').confirmed,1);
  assert.equal(clients.get('tenant-a').gmv,600,'linked duplicates must not inflate GMV');
  assert.equal(clients.get('tenant-b').gmv,400,'linked duplicates must not inflate other tenant GMV');
  const businessWhere=businessSource.match(/FROM orders WHERE client_id=\? \$\{storeSql\} AND date\(COALESCE\(NULLIF\(TRIM\(date\),''\),created_at\)\) BETWEEN date\(\?\) AND date\(\?\) AND NOT EXISTS \(SELECT 1 FROM order_duplicate_links dup WHERE dup.duplicate_order_id=orders.id\)/)?.[0];
  assert.ok(businessWhere,'exact Business Brief order filter must be located');
  const businessTotal=db.prepare('SELECT COUNT(*) total '+businessWhere.replace('${storeSql}','')).get('tenant-a',period.from,period.to);
  assert.equal(businessTotal.total,3,'Business Brief and Admin order count must match for tenant A');
  const storeScoped=db.prepare('SELECT COUNT(*) total '+businessWhere.replace('${storeSql}',' AND store_id=?')).get('tenant-a','store-a',period.from,period.to);
  assert.equal(storeScoped.total,3,'store-scoped Business Brief must match Admin when only one store is eligible');
  for(const [tenant,expected] of [['tenant-a',3],['tenant-b',1],['unknown-tenant',0]]){
    const row=db.prepare(clientOrders).get(tenant,period.from,period.to);
    assert.equal(row.total,expected,'client and home counters agree for '+tenant);
    if(expected)assert.equal(row.confirmed,clients.get(tenant).confirmed);
  }
  for(const [from,to] of [
    ['2026-02-31','2026-03-02'],
    ['2026-13-01','2026-13-31'],
    ['2025-02-29','2025-03-01'],
    ['2026-04-31','2026-05-01'],
    ['0000-01-01','0000-01-02']
  ])assert.throws(()=>resolveAdminBriefRange({preset:'custom',from,to}),e=>e?.code==='ADMIN_BRIEF_DATE_REQUIRED');
  assert.equal(resolveAdminBriefRange({preset:'custom',from:'2024-02-29',to:'2024-03-01'}).days,2);
  await assert.rejects(()=>adminClientCommandCenter({DB:{prepare(){throw Error('Unauthorized database read');}}},{
    me:{role:'client',clientId:'tenant-a'},range:period
  }),e=>e?.status===403,'non-admin caller must fail before database reads');
  const riskStart=source.indexOf('function riskCount('),riskEnd=source.indexOf('\nfunction compactHomeClient',riskStart);
  assert.ok(riskStart>=0&&riskEnd>riskStart,'inventory risk helper must exist');
  const riskCount=new Function('n','pct',source.slice(riskStart,riskEnd)+'; return riskCount;')(
    v=>Number(v)||0,(a,b)=>b?Math.round(Number(a)/Number(b)*10000)/100:0);
  const safe={orders:{total:0,pending:0},inventory:{lowStock:0,outOfStock:0},walletBalance:100,marketing:{spend:0}};
  assert.equal(riskCount(safe),0,'healthy inventory and positive wallet must not alert');
  assert.equal(riskCount({...safe,inventory:{lowStock:2,outOfStock:1}}),2,'low and out-of-stock alerts must both contribute');
  assert.equal(riskCount({...safe,inventory:{lowStock:2,outOfStock:0}}),1,'low-stock alert must count independently');
  console.log('Admin orders30days scope PASS: duplicate suppression, KPI/Business Brief parity, inventory risk, store/tenant isolation, strict calendar, SQLite-only.');
}finally{db.close();}
