/* SEC-02: production legacy Worker + actual D1 migration SQL in in-memory SQLite.
 * All identities/cookies are synthetic and never logged or persisted to disk.
 * NO cloud access or real account data. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
import {sessionTokenHash} from '../src/session-revocation.js';

const sql=await readFile(new URL('../migrations/2026-10-23-session-revocation.sql',import.meta.url),'utf8');
const database=new DatabaseSync(':memory:');
database.exec(sql);
database.exec("CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,role TEXT,status TEXT,client_id TEXT,name TEXT)");
database.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('qa-user','qa@example.invalid','admin','active',null,'QA only');
let mode='ok';
const env={
  SESSION_SECRET:'SYNTHETIC_HMAC_KEY_NOT_A_REAL_SECRET',
  DB:{
    prepare(query){
      const statement=database.prepare(query);
      return {
        bind(...params){
          return {
            async first(){
              if(mode==='read-failed'&&query.includes('FROM revoked_session_tokens'))throw Error('synthetic outage');
              return statement.get(...params)||null;
            },
            async run(){
              if(mode==='write-failed'&&query.includes('INSERT OR IGNORE INTO revoked_session_tokens'))throw Error('synthetic write failure');
              if(mode==='write-nonthrow'&&query.includes('INSERT OR IGNORE INTO revoked_session_tokens'))return {success:false,meta:{changes:0}};
              const result=statement.run(...params);
              return {success:true,meta:{changes:result.changes}};
            }
          };
        },
        async first(){
          if(mode==='read-failed'&&query.includes('FROM revoked_session_tokens'))throw Error('synthetic outage');
          return statement.get()||null;
        }
      };
    }
  }
};
const secret=env.SESSION_SECRET;
async function token(jti,legacy=false){
  const payload={uid:'qa-user',role:'admin',email:'qa@example.invalid',exp:Math.floor(Date.now()/1000)+3600};
  if(!legacy)payload.jti=jti;
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const hmac=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex');
  return body+'.'+hmac;
}
const request=(path,cookie,method='GET')=>worker.fetch(
  new Request('https://qa.invalid'+path,{method,headers:{Cookie:'ko_session='+cookie}}),env
);
const identity=async cookie=>{
  const r=await request('/api/me',cookie);
  const body=await r.json();
  return {status:r.status,role:body.role,uid:body.uid};
};
try{
  const deviceA=await token('independent-a-'+crypto.randomUUID());
  const deviceB=await token('independent-b-'+crypto.randomUUID());
  const oldDevice=await token('',true);
  assert.notEqual(deviceA,deviceB);
  assert.deepEqual(await identity(deviceA),{status:200,role:'admin',uid:'qa-user'});
  assert.deepEqual(await identity(deviceB),{status:200,role:'admin',uid:'qa-user'});
  assert.equal((await identity(oldDevice)).uid,'qa-user','legacy token without jti supported');
  const getLogout=await request('/api/logout',deviceA,'GET');
  assert.equal(getLogout.status,405);
  const logoutA=await request('/api/logout',deviceA,'POST');
  assert.equal(logoutA.status,200);
  assert.match(logoutA.headers.get('Set-Cookie'),/Max-Age=0/);
  const rows=database.prepare('SELECT token_hash,expires_at FROM revoked_session_tokens').all();
  assert.equal(rows.length,1);
  assert.equal(rows[0].token_hash,await sessionTokenHash(deviceA));
  assert.notEqual(rows[0].token_hash,deviceA,'only digest, never raw token in database');
  assert.equal((await identity(deviceA)).role,null,'replayed revoked A is anonymous');
  assert.equal((await identity(deviceB)).uid,'qa-user','B device remains signed in');
  assert.equal((await request('/api/logout',deviceA,'POST')).status,200,'repeated logout idempotent');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM revoked_session_tokens').get().n,1);
  assert.equal((await request('/api/logout',oldDevice,'POST')).status,200,'pre-jti cookie can be revoked');
  assert.equal((await identity(oldDevice)).role,null);

  const retryToken=await token('retry-'+crypto.randomUUID());
  mode='write-failed';
  const failed=await request('/api/logout',retryToken,'POST');
  assert.equal(failed.status,503);
  assert.equal(failed.headers.get('Set-Cookie'),null,'failure must not clear cookie before retry');
  mode='ok';
  assert.equal((await identity(retryToken)).uid,'qa-user','failed server write cannot claim session invalidation');
  assert.equal((await request('/api/logout',retryToken,'POST')).status,200,'retry revokes exact original token');
  assert.equal((await identity(retryToken)).role,null,'replay after successful retry denied');

  const quietToken=await token('quiet-'+crypto.randomUUID());
  mode='write-nonthrow';
  const quiet=await request('/api/logout',quietToken,'POST');
  assert.equal(quiet.status,503,'D1 nonthrowing success=false does not claim a logout');
  assert.equal(quiet.headers.get('Set-Cookie'),null);
  mode='ok';
  assert.equal((await identity(quietToken)).uid,'qa-user');
  assert.equal((await request('/api/logout',quietToken,'POST')).status,200);
  assert.equal((await identity(quietToken)).role,null);

  const readToken=await token('read-'+crypto.randomUUID());
  mode='read-failed';
  assert.equal((await identity(readToken)).status,500,'revocation read failure must deny auth');
  const broken=await request('/api/logout',readToken,'POST');
  assert.equal(broken.status,503);
  assert.equal(broken.headers.get('Set-Cookie'),null,'failed read leaves cookie for retry');
  mode='ok';
  assert.equal((await request('/api/logout',readToken,'POST')).status,200);

  const malformed=await request('/api/me','not.a.valid.cookie');
  assert.equal((await malformed.json()).role,null);
  database.exec('DROP TABLE revoked_session_tokens');
  // Simulate MAIN's different 0099 schema existing on the SAME fake D1 while
  // the canonical PR table is absent. A legacy hash must not be accepted as
  // proof the canonical migration ran; authentication still fails closed.
  database.exec('CREATE TABLE revoked_sessions (token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)');
  const missing=await token('missing-'+crypto.randomUUID());
  database.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(await sessionTokenHash(missing),Math.floor(Date.now()/1000)+3600);
  assert.equal((await identity(missing)).status,500,'missing migration fails closed before auth');
  const missingLogout=await request('/api/logout',missing,'POST');
  assert.equal(missingLogout.status,503,'cannot claim success when table missing');
  assert.equal(missingLogout.headers.get('Set-Cookie'),null);
  console.log('SEC-02 actual SQLite migration/Worker PASS: session A replay rejected, B survives, legacy jti, idempotency, cookie-preserving error/retry, DB outages and legacy-only competing table.');
}finally{database.close();}
