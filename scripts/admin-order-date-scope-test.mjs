/* Execute real Admin Client Command Center SQL against synthetic in-memory SQLite.
 * Never queries Cloudflare or any customer account. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolveAdminBriefRange,adminClientCommandCenter} from '../src/admin-client-command-center.js';

const source=await readFile(new URL('../src/admin-client-command-center.js',import.meta.url),'utf8');
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
}

const db=new DatabaseSync(':memory:');
try{
  db.exec('CREATE TABLE orders (client_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,collected_amount REAL,customer_id TEXT)');
  const stmt=db.prepare('INSERT INTO orders (client_id,date,created_at,state,total,collected_amount,customer_id) VALUES (?,?,?,?,?,?,?)');
  for(const row of [
    ['tenant-a',null,'2026-10-20T11:20:00Z','confirmed',100,null,'customer-a1'],
    ['tenant-a','','2026-10-21T15:00:00Z','shipped',200,null,'customer-a2'],
    ['tenant-a','2026-10-22','2026-10-02T09:00:00Z','collected',300,250,'customer-a3'],
    ['tenant-a','2026-08-30','2026-10-22T09:00:00Z','cancelled',999,null,'old-date-is-authoritative'],
    ['tenant-a',null,'2026-09-23T10:00:00Z','pending',444,null,'outside-window'],
    ['tenant-b',null,'2026-10-22T08:00:00Z','signed',400,null,'customer-b1']
  ])stmt.run(...row);
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
  console.log('Admin orders30days scope PASS: null/blank dates, confirmed stage parity, client isolation, strict calendar, SQLite-only.');
}finally{db.close();}
