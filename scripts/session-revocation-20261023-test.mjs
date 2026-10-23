import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {sessionTokenHash} from '../src/session-revocation.js';

const secret='isolated-test-session-key';
const revoked=new Map(),calls={reads:0,writes:0};
const user={id:'fake-viewer',email:'viewer@test.invalid',role:'viewer',status:'active',name:'Fake Tester',client_id:'fake-tenant'};
let rejectWrites=false,rejectReads=false;
const env={
  SESSION_SECRET:secret,
  DB:{prepare(sql){
    const statement={params:[],
      bind(...values){this.params=values;return this;},
      async first(){
        calls.reads++;
        if(sql.includes('FROM revoked_session_tokens')){
          if(rejectReads)throw Error('Synthetic D1 read outage');
          return revoked.has(this.params[0])?{token_hash:this.params[0]}:null;
        }
        if(sql.includes('FROM users WHERE id = ?'))return this.params[0]===user.id?user:null;
        if(sql.includes('COUNT(*) AS n FROM users'))return {n:1};
        throw Error('Unexpected fixture SELECT: '+sql);
      },
      async run(){
        calls.writes++;
        if(rejectWrites)throw Error('Synthetic D1 write outage');
        if(sql.startsWith('INSERT OR IGNORE INTO revoked_session_tokens')){
          revoked.set(this.params[0],{expires:this.params[1],at:this.params[2]});
          return {meta:{changes:1}};
        }
        throw Error('Unexpected fixture UPDATE: '+sql);
      }
    };return statement;
  }}
};
async function makeToken(jti){
  const payload=Buffer.from(JSON.stringify({uid:user.id,role:'admin',jti,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('hex');
  return payload+'.'+signature;
}
async function route(path,token,method='GET'){
  return worker.fetch(new Request('https://test.invalid'+path,{method,headers:{Cookie:'ko_session='+token}}),env);
}
const first=await makeToken('session-one'),other=await makeToken('session-two');
assert.notEqual(first,other,'same user signs distinct sessions');
assert.equal((await route('/api/me',first)).status,200,'valid synthetic login session');
assert.equal((await route('/api/me',other)).status,200,'second session remains active');
const readsBefore= calls.reads;
const forged=first.slice(0,-2)+'ff';
assert.equal((await route('/api/me',forged)).status,200,'/api/me remains anonymous-envelope on bad signature');
assert.equal(calls.reads,readsBefore+1,'only user count read for rejected cookie');
const logout=await route('/api/logout',first,'POST');
assert.equal(logout.status,200);
assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
assert.equal(revoked.has(await sessionTokenHash(first)),true,'only hash stored');
assert.equal(revoked.has(first),false,'raw session bearer token never stored');
assert.equal((await route('/api/me',first)).status,200);
assert.equal((await (await route('/api/me',first)).json()).role,null,'old signed session cannot reauthenticate');
assert.equal((await (await route('/api/me',other)).json()).uid,user.id,'separate session stays valid');
const repeat=await route('/api/logout',first,'POST');
assert.equal(repeat.status,200,'already revoked logout is idempotent');
rejectWrites=true;
const failed=await route('/api/logout',other,'POST');
assert.equal(failed.status,503,'cannot claim logout succeeded when revocation write failed');
assert.match(failed.headers.get('Set-Cookie'),/Max-Age=0/);
rejectWrites=false;
rejectReads=true;
assert.equal((await route('/api/me',other)).status,500,'database read outage must fail closed');
rejectReads=false;
assert.equal((await (await route('/api/me',other)).json()).uid,user.id,'failed logout did not silently invalidate other session');
assert.equal((await route('/api/logout',other,'POST')).status,200);
assert.equal((await (await route('/api/me',other)).json()).role,null);
console.log('SEC-02 synthetic session replay test PASS: per-token invalidation, no bearer storage, fail-closed read and logout.');
