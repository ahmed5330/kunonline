import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mirrorLegacyBalance} from '../src/wallet-account.js';
import {walletPaymentDiagnostics} from '../src/wallet-payment-diagnostics.js';

// Synthetic real SQLite fixture. A concurrent state writer keeps the exact
// same timestamp but changes JSON between our legacy read and CAS update.
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE state(id INTEGER PRIMARY KEY,json TEXT,updated_at TEXT);
CREATE TABLE wallet_accounts(client_id TEXT PRIMARY KEY,balance REAL,currency TEXT,billing_version TEXT);
CREATE TABLE wallet_log(id TEXT PRIMARY KEY,client_id TEXT,created_at TEXT,type TEXT,amount REAL,balance_after REAL,note TEXT,order_id TEXT,reference_type TEXT,reference_id TEXT);
CREATE TABLE wallet_topup_requests(id TEXT PRIMARY KEY,client_id TEXT,status TEXT);
`);
const state={clients:[{id:'merchant',walletBalance:33,walletFeePerOrder:5,name:'متجر قبل التعديل'}],
  untouched:{safe:'original'}};
const stamp='2026-10-15T00:00:00.000Z';
db.prepare('INSERT INTO state VALUES(1,?,?)').run(JSON.stringify(state),stamp);
db.prepare('INSERT INTO wallet_accounts VALUES(?,?,?,?)').run('merchant',333,'EGP','v27');
let concurrentWriter=null;
class P {
  constructor(sql){this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){return db.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:db.prepare(this.sql).all(...this.args)};}
  async run(){
    if(concurrentWriter&&this.sql.startsWith('UPDATE state SET')){
      const fn=concurrentWriter;concurrentWriter=null;fn();
    }
    const result=db.prepare(this.sql).run(...this.args);
    return {meta:{changes:Number(result.changes)}};
  }
}
const env={DB:{prepare:sql=>new P(sql)}};
const before=await walletPaymentDiagnostics(env,'merchant');
assert.equal(before.legacyMirror.balance,33);
assert.equal(before.legacyMirror.balanceDrift,-300);
assert.equal(before.legacyMirror.mismatch,true);
assert.equal(before.legacyMirror.oldFeeStillEnabled,true);
assert.ok(!JSON.stringify(before).includes('متجر قبل التعديل'),'diagnostic must not expose legacy state PII');
concurrentWriter=()=>{
  const previous=db.prepare('SELECT * FROM state WHERE id=1').get();
  const edited=JSON.parse(previous.json);
  edited.clients[0].name='اسم المتجر تم تعديله من عملية أخرى';
  edited.untouched.safe='updated-by-competitor';
  // Deliberately *preserve* updated_at to prove the JSON predicate matters.
  db.prepare('UPDATE state SET json=?,updated_at=? WHERE id=1')
    .run(JSON.stringify(edited),previous.updated_at);
};
assert.equal(await mirrorLegacyBalance(env,'merchant',0,{disableLegacyFee:true}),true);
let data=JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json);
assert.equal(data.clients[0].walletBalance,333,'canonical ledger balance must win over stale caller value');
assert.equal(data.clients[0].walletFeePerOrder,0,'v27 legacy fee must not trigger double order billing');
assert.equal(data.clients[0].name,'اسم المتجر تم تعديله من عملية أخرى','retry must preserve concurrent edits');
assert.equal(data.untouched.safe,'updated-by-competitor','CAS protects unrelated state sections');
const audit=await walletPaymentDiagnostics(env,'merchant');
assert.equal(audit.legacyMirror.mismatch,false);
assert.equal(audit.legacyMirror.oldFeeStillEnabled,false);
assert.equal(audit.legacyMirror.balanceDrift,0);


// An absent timestamp is still safely compared using SQL IS NULL.
db.prepare('UPDATE state SET updated_at=NULL WHERE id=1').run();
db.prepare('UPDATE wallet_accounts SET balance=155 WHERE client_id=?').run('merchant');
assert.equal(await mirrorLegacyBalance(env,'merchant',999),true);
data=JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json);
assert.equal(data.clients[0].walletBalance,155);
assert.equal(data.clients[0].name,'اسم المتجر تم تعديله من عملية أخرى');
db.close();
console.log('Wallet legacy mirror same-millisecond JSON CAS and NULL timestamp fixture PASS');
