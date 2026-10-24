/* Actual Worker fetch-handler acceptance tests with a local SQLite D1 adapter.
 * NEVER touches Cloudflare or runs main commerce application.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/audit-sandbox-auth-worker.js';

const sql=await readFile(new URL('../sandbox/migrations/0001_synthetic_revocation_only.sql',import.meta.url),'utf8');
const conf=await readFile(new URL('../wrangler.audit-sandbox.example.toml',import.meta.url),'utf8');
const workerCode=await readFile(new URL('../src/audit-sandbox-auth-worker.js',import.meta.url),'utf8');
assert.match(conf,/main = "src\/audit-sandbox-auth-worker\.js"/);
assert.match(conf,/workers_dev = false/);
assert.match(conf,/migrations_dir = "sandbox\/migrations"/);
assert.match(conf,/crons = \[\]/);
assert.doesNotMatch(conf,/\[assets\]|\[\[services\]\]|\bPREVIEW_APP\b|\bPREVIEW_DB\b/);
assert.doesNotMatch(workerCode,/\bfetch\s*\(|\.fetch\s*\(|https?:\/\/|src\/index-commerce|index-production-mobile/i,
  'No outbound network SDK/call, commerce import, or provider endpoint permitted');
assert.doesNotMatch(workerCode,/handleJt|handleEasyOrders|webhook|\bcron\b/i,
  'No legacy system entrypoint or provider integration logic permitted');
const db=new DatabaseSync(':memory:');
db.exec(sql);
const queries=[];
let failSecond=false;
const env={
  APP_ENV:'audit_sandbox',AUDIT_EGRESS_OFFLINE:'true',
  AUDIT_QA_KEY:'synthetic-QA-access-key-40-chars-DO-NOT-DEPLOY',
  DB:{
    prepare(sql){
      queries.push(sql);
      return {bind(...args){return {
        sql,args,
        async first(){return db.prepare(sql).get(...args)||null;}
      };}};
    },
    async batch(statements){
      db.exec('BEGIN IMMEDIATE');
      try{
        const results=[];
        for(let i=0;i<statements.length;i++){
          if(failSecond&&i===1)throw Error('synthetic-write-outage');
          const q=statements[i],r=db.prepare(q.sql).run(...q.args);
          results.push({success:true,meta:{changes:r.changes}});
        }
        db.exec('COMMIT');return results;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  }
};
const call=async(path,method='GET',headers={},e=env)=>{
  const response=await worker.fetch(new Request('https://audit.invalid'+path,{method,headers}),e);
  return {status:response.status,headers:response.headers,body:await response.json()};
};
try{
  let res=await call('/healthz');
  assert.equal(res.status,200);assert.equal(res.body.kind,'isolated_auth_sandbox');
  assert.equal(res.body.deployVerified,false);
  assert.equal((await call('/api/login')).status,404,'Never expose production auth routes');
  assert.equal((await call('/api/orders',{toString(){return 'POST';}})).status,404);
  assert.equal((await call('/qa/revocation-selftest','GET')).status,404);
  assert.equal((await call('/qa/revocation-selftest','POST')).status,403);
  assert.equal((await call('/qa/revocation-selftest','POST',{'X-Audit-QA-Key':'wrong'})).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM revoked_sessions').get().n,0,'Unauthorized calls cause no write');
  assert.equal((await call('/healthz','GET',{}, {...env,APP_ENV:'production'})).status,503);
  assert.equal((await call('/healthz','GET',{}, {...env,AUDIT_EGRESS_OFFLINE:'false'})).status,503);
  assert.equal((await call('/qa/revocation-selftest','POST',{'X-Audit-QA-Key':env.AUDIT_QA_KEY}, {...env,AUDIT_QA_KEY:''})).status,503);
  res=await call('/qa/revocation-selftest','POST',{'X-Audit-QA-Key':env.AUDIT_QA_KEY});
  assert.equal(res.status,200);assert.equal(res.body.ok,true);
  assert.equal(res.body.checks.afterLogoutRevoked,true);
  assert.equal(res.body.checks.dualD1WritesAtomic,true);
  assert.equal(res.headers.get('set-cookie'),null,'No user login/cookie operations in sandbox Worker');
  let rows=db.prepare('SELECT token_hash,expires_at FROM revoked_sessions').all();
  let other=db.prepare('SELECT token_hash,expires_at FROM revoked_session_tokens').all();
  assert.equal(rows.length,1);assert.equal(other.length,1);
  assert.equal(rows[0].token_hash,other[0].token_hash);
  assert.match(rows[0].token_hash,/^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(res.body),/synthetic-QA-access|KUN_AUDIT_SYNTHETIC|token_hash/);
  assert.doesNotMatch(JSON.stringify(res.body),/expires_at|revoked_at/);
  assert.ok(queries.every(q=>/^(SELECT|INSERT)/.test(q)),'No schema mutation in public Worker routes');
  failSecond=true;
  res=await call('/qa/revocation-selftest','POST',{'X-Audit-QA-Key':env.AUDIT_QA_KEY});
  assert.equal(res.status,503);
  assert.deepEqual(res.body,{ok:false,error:'SANDBOX_D1_SCHEMA_OR_WRITE_UNAVAILABLE'});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM revoked_sessions').get().n,1,'D1 batch failure rolled back both rows');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM revoked_session_tokens').get().n,1);
  failSecond=false;
  db.exec('DROP TABLE revoked_session_tokens');
  res=await call('/qa/revocation-selftest','POST',{'X-Audit-QA-Key':env.AUDIT_QA_KEY});
  assert.equal(res.status,503,'Missing schema must fail closed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM revoked_sessions').get().n,1);
  console.log('Isolated auth-only Worker synthetic E2E PASS: secure QA gate, deny commerce routes and egress, D1 dual writes, rollback, schema outage. NO remote/cloud calls.');
}finally{db.close();}
