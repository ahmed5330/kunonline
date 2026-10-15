import assert from 'node:assert/strict';
import {scopeForClient} from '../src/index.js';

const rows = {
  'CLI-NEW': {display_name: 'New Store', status: 'active', plan: 'starter', currency: 'EGP'},
  'CLI-SUSPENDED': {display_name: 'Paused Store', status: 'suspended', plan: 'pro', currency: 'EGP'}
};
let lookups = 0;
const env = {
  DB: {
    prepare(sql) {
      assert.match(sql, /FROM tenant_settings WHERE client_id = \?/);
      return {
        bind(id) {
          lookups++;
          return {first: async () => rows[id] || null};
        }
      };
    }
  }
};
const state = {
  agency: {name: 'Kun Online'},
  clients: [{id: 'CLI-OLD', name: 'Existing Store', metaToken: 'secret'}],
  entries: [{clientId: 'CLI-NEW', adSpend: 100}, {clientId: 'CLI-OLD', adSpend: 200}],
  funding: [{clientId: 'CLI-NEW', amount: 300}, {clientId: 'OTHER', amount: 900}]
};
const orders = [{id: 'O1', clientId: 'CLI-NEW'}, {id: 'O2', clientId: 'CLI-OLD'}];

const existing = await scopeForClient(env, state, orders, 'CLI-OLD');
assert.equal(existing.clients[0].name, 'Existing Store');
assert.equal(existing.clients[0].metaToken, undefined, 'Client credentials must never leak');
assert.equal(existing.clients[0].metaTokenSet, true);
assert.equal(lookups, 0, 'Existing tenant must use the legacy state without extra queries');

const created = await scopeForClient(env, state, orders, 'CLI-NEW');
assert.equal(created.clients[0].id, 'CLI-NEW');
assert.equal(created.clients[0].name, 'New Store');
assert.deepEqual(created.orders.map(o => o.id), ['O1']);
assert.deepEqual(created.entries.map(e => e.clientId), ['CLI-NEW']);
assert.deepEqual(created.funding.map(f => f.clientId), ['CLI-NEW']);
assert.equal(created.clients[0].metaTokenSet, false);

const suspended = await scopeForClient(env, state, orders, 'CLI-SUSPENDED');
assert.equal(suspended.clients[0].status, 'suspended');
assert.equal((await scopeForClient(env, state, orders, 'OTHER')), null,
  'Unknown tenant must not be synthesized or granted access');
console.log('Tenant state fallback passed: new accounts load their own data, existing credentials stay masked, unknown tenant denied.');
