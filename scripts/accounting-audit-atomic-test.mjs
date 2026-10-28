import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountingEntry,deleteAccountingEntry,updateStoreManagementFeeSettings} from '../src/accounting.js';

const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE stores(id TEXT PRIMARY KEY,client_id,name,currency,management_fee_pct,updated_at);
CREATE TABLE orders(id,client_id,store_id,state,date,created_at);
CREATE TABLE transactions(id TEXT PRIMARY KEY,type,date,category,amount REAL,currency,method,client_id,store_id,note,created_by,created_at,document_no,counterparty,tax_amount,due_date,reference_type,reference_id,attachment_url,metadata_json);
CREATE TABLE audit_log(id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at);
INSERT INTO stores VALUES('SA','CA','A','EGP',5,'old'),('SB','CB','B','EGP',7,'old');
INSERT INTO transactions(id,client_id,store_id,amount) VALUES('TA','CA','SA',10),('TB','CB','SB',20);
CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;`);
let prepared=0;
const DB={prepare(sql){prepared++;let values=[];return {bind(...a){values=a;return this;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};},async batch(items){db.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
const env={DB},actor={uid:'QA-ADMIN',email:'admin@example.test'},scope={clientId:'CA',storeId:'SA',actor};
const create=(amount=17.25,extra={})=>createAccountingEntry(env,{...scope,body:{type:'expense',amount,category:'Rent',date:'2026-10-28',...extra}});
const unconfirmed=e=>e.status===503&&e.code==='ACCOUNTING_WRITE_UNCONFIRMED'&&!e.message.includes('synthetic audit');
await assert.rejects(create(),unconfirmed,'entry cannot commit without its audit');
assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,2);
await assert.rejects(deleteAccountingEntry(env,{...scope,id:'TA'}),unconfirmed);
assert.equal(db.prepare('SELECT amount FROM transactions WHERE id=?').get('TA').amount,10);
await assert.rejects(updateStoreManagementFeeSettings(env,{...scope,managementFeePct:20}),unconfirmed);
assert.equal(db.prepare('SELECT management_fee_pct FROM stores WHERE id=?').get('SA').management_fee_pct,5);
assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n,0);
db.exec('DROP TRIGGER fail_audit');
for(const amount of [0,-1,NaN,Infinity,-Infinity,1e308,1e100,'invalid',true,[1],{},'',null]){
  const before=prepared;
  await assert.rejects(create(amount),e=>e.status===400&&e.code==='ACCOUNTING_AMOUNT_INVALID');
  assert.equal(prepared,before,'invalid amounts are rejected before database access');
}
for(const taxAmount of [NaN,Infinity,-Infinity,1e100,'invalid',true,[1]]){
  const before=prepared;
  await assert.rejects(create(17.25,{taxAmount}),e=>e.status===400&&e.code==='ACCOUNTING_TAX_AMOUNT_INVALID');
  assert.equal(prepared,before);
}
const made=await create(17.25,{taxAmount:-2.25});
assert.equal(db.prepare('SELECT tax_amount FROM transactions WHERE id=?').get(made.id).tax_amount,-2.25,'finite signed tax metadata retains its previous semantics');
const creation=db.prepare('SELECT * FROM audit_log WHERE action=?').get('accounting.entry.create');
assert.equal(creation.entity_id,made.id);assert.equal(creation.actor_user_id,actor.uid);assert.equal(creation.client_id,'CA');
assert.equal(JSON.parse(creation.metadata_json).amount,17.25);
await deleteAccountingEntry(env,{...scope,id:made.id});
assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions WHERE id=?').get(made.id).n,0);
assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE action=?').get('accounting.entry.delete').n,1);
await updateStoreManagementFeeSettings(env,{...scope,managementFeePct:6});
const feeAudit=db.prepare('SELECT * FROM audit_log WHERE action=?').get('store.management_fee.update');
assert.equal(JSON.parse(feeAudit.before_json).managementFeePct,5);assert.equal(JSON.parse(feeAudit.after_json).managementFeePct,6);
assert.equal(db.prepare('SELECT management_fee_pct FROM stores WHERE id=?').get('SB').management_fee_pct,7);
assert.equal(db.prepare('SELECT amount FROM transactions WHERE id=?').get('TB').amount,20);
await assert.rejects(deleteAccountingEntry(env,{...scope,clientId:'CB',id:'TA'}),e=>e.code==='ACCOUNTING_ENTRY_NOT_FOUND');
const emptyTax=await create(1,{taxAmount:''});
assert.equal(db.prepare('SELECT tax_amount FROM transactions WHERE id=?').get(emptyTax.id).tax_amount,0,'an omitted/empty optional tax stays compatible');
await assert.rejects(createAccountingEntry({DB:{...DB,batch:async()=>[{success:false},{success:false}]}},{...scope,body:{type:'expense',amount:2}}),unconfirmed,'failed batch receipts cannot report success');
const rowsBefore=db.prepare('SELECT COUNT(*) n FROM transactions').get().n,auditsBefore=db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
await assert.rejects(createAccountingEntry({DB:{...DB,async batch(items){await DB.batch(items);throw new Error('lost acknowledgement');}}},{...scope,body:{type:'expense',amount:3}}),unconfirmed);
assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,rowsBefore+1);
assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n,auditsBefore+1,'a lost receipt is unconfirmed, never an excuse to erase or repeat a committed audited record');
db.close();
console.log('Accounting atomic audit PASS: create/delete/rate rollback on audit failure, matching actor/tenant events, finite safe amounts and cross-tenant preservation.');
