/* No real auth tokens, no Wrangler/D1/network calls. Simulate the competing 0098 schema. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyRevocationContract} from './session-revocation-schema-contract.mjs';

const source=async relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');
const base={
  moduleSource:await source('src/session-revocation.js'),
  sessionAuthSource:await source('src/index.js'),
  productionWorkflow:await source('.github/workflows/production.yml'),
  productionEntry:await source('src/index-production-mobile-update.js'),
  productionConfig:await source('wrangler.production.toml'),
  previewConfig:await source('wrangler.preview.toml'),
  migrations:[{path:'migrations/2026-10-23-session-revocation.sql',content:await source('migrations/2026-10-23-session-revocation.sql')}]
};
const valid=verifyRevocationContract(base);
assert.equal(valid.ok,true);
assert.equal(valid.canonicalTable,'revoked_session_tokens');
assert.equal(valid.effectiveAuthBackend,'PREVIEW_APP / kunonline-preview');
assert.equal(valid.remoteSchemaVerified,false,'Static tests cannot certify live D1 schemas');
assert.equal(valid.previewCodeDeployed,false,'Static tests cannot certify Preview Worker deployment');
assert.equal(valid.liveQaSessionReplayVerified,false,'Synthetic tests are not live QA');
const otherTable='CREATE TABLE IF NOT EXISTS revoked_sessions (fingerprint TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);';
const mismatches=[
  ['local 0098 migration paired with PR #209 code',{migrations:[{path:'migrations/0098_revoked_sessions.sql',content:otherTable}]}],
  ['both competing migrations',{migrations:[...base.migrations,{path:'migrations/0098_revoked_sessions.sql',content:otherTable}]}],
  ['code switched without matching migration',{moduleSource:base.moduleSource.replaceAll('revoked_session_tokens','revoked_sessions')}],
  ['empty migrations',{migrations:[]}],
  ['stale Preview deployment/routing',{productionEntry:base.productionEntry.replace('AUTH_PATHS.has(new URL(request.url).pathname)','false')}],
  ['Preview binding removed',{productionConfig:base.productionConfig.replace('binding = "PREVIEW_APP"','binding = "OTHER_SERVICE"')}],
  ['Production preflight selects obsolete schema',{productionWorkflow:base.productionWorkflow.replaceAll('FROM revoked_session_tokens LIMIT 0;','FROM revoked_sessions LIMIT 0;')}],
  ['missing per-login nonce',{sessionAuthSource:base.sessionAuthSource.replace('jti: crypto.randomUUID()','jti: ""')}],
  ['authentication skips revocation',{sessionAuthSource:base.sessionAuthSource.replace('await isSessionRevoked(env, token)','false')}],
  ['logout hashes a different token',{sessionAuthSource:base.sessionAuthSource.replace('revokeSession(env,sessionTokenFromRequest(request)','revokeSession(env,"other-token"')}]
];
for(const [label,delta] of mismatches){
  assert.throws(()=>verifyRevocationContract({...base,...delta}),/SESSION_REVOCATION_SCHEMA_CONFLICT/,label+' must stop release');
}
console.log('SEC-02 revocation migration mismatch PASS: legacy PR table, local 0098 proposal, parallel schemas, Preview auth routing and production D1 preflight require reconciliation. Offline only.');
