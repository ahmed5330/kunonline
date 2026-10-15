import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pendingMigrationsReadonly,HISTORY_TABLE_SQL,APPLIED_MIGRATIONS_SQL} from './preview-pending-migrations.mjs';
const db=new DatabaseSync(':memory:');
const files=['0092_inventory.sql','0093_scans.sql'];
const run=async sql=>{
  assert([HISTORY_TABLE_SQL,APPLIED_MIGRATIONS_SQL].includes(sql));
  assert.match(sql,/^SELECT /);
  return [{success:true,results:db.prepare(sql).all()}];
};
try{
  await assert.rejects(()=>pendingMigrationsReadonly(run,files),/history is missing/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,0,
    'Read-only inspection must never initialize a missing history table');
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT)');
  assert.deepEqual(await pendingMigrationsReadonly(run,files),files);
  db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(files[0]);
  assert.deepEqual(await pendingMigrationsReadonly(run,files),[files[1]]);
  db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(files[1]);
  assert.deepEqual(await pendingMigrationsReadonly(run,files),[]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n,2);
  for(const payload of [null,[],[{success:false,results:[]}],{success:false,result:[{results:[]}]},
    {errors:[{code:1000}],result:[{results:[]}]}]){
    await assert.rejects(()=>pendingMigrationsReadonly(async()=>payload,files));
  }
  await assert.rejects(()=>pendingMigrationsReadonly(run,[]),/local migration/);
  db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(files[0]);
  await assert.rejects(()=>pendingMigrationsReadonly(run,files),/duplicate/);
  for(const path of ['scripts/preview-db-release-preflight.sh','scripts/preview-live-readonly-availability.mjs'])
    assert(!readFileSync(path,'utf8').includes('d1 migrations list'));
  console.log('Read-only migration inventory PASS: SELECT only, no initialization, pending/applied detection and failure rejection.');
}finally{db.close();}
