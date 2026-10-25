import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {checkExistingInventorySchema,declarations} from './existing-inventory-schema-check.mjs';
import {SCHEMA_SQL,buildMigrationFiles} from './preview-live-schema-rehearsal.mjs';
const db=new DatabaseSync(':memory:');
try{
 db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY)');
 const files=buildMigrationFiles(declarations);
 assert.throws(()=>checkExistingInventorySchema(db.prepare(SCHEMA_SQL).all(),files),/OBJECT_MISSING/);
 for(const file of files)db.exec(file.sql);
 const rows=db.prepare(SCHEMA_SQL).all();
 const result=checkExistingInventorySchema(rows,files);
 assert.equal(result.schemaChangesRequired,false);assert.ok(result.requiredTables>10);
 assert.throws(()=>checkExistingInventorySchema(rows.filter(x=>x.name!=='unit_active_allocation_insert'),files),/OBJECT_MISSING/);
 const sample=[...rows,{type:'table',name:'qa_shape',sql:'CREATE TABLE qa_shape(id TEXT PRIMARY KEY)'}];
 assert.throws(()=>checkExistingInventorySchema(sample,[{name:'migrations/0092_shape.sql',sql:'CREATE TABLE IF NOT EXISTS qa_shape(id TEXT PRIMARY KEY,memo TEXT)'}]),/COLUMN_MISMATCH/,'CREATE IF NOT EXISTS alone cannot prove all required columns exist');
 const changed=rows.map(x=>x.name==='unit_active_allocation_insert'?{...x,sql:x.sql.replace('UNIT_ACTIVE_ALLOCATION_CONFLICT','WRONG_GUARD')}:x);
 assert.throws(()=>checkExistingInventorySchema(changed,files),/DEFINITION_MISMATCH/);
 console.log('PASS: existing inventory schema requires every table, column and exact index/trigger definition; missing guards and no-op CREATE with missing columns fail closed.');
}finally{db.close();}
