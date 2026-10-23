/* Source-backed, read-only accounting period parity in isolated Node SQLite. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolveAdminBriefRange} from '../src/admin-client-command-center.js';

const [adminSource,businessSource]=await Promise.all([
  readFile(new URL('../src/admin-client-command-center.js',import.meta.url),'utf8'),
  readFile(new URL('../src/business-intelligence.js',import.meta.url),'utf8')
]);
function extract(source,start,end){
  const a=source.indexOf(start);
  assert.ok(a>=0,'Missing SQL start: '+start.slice(0,50));
  const b=source.indexOf(end,a+start.length);
  assert.ok(b>a,'Missing SQL end');
  return source.slice(a+start.length,b);
}
const tick=String.fromCharCode(96);
const adminSql=extract(adminSource,
  'env.DB.prepare('+tick+'SELECT client_id,\n      COALESCE(SUM(CASE WHEN type=',
  tick+').bind(period.from,period.to).all().catch');
const adminQuery='SELECT client_id,\n      COALESCE(SUM(CASE WHEN type='+adminSql;
const businessBody=extract(businessSource,
  'env.DB.prepare('+tick+'SELECT COALESCE(SUM(CASE WHEN type=',
  tick+').bind(...(storeId?');
const businessQuery='SELECT COALESCE(SUM(CASE WHEN type='+businessBody;
for(const query of [adminQuery,businessQuery]){
  assert.match(query,/date\(COALESCE\(NULLIF\(TRIM\(date\),''\),created_at\)\) BETWEEN date\(\?\) AND date\(\?\)/,'both financial sources must use canonical effective transaction day');
}
assert.match(adminQuery,/GROUP BY client_id/);
assert.ok(businessQuery.includes('FROM transactions WHERE client_id=? '),'Business Brief tenant condition must exist');

const db=new DatabaseSync(':memory:');
try{
  db.exec('CREATE TABLE transactions (client_id TEXT,store_id TEXT,date TEXT,created_at TEXT,type TEXT,amount REAL)');
  const insert=db.prepare('INSERT INTO transactions VALUES (?,?,?,?,?,?)');
  for(const row of [
    ['tenant-a','store-a',null,'2026-10-20T11:00:00Z','income',125],
    ['tenant-a','store-a','','2026-10-21T11:00:00Z','expense',45],
    ['tenant-a','store-a','2026-10-22','2026-09-01T12:00:00Z','income',175],
    ['tenant-a','store-b',null,'2026-10-21T12:00:00Z','income',80],
    ['tenant-a','store-a','2026-08-30','2026-10-22T11:00:00Z','expense',999],
    ['tenant-a','store-a',null,'2026-09-23T09:00:00Z','income',777],
    ['tenant-b','store-x',null,'2026-10-22T08:00:00Z','income',50],
    ['tenant-b','store-x','','2026-10-22T09:00:00Z','expense',5],
    ['tenant-b','store-x',null,'2026-09-01T08:00:00Z','income',900]
  ])insert.run(...row);
  const period=resolveAdminBriefRange({preset:'30d',now:new Date('2026-10-23T12:00:00Z')});
  const all=db.prepare(adminQuery).all(period.from,period.to);
  const map=new Map(all.map(row=>[row.client_id,row]));
  assert.equal(map.size,2,'two tenant source rows; no unscoped financial leakage');
  assert.deepEqual({income:map.get('tenant-a').income,expenses:map.get('tenant-a').expenses},{income:380,expenses:45});
  assert.deepEqual({income:map.get('tenant-b').income,expenses:map.get('tenant-b').expenses},{income:50,expenses:5});
  const byClient=businessQuery.replace('$'+'{storeSql}','');
  const byStore=businessQuery.replace('$'+'{storeSql}',' AND store_id=?');
  for(const [id,income,expenses] of [['tenant-a',380,45],['tenant-b',50,5]]){
    const row=db.prepare(byClient).get(id,period.from,period.to);
    assert.equal(row.income,income,'Business Brief must agree with Admin income: '+id);
    assert.equal(row.expenses,expenses,'Business Brief must agree with Admin expenses: '+id);
    assert.equal(row.income,map.get(id).income);
    assert.equal(row.expenses,map.get(id).expenses);
  }
  const storeA=db.prepare(byStore).get('tenant-a','store-a',period.from,period.to);
  assert.deepEqual({income:storeA.income,expenses:storeA.expenses},{income:300,expenses:45});
  const storeB=db.prepare(byStore).get('tenant-a','store-b',period.from,period.to);
  assert.deepEqual({income:storeB.income,expenses:storeB.expenses},{income:80,expenses:0});
  const forbidden=db.prepare(byStore).get('tenant-a','store-x',period.from,period.to);
  assert.equal(forbidden.income,0,'tenant A cannot see store X belonging to tenant B');
  assert.equal(forbidden.expenses,0);
  const readOutside=db.prepare(byStore).get('tenant-b','store-x',period.from,period.to);
  assert.equal(readOutside.income,50,'outside-period transaction excluded');
  console.log('Admin finance period PASS: null/blank transaction dates, explicit historical dates, tenant/store isolation, Admin vs Business Brief totals, SQLite-only.');
}finally{db.close();}
