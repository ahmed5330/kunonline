/* Node 22 SQLite-only preservation tests. No Cloudflare API, token or user data.
 * Main 0099 migration here is a verbatim fixture from
 * main@45414bb:migrations/0099_revoked_sessions.sql (non-executable in deploy CI).
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {
  LEGACY_TO_CANONICAL_COPY_SQL,
  VERIFY_NO_MISSING_OR_SHORTENED_REVOCATIONS_SQL,
  assessOfflineCopyEligibility
} from './session-revocation-preservation-plan.mjs';

const main0099=`-- Only SHA-256 fingerprints are retained; no raw tokens or credentials.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expiry ON revoked_sessions(expires_at);`;
const canonicalSql=await readFile(new URL('../migrations/2026-10-23-session-revocation.sql',import.meta.url),'utf8');
const digest=label=>createHash('sha256').update('fake-fixture-only-'+label).digest('hex');
const one=hash=>db.prepare('SELECT expires_at,revoked_at FROM revoked_session_tokens WHERE token_hash=?').get(hash);
const count=db=>db.prepare(VERIFY_NO_MISSING_OR_SHORTENED_REVOCATIONS_SQL).get().missing_or_shortened;
const make=()=>{const db=new DatabaseSync(':memory:');db.exec(main0099);db.exec(canonicalSql);return db;};
const readiness=({legacy=true,canonical=true,malformed=false}={})=>
  assessOfflineCopyEligibility({environment:'synthetic',tables:{
    revoked_sessions:{exists:legacy,columnsCompatible:legacy&&!malformed},
    revoked_session_tokens:{exists:canonical,columnsCompatible:canonical}
  }});
assert.equal(readiness().eligibleForCopySimulation,true);
assert.equal(readiness().releaseAuthorized,false);
assert.equal(readiness().trafficQuiescenceVerified,false);
assert.equal(readiness({legacy:false}).eligibleForCopySimulation,false);
assert.equal(readiness({canonical:false}).eligibleForCopySimulation,false);
assert.deepEqual(readiness({malformed:true}).blockers,['LEGACY_SCHEMA_MISMATCH']);
assert.equal(readiness({malformed:true}).proposedSql,null);
assert.doesNotMatch(LEGACY_TO_CANONICAL_COPY_SQL,/\b(?:DROP|DELETE|REPLACE\s+INTO|TRUNCATE|ATTACH)\b/i);
assert.match(VERIFY_NO_MISSING_OR_SHORTENED_REVOCATIONS_SQL,/COUNT\(\*\) AS missing_or_shortened/);
assert.doesNotMatch(VERIFY_NO_MISSING_OR_SHORTENED_REVOCATIONS_SQL,/SELECT\s+(?:token_hash|legacy\.token_hash)/i);

const db=make();
try {
  const now=Math.floor(Date.now()/1000);
  const a=digest('legacy-A'),b=digest('legacy-B'),c=digest('canonical-C');
  db.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(a,now+3600);
  db.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(b,now+7200);
  db.prepare('INSERT INTO revoked_session_tokens VALUES (?,?,?)').run(a,now+60,'2026-10-22T00:00:00.000Z');
  db.prepare('INSERT INTO revoked_session_tokens VALUES (?,?,?)').run(c,now+10000,'2026-10-22T00:00:00.000Z');
  assert.equal(count(db),2,'Two legacy fingerprints are not fully represented in canonical before copy');
  db.exec('BEGIN IMMEDIATE');
  db.exec(LEGACY_TO_CANONICAL_COPY_SQL);
  assert.equal(count(db),0,'Copy must include all SHA-256 fingerprints with unshortened expiry');
  assert.equal(one(a).expires_at,now+3600,'Collision must retain longest active expiry');
  assert.equal(one(a).revoked_at,'2026-10-22T00:00:00.000Z',
    'Collision must not rewrite established revocation timestamp');
  assert.equal(one(b).expires_at,now+7200,'Legacy-only fingerprint copied');
  assert.equal(one(b).revoked_at,'1970-01-01T00:00:00.000Z',
    'Legacy has no timestamp; sentinel marks unknown rather than fabricating a revocation time');
  assert.equal(one(c).expires_at,now+10000,'Canonical-only fingerprint survives');
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revoked_sessions').get().n,2,
    'Source table must never be removed, emptied, or renamed');
  db.exec(LEGACY_TO_CANONICAL_COPY_SQL);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revoked_session_tokens').get().n,3,
    'Repeated copy must be idempotent');
  assert.equal(count(db),0);

  // Simulate a logout committed by a LEGACY Worker while old code is still
  // serving requests. A second copy is necessary after traffic quiescence:
  // an uncoordinated one-time copy before deploying the PR Worker is unsafe.
  const d=digest('legacy-during-cutover');
  db.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(d,now+8000);
  assert.equal(count(db),1,'Demonstrate actual race: canonical lacks newer legacy revocation');
  assert.equal(one(d),undefined);
  db.exec('BEGIN IMMEDIATE'); db.exec(LEGACY_TO_CANONICAL_COPY_SQL);
  assert.equal(count(db),0); db.exec('COMMIT');

  const e=digest('rolled-back-record');
  db.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(e,now+12000);
  db.exec('BEGIN IMMEDIATE');
  db.exec(LEGACY_TO_CANONICAL_COPY_SQL);
  assert.equal(count(db),0);
  db.exec('ROLLBACK');
  assert.equal(count(db),1,'Transaction rollback must restore pre-copy state');
  assert.equal(one(e),undefined);
  db.exec('BEGIN IMMEDIATE'); db.exec(LEGACY_TO_CANONICAL_COPY_SQL);
  assert.equal(count(db),0); db.exec('COMMIT');

  const oldCount=db.prepare('SELECT COUNT(*) AS n FROM revoked_sessions').get().n;
  assert.equal(oldCount,4,'No legacy revocation rows are lost even with retries');
}finally{db.close();}

const noLegacy=new DatabaseSync(':memory:');
try {
  noLegacy.exec(canonicalSql);
  assert.throws(()=>noLegacy.exec(LEGACY_TO_CANONICAL_COPY_SQL),/no such table: revoked_sessions/,
    'Missing source table requires explicit branch review, not a silent migration');
}finally{noLegacy.close();}
const noCanonical=new DatabaseSync(':memory:');
try{
  noCanonical.exec(main0099);
  assert.throws(()=>noCanonical.exec(LEGACY_TO_CANONICAL_COPY_SQL),/no such table: revoked_session_tokens/,
    'Never copy without the canonical schema successfully installed');
}finally{noCanonical.close();}
console.log('Synthetic D1 SQLite preservation PASS: longest expiry, canonical-only records, idempotency, rollback, legacy cutover race detected, no table deletion; NO remote writes.');
