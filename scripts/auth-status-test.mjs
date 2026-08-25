import assert from 'node:assert/strict';
import commerceV26 from '../src/index-commerce-v26.js';

class FakeStatement {
  constructor(sql) { this.sql = sql; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (/SELECT COUNT\(\*\) AS n FROM users/i.test(this.sql)) return { n: 1 };
    if (/SELECT \* FROM users WHERE id = \?/i.test(this.sql)) return { id: 'qa-admin', email: 'qa@example.test', name: 'QA Admin', role: 'admin', client_id: null, status: 'active' };
    return null;
  }
  async all() {
    if (/cod_reconciliation_items/i.test(this.sql)) return { results: [{ id: 'QA-DELIVERED-1', total: 650, discount_amount: 0, refund_amount: 0, state: 'signed' }] };
    return { results: [] };
  }
  async run() { return { meta: { changes: 0 } }; }
}

const env = {
  APP_ENV: 'preview',
  SESSION_SECRET: 'qa-session-secret',
  INTEGRATION_ENCRYPTION_KEY: 'qa-integration-key',
  DB: {
    prepare(sql) { return new FakeStatement(sql); },
    async batch() { return []; }
  },
  ASSETS: {
    async fetch() { return new Response('Not found', { status: 404 }); }
  }
};

const context = { waitUntil() {} };
const base = 'https://preview.example.test';
async function adminCookie() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', email: 'qa@example.test', uid: 'qa-admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('hex');
  return `ko_session=${payload}.${signature}`;
}

const me = await commerceV26.fetch(new Request(`${base}/api/me`), env, context);
assert.equal(me.status, 200, 'Login bootstrap must keep /api/me readable before authentication');
assert.deepEqual(await me.json(), { role: null, needsSetup: false });

const protectedRoutes = [
  '/api/release/readiness',
  '/api/stores',
  '/api/onboarding/status',
  '/api/integrations/readiness',
  '/api/approvals',
  '/api/audit-log'
];

for (const path of protectedRoutes) {
  const response = await commerceV26.fetch(new Request(`${base}${path}`), env, context);
  const body = await response.text();
  assert.equal(response.status, 401, `${path} must return HTTP 401 without a session; got ${response.status}: ${body}`);
  assert.match(body, /محتاج تسجّل دخول/);
  assert.doesNotMatch(body, /SESSION_SECRET/i);
}

const codResponse = await commerceV26.fetch(new Request(`${base}/api/cod-reconciliation/candidates?clientId=QA-CLIENT`, { headers: { Cookie: await adminCookie() } }), env, context);
assert.equal(codResponse.status, 200, `COD candidates must be reachable from the active entrypoint; got ${codResponse.status}: ${await codResponse.clone().text()}`);
assert.deepEqual(await codResponse.json(), [{ id: 'QA-DELIVERED-1', total: 650, discount_amount: 0, refund_amount: 0, state: 'signed', expectedAmount: 650 }]);

console.log('Authentication status contract passed: protected APIs reject anonymous requests and COD routes remain reachable.');
