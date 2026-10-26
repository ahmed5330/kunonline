import assert from 'node:assert/strict';
import {ACCOUNTS,ACCOUNT_BY_CODE} from '../src/accounting-faos-core.js';
// Active FAOS subset is intentionally drawn from the 156-account reference,
// not the old placeholder chart. Remaining reference accounts require sign-off.
const required=new Map([
  ['1110',['خزنة رئيسية','asset']],
  ['1120',['بنك محلي رئيسي','asset']],
  ['1230',['مستحق لدى شركة الشحن COD','asset']],
  ['1240',['مستحق لدى بوابة دفع','asset']],
  ['1300',['مخزون بضائع للبيع','asset']],
  ['2110',['موردو بضاعة','liability']],
  ['2120',['شركة الشحن — رسوم مستحقة','liability']],
  ['2150',['مبالغ واجبة الرد للعملاء','liability']],
  ['3100',['رأس مال مالك/شركاء','equity']],
  ['4100',['مبيعات منتجات محلية','revenue']],
  ['4110',['إيراد شحن على العميل','revenue']],
  ['4191',['مردودات ومسموحات مبيعات (مقابل)','contra_revenue']],
  ['5100',['تكلفة بضاعة مباعة COGS','expense']],
  ['6100',['إعلانات Meta','expense']],
  ['6110',['شحن التوصيل على التاجر','expense']],
  ['6114',['رسوم تحصيل COD','expense']],
  ['6141',['رسوم كن أونلاين','expense']]
]);
assert.ok(ACCOUNTS.length>=29);
assert.equal(new Set(ACCOUNTS.map(a=>a.code)).size,ACCOUNTS.length,'account codes must be unique');
for(const [code,[name,type]] of required){
  const row=ACCOUNT_BY_CODE.get(code);
  assert.ok(row,'missing reference account '+code);
  assert.equal(row.name,name,code);
  assert.equal(row.type,type,code);
}
for(const row of ACCOUNTS){
  assert.match(row.code,/^\d{4}$/);
  assert.ok(['asset','liability','equity','revenue','contra_revenue','expense'].includes(row.type));
}
assert.equal(ACCOUNT_BY_CODE.get('1230').name,'مستحق لدى شركة الشحن COD');
assert.equal(ACCOUNT_BY_CODE.get('1110').name,'خزنة رئيسية');
console.log('PASS FAOS chart: active posting codes match the approved reference numbering subset and do not collide.');
