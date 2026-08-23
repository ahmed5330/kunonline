import assert from 'node:assert/strict';
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
console.log('Access-control tests passed');
