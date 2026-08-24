import assert from 'node:assert/strict';
import commerceV26 from '../src/index-commerce-v26.js';

class FakeStatement {
  constructor(sql) { this.sql = sql; }
  bind() { return this; }
  async first() {
    if (/SELECT COUNT\(\*\) AS n FROM users/i.test(this.sql)) return { n: 1 };
    return null;
  }
  async all() { return { results: [] }; }
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

console.log('Authentication status contract passed: protected APIs reject anonymous requests with HTTP 401.');
