import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/index-commerce-v26.js';
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,role TEXT,client_id TEXT,status TEXT,password TEXT,last_login TEXT); CREATE TABLE login_attempts(email TEXT PRIMARY KEY,fails INTEGER,locked_until TEXT);`);
db.exec(readFileSync(new URL('../migrations/0099_revoked_sessions.sql',import.meta.url),'utf8'));
db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('qa','qa@example.test','QA','viewer','own','active','invalid',null);
let failure=false;
const env={SESSION_SECRET:'synthetic-test-key',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){if(failure&&sql.includes('revoked_sessions'))throw Error('synthetic DB outage');return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){if(failure)throw Error('synthetic DB outage');return {meta:db.prepare(sql).run(...args)}}}}},ASSETS:{fetch:async()=>new Response('',{status:404})}};
async function token(extra={}){const body=Buffer.from(JSON.stringify({uid:'qa',role:'admin',exp:Math.floor(Date.now()/1000)+3600,...extra})).toString('base64url');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return body+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex')}
const context={waitUntil(){}};
const {default:gateway}=await import('../src/index-production-mobile-update.js');
env.PREVIEW_APP={fetch:r=>worker.fetch(r,env,context)};
async function req(path,t,useGateway=false){const r=new Request('https://isolated.test'+path,{headers:{cookie:'ko_session='+t}});return (useGateway?gateway:worker).fetch(r,env,context)}
for(const viaGateway of [false,true]){
const old=await token({jti:crypto.randomUUID()}),other=await token({jti:crypto.randomUUID()});
assert.equal((await(await req('/api/me',old,viaGateway)).json()).role,'viewer');
const out=await req('/api/logout',old,viaGateway);assert.equal(out.status,200);assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/);
assert.equal((await(await req('/api/me',old,viaGateway)).json()).role,null);
assert.equal((await req('/api/stores',old,viaGateway)).status,401);
assert.equal((await(await req('/api/me',other,viaGateway)).json()).role,'viewer');
assert.equal((await req('/api/logout',old,viaGateway)).status,200);
}
const legacy=await token();assert.equal((await req('/api/logout',legacy)).status,200);assert.equal((await req('/api/stores',legacy)).status,401);
assert.equal((await req('/api/logout','malformed')).status,200);
const valid=await token({jti:crypto.randomUUID()});failure=true;
assert.equal((await req('/api/logout',valid)).status,500);
assert.equal((await req('/api/me',valid)).status,500);failure=false;
assert.equal((await(await req('/api/me',valid)).json()).role,'viewer');
assert(db.prepare('SELECT COUNT(*) n FROM revoked_sessions').get().n>=3);
assert(db.prepare('SELECT token_hash FROM revoked_sessions').all().every(r=>/^[a-f0-9]{64}$/.test(r.token_hash)));
const salt=crypto.getRandomValues(new Uint8Array(16));
const passwordKey=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-pass-13'),'PBKDF2',false,['deriveBits']);
const hash=Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},passwordKey,256)).toString('base64');
db.prepare('UPDATE users SET password=?').run('pbkdf2$100000$'+Buffer.from(salt).toString('base64')+'$'+hash);
const login=()=>worker.fetch(new Request('https://isolated.test/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'qa@example.test',password:'synthetic-pass-13'})}),env,context);
const first=await login(),second=await login();assert.equal(first.status,200);assert.equal(second.status,200);
const a=first.headers.get('set-cookie').split(';')[0].slice('ko_session='.length),b=second.headers.get('set-cookie').split(';')[0].slice('ko_session='.length);assert.notEqual(a,b);
await req('/api/logout',a);assert.equal((await(await req('/api/me',b)).json()).role,'viewer');
console.log('Session revocation passed: direct + production gateway, replay denied, other device preserved, legacy token revoked, repeated/invalid logout safe, DB outage fails closed, stored hashes only.');db.close();
