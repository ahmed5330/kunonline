import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {can,effectivePermissions,resolveTenant,requirePermission} from '../src/access-control.js';

const client={role:'client',clientId:'C1'};
assert.equal(resolveTenant(client,null),'C1');
assert.equal(resolveTenant(client,'C1'),'C1');
assert.throws(()=>resolveTenant(client,'C2'),e=>e.status===403&&e.code==='TENANT_ISOLATION');

assert.equal(can({role:'ops'},'procurement','write'),true);
assert.equal(can({role:'ops'},'finance','read'),true);
assert.equal(can({role:'ops'},'finance','write'),false);
assert.equal(can({role:'accountant'},'finance','write'),true);
assert.equal(can({role:'accountant'},'procurement','write'),false);
assert.equal(can({role:'support'},'orders','update'),true);
assert.equal(can({role:'support'},'finance','read'),false);
assert.equal(can({role:'viewer'},'analytics','read'),true);
assert.equal(can({role:'viewer'},'orders','update'),false);

assert.equal(can({role:'custom',perms:['settings']},'procurement','write'),true);
assert.equal(can({role:'custom',perms:['entries']},'automation','write'),true);
assert.equal(can({role:'custom',perms:['finance']},'audit','read'),true);

assert.throws(()=>requirePermission({role:'viewer'},'orders','update'),e=>e.status===403&&e.code==='PERMISSION_DENIED');
assert.ok(effectivePermissions({role:'ops'}).includes('procurement.*'));

const root=new URL('../',import.meta.url);
const [worker,dashboard,nav,index]=await Promise.all([
  readFile(new URL('src/index-commerce-v34.js',root),'utf8'),
  readFile(new URL('public/v2/modules-v33-dashboard.js',root),'utf8'),
  readFile(new URL('public/v2/modules-v51-permission-navigation.js',root),'utf8'),
  readFile(new URL('public/v2/index.html',root),'utf8')
]);
assert.ok(worker.includes("path==='/api/navigation-access'"),'self navigation access endpoint missing');
assert.ok(worker.includes('permissionSnapshot(me)'),'navigation endpoint must use effective backend permissions');
assert.ok(dashboard.includes("margin:{label:'هامش الربح',icon:'◈',value:d=>money(d.finance.netProfit,d.currency)"),'dashboard profit margin must be an absolute net-profit money value');
assert.ok(!dashboard.includes("margin:{label:'هامش الربح',icon:'%',value:d=>pct(d.overview.profitMargin)"),'dashboard profit margin must not render as percentage');
for(const marker of ["dashboard:['analytics.read']","'customer-service':['support.read']","finance:['finance.read']","'ad-studio':['ads.write']","access:['owner']","button.hidden=!ok","stopImmediatePropagation","goFirstAllowed","/api/navigation-access","لا توجد أقسام متاحة لهذا الحساب"]){
  assert.ok(nav.includes(marker),`permission navigation missing ${marker}`);
}
assert.ok(index.includes('/v2/modules-v51-permission-navigation.js?v=51.0'),'permission navigation module not loaded');
assert.ok(index.indexOf('modules-v51-permission-navigation.js')>index.indexOf('modules-v50-stock-batch-variants.js'),'permission navigation must load after feature modules');
console.log('Access-control tests passed');
