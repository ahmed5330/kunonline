import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {FINANCE_CHECKS,verifyFinanceSqlReadonly,assertFinanceResults,verifyLiveFinanceSettlement} from './preview-wallet-finance-invariants.mjs';

assert.equal(verifyFinanceSqlReadonly(),true);
const names=Object.keys(FINANCE_CHECKS);
const base=Object.fromEntries(names.map(k=>[k,0]));
assert.deepEqual(assertFinanceResults(base),{ok:true,checks:names.length});
for(const name of names)assert.throws(()=>assertFinanceResults({...base,[name]:1}),new RegExp(name));
assert.throws(()=>assertFinanceResults({...base,duplicate_topup_credit:null}),/missing/);
assert.throws(()=>assertFinanceResults({...base,duplicate_topup_credit:undefined}),/missing/);
assert.throws(()=>assertFinanceResults({...base,duplicate_topup_credit:2}),/Invalid/);
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE wallet_accounts(client_id TEXT PRIMARY KEY,balance REAL,credit_limit REAL);
  CREATE TABLE wallet_topup_requests(id TEXT PRIMARY KEY,client_id TEXT,status TEXT,amount REAL);
  CREATE TABLE wallet_log(id TEXT PRIMARY KEY,client_id TEXT,reference_type TEXT,reference_id TEXT,type TEXT,amount REAL);`);
const putTopup=(id,status,client='A')=>db.prepare('INSERT INTO wallet_topup_requests VALUES(?,?,?,100)').run(id,client,status);
const putLog=(id,ref,client='A')=>db.prepare("INSERT INTO wallet_log VALUES(?,?,'topup_request',?,'topup',100)").run(id,client,ref);
db.prepare('INSERT INTO wallet_accounts VALUES(?,?,?)').run('A',100,0);
db.prepare('INSERT INTO wallet_accounts VALUES(?,?,?)').run('B',100,0);
const read=()=>Object.fromEntries(Object.entries(FINANCE_CHECKS).map(([name,sql])=>[name,db.prepare(sql).get().conflict]));
async function inspect(){return verifyLiveFinanceSettlement(async sql=>[{results:[db.prepare(sql).get()]}]);}
assert.equal((await inspect()).ok,true);
putTopup('PENDING','pending');assert.equal((await inspect()).ok,true);
putTopup('APPROVED','approved');
assert.equal(read().approved_topup_missing_credit,1);
await assert.rejects(inspect(),/approved_topup_missing_credit/);
putLog('L1','APPROVED');
assert.equal((await inspect()).ok,true);
putTopup('FOREIGN','approved','B');putLog('L2','FOREIGN','A');
assert.equal(read().approved_topup_missing_credit,1,'Credit on another tenant must not count');
await assert.rejects(inspect(),/approved_topup_missing_credit/);
putLog('L3','FOREIGN','B');
assert.equal(read().approved_topup_missing_credit,0);
assert.equal(read().orphan_topup_credit,1,'Cross-tenant credit must also be treated as an orphan');
db.prepare("DELETE FROM wallet_log WHERE id='L2'").run();
db.prepare("UPDATE wallet_topup_requests SET status='rejected' WHERE id='APPROVED'").run();
assert.equal(read().credited_topup_rejected,1);
db.prepare("UPDATE wallet_topup_requests SET status='approved' WHERE id='APPROVED'").run();
putLog('ORPHAN','NOT-A-REQUEST');assert.equal(read().orphan_topup_credit,1);
db.prepare("DELETE FROM wallet_log WHERE id='ORPHAN'").run();
putLog('L4','APPROVED');assert.equal(read().duplicate_topup_credit,1);
db.prepare("DELETE FROM wallet_log WHERE id='L4'").run();
db.prepare("UPDATE wallet_accounts SET balance=-10 WHERE client_id='A'").run();
assert.equal(read().invalid_account_balance,1);
await assert.rejects(inspect(),/invalid_account_balance/);
db.prepare("UPDATE wallet_accounts SET balance=100 WHERE client_id='A'").run();
assert.equal((await inspect()).ok,true);
await assert.rejects(
  verifyLiveFinanceSettlement(async()=>[{results:[]}]),
  /authoritative result/
);
db.close();
const workflow=readFileSync('.github/workflows/preview.yml','utf8');
const check=workflow.indexOf('node scripts/preview-wallet-finance-invariants.mjs');
const stable=workflow.indexOf('name: Resolve verified stable Preview source');
assert(check>0&&check<stable,'Financial consistency must be proven before baseline deployment');
console.log('Preview D1 wallet finance SQL regression passed: tenant isolation, credited/rejected conflict, orphan/duplicate/missing credits, negative credit limits.');
