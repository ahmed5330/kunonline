import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAccountingEntry, deleteAccountingEntry, listAccountingEntries, accountingOverview } from '../src/accounting.js';

const [native, ui, dates, routes] = await Promise.all([
  readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/NativeSectionsApi.kt', import.meta.url), 'utf8'),
  readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/KunSystemSections.kt', import.meta.url), 'utf8'),
  readFile(new URL('../android/app/src/main/java/com/kunonline/callerid/AccountingDateFilter.kt', import.meta.url), 'utf8'),
  readFile(new URL('../src/index-commerce-v31.js', import.meta.url), 'utf8')
]);
for (const marker of ['from=${enc(fromDate)}&to=${enc(toDate)}', '"/api/accounting/entries?limit=150&$dates"', '.put("clientId", selected.clientId)', 'async(Dispatchers.IO)']) {
  assert.ok(native.includes(marker), `Android accounting API bridge missing: ${marker}`);
}
for (const marker of ['AccountingDateFilter.lastDays(30)', 'NativeSectionsApi.accounting(context, fromDate, toDate)', 'data["entries"]?.ok == false', 'لا توجد حركات خلال الفترة المحددة']) {
  assert.ok(ui.includes(marker), `Android accounting screen missing: ${marker}`);
}
assert.ok(dates.includes('ZoneId.of("Africa/Cairo")'));
assert.ok(routes.includes("body.clientId||body.client_id||url.searchParams.get('clientId')"));

const stores = new Map([['S1', {clientId:'C1',name:'QA Store 1',currency:'EGP'}],['S2',{clientId:'C1',name:'QA Store 2',currency:'EGP'}]]);
let transactions = [];
const fakeDB = {
  async batch(statements) {
    const before = structuredClone(transactions);
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      transactions = before;
      throw error;
    }
  },
  prepare(sql) {
    return {
      bind(...args) {
        const clientId = args[0];
        const scoped = / AND store_id=\?/.test(sql);
        const selection = (withLimit=false) => {
          const storeId = scoped ? args[1] : null;
          const start = args[scoped?2:1], end = args[scoped?3:2];
          return transactions.filter(x => x.clientId===clientId && (!storeId || x.storeId===storeId) && x.date>=start && x.date<=end).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,withLimit?args.at(-1):Infinity);
        };
        return {
          async first() {
            if(sql.startsWith('SELECT currency FROM stores')) {
              const s=stores.get(args[0]);return s?.clientId===args[1]?{currency:s.currency}:null;
            }
            if(sql.startsWith('SELECT name,currency,management_fee_pct FROM stores')) {
              const s=stores.get(args[0]);return s?.clientId===args[1]?{name:s.name,currency:s.currency,management_fee_pct:0}:null;
            }
            if(sql.includes('manual_income') && sql.includes('FROM transactions')) {
              const tx=selection();
              return {manual_income:tx.filter(x=>x.type==='income').reduce((a,x)=>a+x.amount,0),manual_expenses:tx.filter(x=>x.type==='expense').reduce((a,x)=>a+x.amount,0),entries:tx.length};
            }
            if(sql.includes('FROM order_management_fees f')) return {active_amount:0,reversed_amount:0,active_orders:0,reversed_orders:0};
            if(sql.includes('delivered_revenue')) return {delivered_revenue:0,shipped_orders:0};
            if(sql.includes('collected_revenue')) return {collected_revenue:0,collected_orders:0,estimated_amount_orders:0};
            if(sql.startsWith('SELECT id FROM transactions')) return transactions.find(x=>x.id===args[0]&&x.clientId===args[1]&&x.storeId===args[2])||null;
            throw new Error('Unsupported fake first SQL: '+sql.slice(0,130));
          },
          async all() {
            if(sql.includes('FROM transactions WHERE')) return {results:selection(true).map(x=>({
              id:x.id,type:x.type,date:x.date,category:x.category,amount:x.amount,currency:x.currency,method:x.method,
              clientId:x.clientId,storeId:x.storeId,note:x.note,counterparty:x.counterparty,taxAmount:0,metadataJson:'{}'
            }))};
            throw new Error('Unsupported fake all SQL: '+sql.slice(0,130));
          },
          async run() {
            if(sql.startsWith('INSERT INTO audit_log')) return {success:true};
            if(sql.startsWith('INSERT INTO transactions')) {
              transactions.push({id:args[0],type:args[1],date:args[2],category:args[3],amount:args[4],currency:args[5],method:args[6],clientId:args[7],storeId:args[8],note:args[9],counterparty:args[13]});
              return {success:true};
            }
            if(sql.startsWith('DELETE FROM transactions')) {
              transactions=transactions.filter(x=>!(x.id===args[0]&&x.clientId===args[1]&&x.storeId===args[2]));
              return {success:true};
            }
            throw new Error('Unsupported fake run SQL: '+sql.slice(0,130));
          }
        };
      }
    };
  }
};
const env={DB:fakeDB};
async function add(storeId,type,amount,date) {
  const body={type,amount,date,category:'QA',method:'bank',note:'بيانات اختبار فقط'};
  return createAccountingEntry(env,{clientId:'C1',storeId,body,actor:{email:'qa@example.test'}});
}
const income=await add('S1','income',300,'2026-09-25');
const expense=await add('S1','expense',100,'2026-10-22');
await add('S2','expense',50,'2026-10-22');
assert.ok(income.ok&&expense.ok);
const range={clientId:'C1',storeId:'S1',from:'2026-09-24',to:'2026-10-23'};
assert.equal((await listAccountingEntries(env,range)).length,2,'Historical transactions must appear in 30-day filter');
const overview=await accountingOverview(env,range);
assert.equal(overview.manualIncome,300);
assert.equal(overview.manualExpenses,100);
assert.equal(overview.netCash,200);
assert.equal(overview.entries,2);
assert.equal((await listAccountingEntries(env,{...range,from:'2026-10-23'})).length,0,'Today filter must not include yesterday');
assert.equal((await listAccountingEntries(env,{...range,storeId:null})).length,3,'All-store view must aggregate client stores');
await assert.rejects(add('S1','expense',0,'2026-10-22'),e=>e.status===400&&e.code==='ACCOUNTING_AMOUNT_INVALID');
await deleteAccountingEntry(env,{clientId:'C1',storeId:'S1',id:expense.id,actor:{email:'qa@example.test'}});
assert.equal((await accountingOverview(env,range)).netCash,300);
assert.equal((await listAccountingEntries(env,{...range,storeId:'S2'})).length,1,'Delete must not touch another store');
console.log('PASS: Android accounting API contract, historical range, income/expense/net cash, tenant store isolation, invalid amount, deletion');
