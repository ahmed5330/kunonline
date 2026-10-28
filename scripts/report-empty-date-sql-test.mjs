import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Execute the report's real SQL against isolated fixtures, never customer data.
const source=readFileSync(new URL('../src/admin-client-command-center.js',import.meta.url),'utf8');
const queries=[...source.matchAll(/env\.DB\.prepare\(`(SELECT[\s\S]*?)`\)/g)].map(m=>m[1]);
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE orders(id TEXT,client_id TEXT,customer_id TEXT,date TEXT,created_at TEXT,state TEXT,total REAL,collected_amount REAL);
CREATE TABLE transactions(client_id TEXT,date TEXT,created_at TEXT,type TEXT,amount REAL);`);
const add=db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)');
for(const [id,date,created] of [
  ['null',null,'2026-10-28T10:00:00Z'],['empty','','2026-10-28T11:00:00Z'],
  ['space','   ','2026-10-28T12:00:00Z'],['explicit','2026-10-28','2026-09-01T00:00:00Z'],
  ['outside','2026-09-01','2026-10-28T12:00:00Z'],['unknown',null,null]
])add.run(id,'A',id,date,created,'confirmed',100,null);
add.run('other','B','other','','2026-10-28T10:00:00Z','confirmed',900,null);
const orderQueries=queries.filter(q=>q.includes('FROM orders WHERE'));
assert.equal(orderQueries.length,2,'cover both admin summary and client brief');
for(const sql of orderQueries){
  const scoped=sql.includes('client_id=?');
  const rows=db.prepare(sql).all(...(scoped?['A','2026-10-28','2026-10-28']:['2026-10-28','2026-10-28']));
  const a=scoped?rows[0]:rows.find(r=>r.client_id==='A');
  assert.equal(a.total,4,'missing dates use creation date; explicit old dates and unknown dates stay excluded');
  assert.equal(a.gmv,400,'client totals preserve explicit date precedence and isolation');
  if(!scoped)assert.equal(rows.find(r=>r.client_id==='B').gmv,900);
}
const tx=db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?)');
tx.run('A','','2026-10-28T12:00:00Z','expense',25);
tx.run('A',null,'2026-10-28T12:00:00Z','income',80);
tx.run('A','2026-09-01','2026-10-28T12:00:00Z','income',999);
const finance=queries.find(q=>q.includes('FROM transactions WHERE'));
assert.ok(finance);
const rows=db.prepare(finance).all('2026-10-28','2026-10-28');
assert.equal(rows[0].income,80);assert.equal(rows[0].expenses,25);
db.close();
console.log('Report missing-date SQL PASS: null/empty/space fallback, explicit-date precedence, unknown dates excluded, tenant isolation and finance totals.');
