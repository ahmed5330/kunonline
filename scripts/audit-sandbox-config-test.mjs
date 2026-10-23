import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyAuditSandboxConfig} from './verify-audit-sandbox-config.mjs';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const [template,production,preview,packageText]=await Promise.all([
  read('wrangler.audit-sandbox.example.toml'),
  read('wrangler.production.toml'),
  read('wrangler.preview.toml'),
  read('package.json')
]);
const check=value=>verifyAuditSandboxConfig(value,production,preview);
assert.throws(()=>check(template),/UNSAFE AUDIT SANDBOX CONFIG/,'Template itself must never be considered deployable');
const safe=template
  .replace('REPLACE_WITH_UNIQUE_AUDIT_WORKER_NAME','kunonline-audit-sandbox-qa')
  .replace('REPLACE_WITH_NEW_AUDIT_D1_NAME','kunonline-audit-db-qa')
  .replace('REPLACE_WITH_NEW_D1_UUID','8b1b87a5-34db-4e29-9634-08220d0a9d91');
const result=check(safe);
assert.equal(result.ok,true);
assert.equal(result.runtimeIsolationVerified,false,'Config preflight cannot prove actual deployed bindings');
assert.equal(result.outboundProvidersVerifiedBlocked,false,'Config preflight cannot prove provider egress isolation');
assert.equal(result.externalBindings,0);
assert.equal(result.scheduledTriggers,0);
const tests=[
  ['production Worker name',safe.replace('kunonline-audit-sandbox-qa','kunonline')],
  ['production D1 name',safe.replace('kunonline-audit-db-qa','kunonline')],
  ['preview D1 name',safe.replace('kunonline-audit-db-qa','kunonline-preview')],
  ['production D1 binding id',safe.replace('8b1b87a5-34db-4e29-9634-08220d0a9d91','c426601d-182f-486e-a5c1-bb1bca0ecb0b')],
  ['preview D1 binding id',safe.replace('8b1b87a5-34db-4e29-9634-08220d0a9d91','31cd5cdf-fc01-42d7-ba1e-571f3dd58495')],
  ['Cron enabled',safe.replace('crons = []','crons = ["*/5 * * * *"]')],
  ['Preview service binding',safe+'\n[[services]]\nbinding="PREVIEW_APP"\nservice="kunonline-preview"\n'],
  ['Preview DB alias',safe.replace('binding = "DB"','binding = "PREVIEW_DB"')],
  ['missing APP_ENV',safe.replace('APP_ENV = "audit_sandbox"','APP_ENV = "production"')],
  ['live hostname route',safe+'\nroute = "app.kun-online.com/*"\n'],
  ['unreviewed Worker entrypoint',safe.replace('main = "src/index-commerce-v38.js"','main = "src/index-production-mobile-update.js"')],
  ['extra D1 binding',safe+'\n[[d1_databases]]\nbinding="BACKUP"\ndatabase_name="some-other"\ndatabase_id="e0faf16e-cc77-4e1c-a829-7a86b53a990a"\n'],
  ['invalid UUID',safe.replace('8b1b87a5-34db-4e29-9634-08220d0a9d91','NOT_AN_ID')],
  ['provider key embedded',safe+'\nTOKEN_ENC_KEY = "should-never-be-in-a-toml"\n']
];
for(const [label,config] of tests)assert.throws(()=>check(config),/UNSAFE AUDIT SANDBOX CONFIG/,label+' must block all stateful tests');
const scripts=JSON.parse(packageText).scripts;
assert.ok(scripts['deploy:preview'].includes('wrangler deploy --config wrangler.preview.toml'));
assert.doesNotMatch(scripts['deploy:preview'],/\|\|\s*true/,'Preview deployment failure must propagate to CI');
console.log('Audit sandbox static safety PASS: nondeployable template, fresh DB resources, 14 unsafe configurations denied, and Preview deploy errors cannot be swallowed. No Cloudflare requests.');
