/* Synthetic in-memory Node SQLite proof; no live Cloudflare/D1, no auth cookies.
 * Exercises the deliberately UNWIRED D1 dual-read/atomic-dual-write module.
 */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {sessionTokenHash} from '../src/session-revocation.js';
import {isRevokedAcrossBoth,revokeAcrossBoth} from '../src/session-revocation-compatibility-bridge.js';

const sqlNew=await readFile(new URL('../migrations/2026-10-23-session-revocation.sql',import.meta.url),'utf8');
const sqlOld=`CREATE TABLE revoked_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`;
const newDb=({old=true,canonical=true}={})=>{
  const db=new DatabaseSync(':memory:');
  if(old)db.exec(sqlOld);
  if(canonical)db.exec(sqlNew);
  return db;
};
const adapter=(db,{failSecond=false,returnFailure=false}={})=>({
  DB:{
    prepare(sql){
      return {bind(...args){return {
        sql,args,
        async first(){return db.prepare(sql).get(...args)||null;}
      };}};
    },
    async batch(statements){
      db.exec('BEGIN IMMEDIATE');
      try {
        const results=[];
        for(let i=0;i<statements.length;i++){
          if(failSecond&&i===1)throw Error('synthetic second write error');
          const s=statements[i];
          assert.ok(Array.isArray(s.args),'Prepared/bound statements required');
          const meta=db.prepare(s.sql).run(...s.args);
          results.push({success:true,meta:{changes:meta.changes}});
        }
        if(returnFailure){db.exec('ROLLBACK');return [{success:true},{success:false}];}
        db.exec('COMMIT');return results;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }
  }
});
const fixedTime=Math.floor(Date.now()/1000);
const expires=fixedTime+3600;
const token=name=>'SYNTHETIC_TEST_TOKEN_ONLY_'+name;
const q=async(db,table,name)=>db.prepare('SELECT expires_at FROM '+table+' WHERE token_hash=?').get(await sessionTokenHash(token(name)));
const addOld=async(db,name,exp=expires)=>{
  db.prepare('INSERT INTO revoked_sessions (token_hash,expires_at) VALUES (?,?)')
    .run(await sessionTokenHash(token(name)),exp);
};
const addNew=async(db,name,exp=expires)=>{
  db.prepare('INSERT INTO revoked_session_tokens (token_hash,expires_at,revoked_at) VALUES (?,?,?)')
    .run(await sessionTokenHash(token(name)),exp,'2026-10-20T00:00:00.000Z');
};
let db=newDb();
try{
  const env=adapter(db);
  assert.equal(await isRevokedAcrossBoth(env,token('fresh')),false);
  await addOld(db,'old-only');
  assert.equal(await isRevokedAcrossBoth(env,token('old-only')),true,'Old Worker logout must still block new Worker auth');
  await addNew(db,'new-only');
  assert.equal(await isRevokedAcrossBoth(env,token('new-only')),true,'New Worker logout must still block auth');
  assert.equal(await q(db,'revoked_sessions','new-only'),undefined,'Only new canonical registry has that synthetic hash');

  const result=await revokeAcrossBoth(env,token('mixed-version'),expires);
  assert.deepEqual(result,{ok:true});
  assert.equal((await q(db,'revoked_sessions','mixed-version')).expires_at,expires);
  assert.equal((await q(db,'revoked_session_tokens','mixed-version')).expires_at,expires);
  const storedHashes=db.prepare('SELECT token_hash FROM revoked_sessions').all().map(r=>r.token_hash);
  assert.ok(storedHashes.every(x=>/^[0-9a-f]{64}$/.test(x)),
    'D1 contains only SHA-256 fingerprints, never test bearer tokens');
  assert.ok(storedHashes.every(x=>!x.includes('SYNTHETIC_TEST_TOKEN_ONLY_')));
  assert.equal(await isRevokedAcrossBoth(env,token('mixed-version')),true);
  // Repeating logout with shorter expiration must NOT shorten a known ban.
  await revokeAcrossBoth(env,token('mixed-version'),expires-300);
  assert.equal((await q(db,'revoked_sessions','mixed-version')).expires_at,expires);
  assert.equal((await q(db,'revoked_session_tokens','mixed-version')).expires_at,expires);
  await revokeAcrossBoth(env,token('mixed-version'),expires+300);
  assert.equal((await q(db,'revoked_sessions','mixed-version')).expires_at,expires+300);
  assert.equal((await q(db,'revoked_session_tokens','mixed-version')).expires_at,expires+300);

  // Model old Worker logout after a one-time copy. New Worker dual read still sees it.
  await addOld(db,'late-legacy');
  assert.equal(await isRevokedAcrossBoth(env,token('late-legacy')),true);
  // New Worker dual write while legacy Worker still reads only old registry.
  await revokeAcrossBoth(env,token('late-canonical'),expires);
  assert.ok(await q(db,'revoked_sessions','late-canonical'));
  assert.ok(await q(db,'revoked_session_tokens','late-canonical'));

  await assert.rejects(revokeAcrossBoth(adapter(db,{failSecond:true}),token('atomic-failure'),expires),/synthetic second write error/);
  assert.equal(await q(db,'revoked_sessions','atomic-failure'),undefined,'Batch must roll back first write on second failure');
  assert.equal(await q(db,'revoked_session_tokens','atomic-failure'),undefined);
  await assert.rejects(revokeAcrossBoth(adapter(db,{returnFailure:true}),token('failure-return'),expires),/did not confirm both writes/);
  assert.equal(await q(db,'revoked_sessions','failure-return'),undefined);
  await assert.rejects(revokeAcrossBoth({DB:{prepare:env.DB.prepare}},token('no-batch'),expires),/Atomic D1 batch is required/);
  await assert.rejects(revokeAcrossBoth(env,token('bad-exp'),Infinity),/Invalid session expiry/);
  await assert.rejects(isRevokedAcrossBoth(env,''),/Missing session token/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revoked_sessions').get().n,4);
}finally{db.close();}

for(const mode of [{old:true,canonical:false},{old:false,canonical:true}]){
  db=newDb(mode);
  try{
    const env=adapter(db);
    await assert.rejects(isRevokedAcrossBoth(env,token('any')),/(no such table)/,'Both table reads must fail closed');
    await assert.rejects(revokeAcrossBoth(env,token('missing-table'),expires),/(no such table)/,
      'Missing second table must never produce successful logout');
    const table=mode.old?'revoked_sessions':'revoked_session_tokens';
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,'D1 batch must rollback on missing table');
  }finally{db.close();}
}
console.log('Dual revocation sandbox SQLite PASS: dual reads, atomic mirrored writes, no expiry shortening, rolling-version race, rollback, fail closed missing table. No Cloudflare calls.');
