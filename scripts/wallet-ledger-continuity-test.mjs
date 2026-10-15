import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {auditWalletLedgerContinuity,walletPaymentDiagnostics} from '../src/wallet-payment-diagnostics.js';

// A synthetic sequence modeled on "credited then declined" disputes, not a
// reconstruction of any merchant's actual bank, order or wallet ledger.
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE wallet_accounts(client_id TEXT PRIMARY KEY,balance REAL,currency TEXT,billing_version TEXT);
CREATE TABLE state(id INTEGER PRIMARY KEY,json TEXT);
CREATE TABLE wallet_log(id TEXT PRIMARY KEY,client_id TEXT,created_at TEXT,type TEXT,amount REAL,balance_after REAL,note TEXT,order_id TEXT,reference_type TEXT,reference_id TEXT);
CREATE TABLE wallet_topup_requests(id TEXT PRIMARY KEY,client_id TEXT,status TEXT);
`);
db.prepare('INSERT INTO wallet_accounts VALUES(?,?,?,?)').run('MERCHANT',-178,'EGP','v27');
db.prepare('INSERT INTO state VALUES(?,?)').run(1,JSON.stringify({clients:[{id:'MERCHANT',walletBalance:-178,walletFeePerOrder:0}]}));
const ins=(id,client,type,amount,balance,ref)=>db.prepare(
 'INSERT INTO wallet_log VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,client,'2026-10-15T10:00:00.000Z',type,amount,balance,'synthetic',null,ref,id);
ins('TOPUP','MERCHANT','topup',500,500,'topup_request');
ins('ORDER','MERCHANT','deduct',167,333,'order');
ins('MONTH','MERCHANT','deduct',511,-178,'subscription_month');
ins('FOREIGN','OTHER','topup',999,999,'topup_request');
class Sql{
  constructor(sql){this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){return db.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:db.prepare(this.sql).all(...this.args)};}
}
const env={DB:{prepare:sql=>new Sql(sql)}};
const report=await walletPaymentDiagnostics(env,'MERCHANT');
assert.equal(report.balance,-178);
assert.equal(report.lastApprovedCredit.amount,500);
assert.equal(report.lastApprovedCredit.balanceAfter,500);
assert.equal(report.sinceLastCredit.debits,678);
assert.deepEqual(report.sinceLastCredit.debitBreakdown,{orders:167,subscription:511,other:0});
assert.equal(report.sinceLastCredit.expectedBalance,-178);
assert.equal(report.ledgerContinuity.anomalyCount,0);
assert.equal(report.ledgerContinuity.checkedPairs,2);
assert.equal(report.ledgerContinuity.unknownTypes.length,0);
assert.equal(report.ledgerCoverage.scanned,3,'foreign tenant logs must be excluded');
assert.equal(report.ledgerBalanceMismatch,0);
// A mutation to the recorded running balance must be caught even if the wallet
// account and final log balance were later made to match.
db.prepare("UPDATE wallet_log SET balance_after=345 WHERE id='ORDER'").run();
const corrupted=await walletPaymentDiagnostics(env,'MERCHANT');
assert.equal(corrupted.ledgerContinuity.anomalyCount,2);
assert.equal(corrupted.ledgerBalanceMismatch,0,'last ledger entry still matches wallet balance');
assert.ok(corrupted.ledgerContinuity.anomalies.every(x=>Math.abs(x.difference)>0.009));
// Unknown historical log types are explicitly flagged, not silently interpreted
// as valid evidence of either money in or money out.
const unknown=auditWalletLedgerContinuity([
  {seq:3,id:'X',type:'legacy_mystery',amount:40,balance_after:200},
  {seq:2,id:'Y',type:'topup',amount:200,balance_after:200}
]);
assert.deepEqual(unknown.unknownTypes,['legacy_mystery']);
assert.equal(unknown.checkedPairs,0);
const long=[
  {id:'X3',seq:3,type:'deduct',amount:1,balance_after:1},
  {id:'X2',seq:2,type:'deduct',amount:1,balance_after:1},
  {id:'X1',seq:1,type:'topup',amount:3,balance_after:3}
];
const capped=auditWalletLedgerContinuity(long,1);
assert.equal(capped.anomalyCount,2);
assert.equal(capped.anomalies.length,1);
assert.equal(capped.truncatedAnomalies,true);
db.close();
console.log('Wallet forensic ledger continuity PASS: sequential balance, debits by source, tenant isolation and hidden mid-ledger drift');
