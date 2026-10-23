import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [adminUi,command,subs,index,control,billing,parity]=await Promise.all([
  read('public/v2/modules-v22.js'),
  read('public/v2/modules-v74-admin-client-command-center.js'),
  read('public/v2/modules-v127-subscriptions.js'),
  read('public/v2/index.html'),
  read('src/admin-control.js'),
  read('src/subscription-billing.js'),
  read('src/production-preview-parity.js')
]);
for(const [name,s] of [['admin module',adminUi],['command center',command],['subscriptions',subs]])assert.doesNotThrow(()=>new Function(s),name+' syntax');
const mapMatch=adminUi.match(/const MODULE_LABELS=\{([^}]+)\};/);
assert.ok(mapMatch,'admin module needs display-only module label map');
const labels=vm.runInNewContext('({'+mapMatch[1]+'})');
assert.equal(labels['store-access'],'صلاحيات الفروع');
assert.equal(labels['supplier-finance'],'حسابات الموردين');
assert.equal(labels['ad-studio'],'AI Ad Studio');
assert.equal(labels['accounting'],'الحسابات');
assert.match(adminUi,/\$\{esc\(MODULE_LABELS\[k\]\|\|k\)\}/,'user sees local language names');
assert.match(adminUi,/data-mod="\$\{esc\(k\)\}"/,'saved entitlement keys must not change');
assert.match(adminUi,/data-fee="\$\{esc\(k\)\}"/,'fees must still use canonical keys');
assert.match(adminUi,/changes\[k\]=\{enabled:ch.checked,feeDelta:Number\(fee\?\.value\)\|\|0\}/,'save payload unchanged');
assert.doesNotMatch(adminUi,/لا توجد مشاكل حرجة مرصودة/,'diagnostic must not claim a system-wide clean bill');
assert.match(index,/modules-v22\.js\?v=22\.1/,'cache version must load updated Arabic labels');
assert.match(command,/نطاقه مختلف عن سجلات الاشتراكات/);
assert.match(command,/حساب في نطاق التشغيل/);
assert.match(subs,/نطاق الاشتراكات/);
assert.match(subs,/500 حساب كحد أقصى/);
assert.match(control,/UNION SELECT client_id FROM stores UNION SELECT client_id FROM orders/,'operational admin client population');
assert.match(billing,/UNION SELECT client_id FROM wallet_accounts/);
assert.match(billing,/UNION SELECT client_id FROM subscriptions/,'subscription population includes different sources');
assert.match(parity,/typeof identity\.uid!=='string'\|\|!identity\.uid\.trim\(\)/,'parity must require an authenticated admin id');
console.log('Admin audit UI PASS: Arabic entitlement labels preserve stored keys, distinct account-count scopes disclosed, parity identity guard.');
