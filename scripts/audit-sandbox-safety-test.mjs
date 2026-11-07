import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyAuditSandboxConfig} from './verify-audit-sandbox-config.mjs';
import worker from '../src/audit-sandbox-probe.js';

const read = path => readFile(new URL('../' + path,import.meta.url),'utf8');
const [template,production,preview,workerCode,migration] = await Promise.all([
  read('wrangler.audit-sandbox.example.toml'),
  read('wrangler.production.toml'),
  read('wrangler.preview.toml'),
  read('src/audit-sandbox-probe.js'),
  read('sandbox/migrations/0001_audit_sandbox_marker.sql')
]);
const id = '01234567-89ab-4cde-8123-456789abcde0';
const valid = template
  .replace('REPLACE_WITH_UNIQUE_AUDIT_SANDBOX_WORKER','kunonline-audit-sandbox-qa-test')
  .replace('REPLACE_WITH_NEW_AUDIT_SANDBOX_D1','kunonline-audit-sandbox-qa-db')
  .replace('REPLACE_WITH_NEW_D1_UUID',id);
const verify = text => verifyAuditSandboxConfig(text,production,preview);
assert.throws(()=>verify(template),/UNSAFE_AUDIT_SANDBOX/, 'template must be intentionally non-deployable');
const result=verify(valid);
assert.equal(result.ok,true);
assert.equal(result.uniqueAgainstConfiguredLiveIds,true);
assert.equal(result.isolatedRuntimeVerified,false);
assert.equal(result.readyToDeploy,false);
assert.equal(result.knownLiveD1Count,2);

const changes=[
  ['production D1 id',valid.replace(id,'c426601d-182f-486e-a5c1-bb1bca0ecb0b')],
  ['preview D1 id',valid.replace(id,'31cd5cdf-fc01-42d7-ba1e-571f3dd58495')],
  ['production database name',valid.replace('kunonline-audit-sandbox-qa-db','kunonline')],
  ['preview database name',valid.replace('kunonline-audit-sandbox-qa-db','kunonline-preview')],
  ['prod Worker name',valid.replace('kunonline-audit-sandbox-qa-test','kunonline')],
  ['preview Worker name',valid.replace('kunonline-audit-sandbox-qa-test','kunonline-preview')],
  ['public workers.dev route',valid.replace('workers_dev = false','workers_dev = true')],
  ['commerce Worker',valid.replace('src/audit-sandbox-probe.js','src/index-commerce-v38.js')],
  ['commerce migrations',valid.replace('sandbox/migrations','migrations')],
  ['unexpected Cron',valid.replace('crons = []','crons = ["*/5 * * * *"]')],
  ['missing Cron table',valid.replace('[triggers]\ncrons = []','')],
  ['extra live binding',valid+'\n[[d1_databases]]\nbinding = "PREVIEW_DB"\n'],
  ['unexpected service binding',valid+'\n[[services]]\nbinding = "PREVIEW_APP"\n'],
  ['unexpected queue binding',valid+'\n[[queues.producers]]\nbinding = "ALERTS"\n'],
  ['unexpected assets',valid+'\n[assets]\ndirectory = "./public"\n'],
  ['zone route',valid+'\nroute = "app.kun-online.com/*"\n'],
  ['inlined secret',valid+'\nSESSION_SECRET = "live-key"\n'],
  ['sandbox environment removed',valid.replace('APP_ENV = "audit_sandbox"','APP_ENV = "production"')],
  ['offline marker removed',valid.replace('SANDBOX_EGRESS_OFFLINE = "true"','SANDBOX_EGRESS_OFFLINE = "false"')],
  ['duplicate key',valid.replace('workers_dev = false','workers_dev = false\nworkers_dev = false')],
  ['placeholder database id',valid.replace(id,'REPLACE_WITH_NEW_D1_UUID')],
  ['malformed UUID',valid.replace(id,'00000000-0000-0000-0000-000000000000')],
  ['malformed TOML value',valid.replace('crons = []','crons = ["abc"]')],
  ['unexpected env secret',valid.replace('SANDBOX_EGRESS_OFFLINE = "true"','SANDBOX_EGRESS_OFFLINE = "true"\nTOKEN_ENC_KEY = "secret"')]
];
for (const [name,candidate] of changes)
  assert.throws(()=>verify(candidate),/UNSAFE_AUDIT_SANDBOX/,name);
assert(!/^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/im.test(migration),
  'migration must only create a synthetic marker table');
assert(!workerCode.includes('import '),'probe must not import commerce code');
assert(!/\bawait\s+(?:globalThis\.)?fetch\s*\(/.test(workerCode),'probe cannot send outbound requests');
assert(!/\b(?:\.run|\.batch|\.exec)\s*\(/.test(workerCode),'probe must not mutate D1');
assert(workerCode.includes("FROM sqlite_master WHERE type='table'"), 'probe reads only schema metadata');

const secret='x'.repeat(40);
const makeReq=(url,method='GET',headers={})=>new Request('http://localhost'+url,{method,headers});
let env={APP_ENV:'audit_sandbox',SANDBOX_EGRESS_OFFLINE:'true',SANDBOX_QA_SECRET:secret};
let response=await worker.fetch(makeReq('/healthz'),{...env,APP_ENV:'production'});
assert.equal(response.status,503);
response=await worker.fetch(makeReq('/healthz'),env);
assert.equal(response.status,200);
assert.equal((await response.json()).runtimeBindingsVerified,false);
response=await worker.fetch(makeReq('/qa/schema-proof'),env);
assert.equal(response.status,403);
response=await worker.fetch(makeReq('/qa/schema-proof','GET',{'X-Sandbox-QA-Key': 'not-secret'}),env);
assert.equal(response.status,403);
response=await worker.fetch(makeReq('/qa/schema-proof','POST',{'X-Sandbox-QA-Key':secret}),env);
assert.equal(response.status,405);
response=await worker.fetch(makeReq('/qa/schema-proof','GET',{'X-Sandbox-QA-Key':secret}),env);
assert.equal(response.status,503);
let selects=0;
env={...env,DB:{prepare(sql){
  assert.equal(sql,"SELECT name FROM sqlite_master WHERE type='table' AND name='qa_sandbox_marker' LIMIT 1");
  selects++;
  return {first:async()=>({name:'qa_sandbox_marker'})};
}}};
response=await worker.fetch(makeReq('/qa/schema-proof','GET',{'X-Sandbox-QA-Key':secret}),env);
assert.equal(response.status,200);
const payload=await response.json();
assert.equal(payload.syntheticMarkerPresent,true);
assert.equal(payload.runtimeBindingsVerified,false);
assert.equal(selects,1);
console.log('PASS: static audit sandbox isolation + 24 fail-closed cases + auth-only read-only runtime probe; no Cloudflare mutations.');
