import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleFinancialAccountingOS,faosLedgerBalance} from '../src/accounting-faos-api.js';

// A real SQL execution against an isolated in-memory replica of Preview D1.
// Neither GitHub CI nor the test opens Cloudflare, Easy Order, J&T, wallets or live orders.
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(fs.readFileSync('migrations/0098_financial_ledger_v1.sql','utf8'));
db.exec("CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT,status TEXT,currency TEXT,name TEXT)");
db.prepare('INSERT INTO stores VALUES(?,?,?,?,?)').run('QA_STORE','QA_CLIENT','active','EGP','متجر اختبار');
const env={APP_ENV:'preview',FAOS_WRITE_ENABLED:'1',DB:{
  prepare(sql){
    const stmt=db.prepare(sql);
    return {bind(...args){
      return {
        first:async()=>stmt.get(...args)||null,
        all:async()=>({results:stmt.all(...args)}),
        run:async()=>stmt.run(...args)
      };
    }};
  },
  async batch(ops){
    db.exec('BEGIN IMMEDIATE');
    try{for(const op of ops)await op.run();db.exec('COMMIT');}
    catch(error){db.exec('ROLLBACK');throw error;}
  }
}};
const me=(role='client',clientId='QA_CLIENT')=>({
  fetch:async()=>new Response(JSON.stringify({role,clientId}),{
    status:200,headers:{'Content-Type':'application/json'}
  })
});
async function call(path,{method='GET',body,role='client'}={}){
  const request=new Request('https://faos.test'+path,{
    method,headers:body?{'Content-Type':'application/json'}:{},
    body:body?JSON.stringify(body):undefined
  });
  const response=await handleFinancialAccountingOS({request,env,ctx:{},delegate:me(role)});
  return {status:response.status,data:await response.json()};
}
// Production cannot receive FAOS postings, including from a tenant owner.
const guard={
  storeId:'QA_STORE',date:'2026-10-18',currency:'EGP',description:'Safety guard test',
  idempotencyKey:'QA-GUARD-100',lines:[{accountCode:'1120',debit:10},{accountCode:'3100',credit:10}]
};
const guardedReq=new Request('https://faos.test/api/accounting/faos/journals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(guard)});
const guardedResponse=await handleFinancialAccountingOS({request:guardedReq,env:{...env,APP_ENV:'production'},ctx:{},delegate:me()});
assert.equal(guardedResponse.status,403);
assert.equal((await guardedResponse.json()).code,'FAOS_WRITE_DISABLED');
const core={storeId:'QA_STORE',date:'2026-09-20',currency:'EGP',description:'تمويل خزينة اختبار',
 idempotencyKey:'QA-FUNDING-100',lines:[{accountCode:'1120',debit:100},{accountCode:'3100',credit:100}]};
const post=body=>call('/api/accounting/faos/journals',{method:'POST',body});
let first=await post(core);
assert.equal(first.status,201,JSON.stringify(first.data));
assert.equal(first.data.deduplicated,false);
const p1=await faosLedgerBalance(env,{clientId:'QA_CLIENT',storeId:'QA_STORE',from:'2026-09-01',to:'2026-09-30'});
assert.equal(p1.balanceSheet.assets,100);
assert.equal(p1.balanceSheet.liabilities,0);
assert.equal(p1.balanceSheet.equity,100);
assert.equal(p1.balanceSheet.difference,0);
assert.equal(p1.incomeStatement.netProfit,0);
assert.equal(p1.balanceSheet.balanced,true);
let same=await post(core);
assert.equal(same.status,200,JSON.stringify(same.data));
assert.equal(same.data.id,first.data.id);
assert.equal(same.data.deduplicated,true);
let changed=await post({...core,lines:[{accountCode:'1120',debit:200},{accountCode:'3100',credit:200}]});
assert.equal(changed.status,409,'same key changed amount must not silently succeed');
assert.equal(changed.data.code,'FAOS_IDEMPOTENCY_PAYLOAD_MISMATCH');
changed=await post({...core,description:'تمويل آخر'});
assert.equal(changed.status,409);
assert.equal(db.prepare('SELECT COUNT(*) n FROM faos_journals').get().n,1);
assert.equal(db.prepare('SELECT SUM(debit_minor) dr,SUM(credit_minor) cr FROM faos_journal_lines').get().dr,10000);
db.prepare("INSERT INTO faos_periods(client_id,store_id,period_month,status) VALUES(?,?,?,'closed')").run('QA_CLIENT','QA_STORE','2026-09');
same=await post(core);
assert.equal(same.status,200,'identical retry should succeed after period closes');
const blocked=await post({...core,idempotencyKey:'QA-NEW-FUND-02'});
assert.equal(blocked.status,409);
assert.equal(blocked.data.code,'FAOS_PERIOD_CLOSED');
let reversal=await call('/api/accounting/faos/reverse',{
 method:'POST',body:{storeId:'QA_STORE',journalId:first.data.id,date:'2026-10-18'}
});
assert.equal(reversal.status,201,JSON.stringify(reversal.data));
const reversed=await call('/api/accounting/faos/reverse',{
 method:'POST',body:{storeId:'QA_STORE',journalId:first.data.id,date:'2026-10-18'}
});
assert.equal(reversed.status,200,'second reversal must be idempotent');
assert.equal(reversed.data.id,reversal.data.id);
assert.equal(db.prepare('SELECT COUNT(*) n FROM faos_journals').get().n,2);
const total=db.prepare('SELECT SUM(debit_minor) debit,SUM(credit_minor) credit FROM faos_journal_lines').get();
assert.equal(total.debit,total.credit);
const net=db.prepare('SELECT account_code,SUM(debit_minor-credit_minor) net FROM faos_journal_lines GROUP BY account_code ORDER BY account_code').all();
assert.ok(net.every(x=>x.net===0),'reversal must neutralize balance');
const finalBalance=await faosLedgerBalance(env,{clientId:'QA_CLIENT',storeId:'QA_STORE',from:'2026-10-01',to:'2026-10-31'});
assert.equal(finalBalance.balanceSheet.assets,0);
assert.equal(finalBalance.balanceSheet.equity,0);
assert.equal(finalBalance.balanceSheet.difference,0);
assert.equal(finalBalance.balanceSheet.balanced,true);
const bad=await post({...core,idempotencyKey:'QA-BAD-JOURNAL',date:'2026-10-18',lines:[{accountCode:'1120',debit:3},{accountCode:'3100',credit:4}]});
assert.equal(bad.status,400,'unbalanced journal must be rejected');
const cross=await post({...core,clientId:'SOMEONE_ELSE',date:'2026-10-18',idempotencyKey:'QA-SPOOF-KEY'});
assert.equal(cross.status,403,'cross-tenant blocked');
assert.equal(db.prepare('SELECT COUNT(*) n FROM faos_journals').get().n,2);
console.log('PASS FAOS in-memory D1 API: posts + duplicate replay + changed-payload rejection + close guard + idempotent reversal + tenant isolation.');
