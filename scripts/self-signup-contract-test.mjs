import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {handleSelfSignup,__signupInternals} from '../src/self-signup.js';
globalThis.crypto ||= webcrypto;

const read=path=>fs.readFileSync(path,'utf8');
const worker=read('src/index-commerce-v38.js');
const prod=read('src/index-production-mobile-update.js');
const html=read('public/v2/index.html');
const ui=read('public/v2/signup-v162.js');
const legacyAuth=read('public/v2/modules-v26-auth.js');
const migration=read('migrations/0100_self_signup_email_trial.sql');

assert.match(worker,/handleSelfSignup\(request,env\)/,'preview signup route must run before billing');
assert.match(prod,/AUTH_PATHS=new Set\(\[[^\n]*\/api\/auth\/signup[^\n]*\/api\/auth\/activate/,'production must forward signup to auth identity backend');
assert.match(html,/signup-v162\.js\?v=162\.0/,'signup UI must be served');
assert.match(ui,/\/api\/auth\/signup/);
assert.match(ui,/\/api\/auth\/activate/);
assert.match(ui,/\/api\/auth\/signup\/config/);
assert.match(ui,/turnstile\.render/,'signup UI requires verified challenge');
assert.match(ui,/window\.KunSelfSignup=\{open\}/,'legacy tab and gateway share one signup UI');
assert.match(legacyAuth,/KunSelfSignup\?\.open/,'legacy signup tab must open new journey');
assert.doesNotMatch(legacyAuth,/التسجيل الذاتي المفتوح للمتاجر غير مفعّل حاليًا/,'legacy page cannot contradict active signup');
assert.match(migration,/CREATE TABLE IF NOT EXISTS signup_trial_claims/);
assert.match(migration,/email TEXT PRIMARY KEY/);
assert.equal(__signupInternals.plusDays('2026-11-07',30),'2026-12-07');
assert.match(__signupInternals.code8(),/^[0-9]{8}$/);
assert.equal(__signupInternals.isEmail('shop@example.com'),true);
assert.equal(__signupInternals.isEmail('invalid-at-mail'),false);

const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,password TEXT NOT NULL,role TEXT,client_id TEXT,status TEXT,created_at TEXT);");
db.exec("CREATE TABLE tenant_settings (client_id TEXT PRIMARY KEY,display_name TEXT,timezone TEXT,currency TEXT,locale TEXT,plan TEXT,status TEXT,created_at TEXT,updated_at TEXT);");
db.exec("CREATE TABLE wallet_accounts (client_id TEXT PRIMARY KEY,balance REAL,currency TEXT,base_order_fee REAL,min_order_fee REAL,max_order_fee REAL,credit_limit REAL,billing_version TEXT,billing_start_rowid INTEGER,status TEXT,updated_at TEXT);");
db.exec("CREATE TABLE subscriptions (id TEXT PRIMARY KEY,client_id TEXT,plan TEXT,status TEXT,billing_cycle TEXT,amount REAL,currency TEXT,period_start TEXT,period_end TEXT,provider TEXT,created_at TEXT,updated_at TEXT);");
db.exec(migration);
const DB={
  prepare(sql){
    const stmt=db.prepare(sql);
    return {
      bind(...args){
        return {
          async first(){return stmt.get(...args)||null;},
          async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}};}
        };
      }
    };
  },
  async batch(statements){
    db.exec('BEGIN');
    try{for(const s of statements)await s.run();db.exec('COMMIT');}
    catch(e){db.exec('ROLLBACK');throw e;}
  }
};
const env={DB,SELF_SIGNUP_ENABLED:'true',SIGNUP_TOKEN_SECRET:'test_secret_'.repeat(4),RESEND_API_KEY:'test-only',SIGNUP_EMAIL_FROM:'accounts@example.com',SIGNUP_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',SIGNUP_TURNSTILE_SECRET_KEY:'test-turnstile-secret'};
const url='https://app.kun-online.com';
const request=(route,payload,ip='203.0.113.4',origin=url)=>new Request(url+route,{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json','cf-connecting-ip':ip},
  body:JSON.stringify(route==='/api/auth/signup'?{...payload,turnstileToken:payload?.turnstileToken===undefined?'token-from-browser':payload.turnstileToken}:payload)
});
const originalFetch=globalThis.fetch;
let mails=[];
let challengeValid=true;
let mailValid=true;
globalThis.fetch=async (url,opts)=>{
  if(String(url).includes('/turnstile/v0/siteverify')){
    const body=JSON.parse(opts.body);
    assert.equal(body.secret,env.SIGNUP_TURNSTILE_SECRET_KEY);
    return Response.json({success:challengeValid,hostname:'app.kun-online.com'});
  }
  if(!mailValid)return new Response('{"message":"invalid provider"}',{status:400});
  mails.push(JSON.parse(opts.body));return new Response('{"id":"fake"}',{status:200});
};
try{
  let config=await handleSelfSignup(new Request(url+'/api/auth/signup/config',{method:'GET'}),env);
  assert.equal(config.status,200);
  assert.deepEqual(await config.json(),{enabled:true,turnstileSiteKey:env.SIGNUP_TURNSTILE_SITE_KEY});
  let response=await handleSelfSignup(request('/api/auth/signup',{name:'Samir',storeName:'My Store',email:'SHOP@example.com'}),{DB});
  assert.equal(response.status,503,'registration is fail-closed without provider configuration');
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Samir',storeName:'My Store',email:'SHOP@example.com'},'203.0.113.4','https://evil.example'),env);
  assert.equal(response.status,403,'cross-origin registration must be rejected');

  response=await handleSelfSignup(request('/api/auth/signup',{name:'Samir',storeName:'My Store',email:'SHOP@example.com'}),env);
  assert.equal(response.status,202,'valid signup accepted');
  assert.equal(mails.length,1,'one email sent');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM users').get().count,0,'signup must not create an unverified user');
  assert.ok(!mails[0].text.includes('password'),'email must send a code, not a password');
  const code=mails[0].text.match(/([0-9]{8})/)?.[1];
  assert.match(code||'',/^[0-9]{8}$/);
  const pending=db.prepare('SELECT * FROM signup_pending WHERE email=?').get('shop@example.com');
  assert.ok(pending,'pending row created');
  assert.ok(!JSON.stringify(pending).includes(code),'verification code must never be stored in plaintext');

  const badCode=code==='00000000'?'11111111':'00000000';
  response=await handleSelfSignup(request('/api/auth/activate',{email:'shop@example.com',code:badCode,password:'longEnoughSecret123!'}),env);
  assert.equal(response.status,400,'invalid code rejected');

  response=await handleSelfSignup(request('/api/auth/activate',{email:'shop@example.com',code,password:'longEnoughSecret123!'}),env);
  assert.equal(response.status,201,'correct code activates account');
  const user=db.prepare('SELECT * FROM users WHERE email=?').get('shop@example.com');
  assert.ok(user&&user.role==='client'&&user.status==='active'&&user.client_id,'activated owner has tenant');
  assert.match(user.password,/^pbkdf2\$100000\$/);
  assert.ok(!user.password.includes('longEnoughSecret123!'),'password must be hashed');

  const parts=user.password.split('$'),salt=Uint8Array.from(atob(parts[2]),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('longEnoughSecret123!'),'PBKDF2',false,['deriveBits']);
  const derived=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256));
  assert.equal(btoa(String.fromCharCode(...derived)),parts[3],'created password must work with existing login verifier');

  const tenant=db.prepare('SELECT * FROM tenant_settings WHERE client_id=?').get(user.client_id);
  const sub=db.prepare('SELECT * FROM subscriptions WHERE client_id=?').get(user.client_id);
  const wallet=db.prepare('SELECT * FROM wallet_accounts WHERE client_id=?').get(user.client_id);
  assert.equal(tenant.display_name,'My Store');
  assert.equal(sub.status,'trialing');
  assert.equal(sub.period_end,__signupInternals.plusDays(sub.period_start,30));
  assert.equal(sub.amount,0);
  assert.equal(wallet.billing_version,'v27');
  assert.equal(wallet.status,'active');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM signup_trial_claims WHERE email=?').get('shop@example.com').count,1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM signup_pending WHERE email=?').get('shop@example.com').count,0);
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Again',storeName:'Store Again',email:'shop@example.com'}),env);
  assert.equal(response.status,202,'existing email gets safe generic reply');
  assert.equal(mails.length,1,'existing account never receives a new activation code');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM subscriptions WHERE client_id=?').get(user.client_id).count,1,'one trial per verified email');

  // Expiry: a verified code must never activate outside the 10-minute window.
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Layla',storeName:'Layla Store',email:'layla@example.com'},'203.0.113.12'),env);
  assert.equal(response.status,202);
  const laylaCode=mails.at(-1).text.match(/([0-9]{8})/)[1];
  db.prepare('UPDATE signup_pending SET expires_at=? WHERE email=?').run('2020-01-01T00:00:00.000Z','layla@example.com');
  response=await handleSelfSignup(request('/api/auth/activate',{email:'layla@example.com',code:laylaCode,password:'VeryLongPassword123!' },'203.0.113.12'),env);
  assert.equal(response.status,400);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM users WHERE email=?').get('layla@example.com').count,0);

  // Five wrong codes must exhaust the current token without granting the trial.
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Mona',storeName:'Mona Store',email:'mona@example.com'},'203.0.113.13'),env);
  assert.equal(response.status,202);
  const monaCode=mails.at(-1).text.match(/([0-9]{8})/)[1];
  const wrong=monaCode==='11111111'?'99999999':'11111111';
  for(let n=0;n<5;n++){
    response=await handleSelfSignup(request('/api/auth/activate',{email:'mona@example.com',code:wrong,password:'VeryLongPassword123!'},'203.0.113.13'),env);
    assert.equal(response.status,400);
  }
  response=await handleSelfSignup(request('/api/auth/activate',{email:'mona@example.com',code:monaCode,password:'VeryLongPassword123!'},'203.0.113.13'),env);
  assert.equal(response.status,400,'correct code after fifth failed guess must be rejected');

  // Sending again before the 90-second cooldown must not send another mail.
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Adel',storeName:'Adel Store',email:'adel@example.com'},'203.0.113.14'),env);
  assert.equal(response.status,202);
  const oldCode=mails.at(-1).text.match(/([0-9]{8})/)[1];
  const beforeResend=mails.length;
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Adel',storeName:'Adel Store',email:'adel@example.com'},'203.0.113.14'),env);
  assert.equal(response.status,202);
  assert.equal(mails.length,beforeResend);
  db.prepare('UPDATE signup_pending SET sent_at=? WHERE email=?').run('2020-01-01T00:00:00.000Z','adel@example.com');
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Adel',storeName:'Adel Store',email:'adel@example.com'},'203.0.113.14'),env);
  assert.equal(response.status,202);
  assert.equal(mails.length,beforeResend+1);
  const newCode=mails.at(-1).text.match(/([0-9]{8})/)[1];
  if(oldCode!==newCode){
    response=await handleSelfSignup(request('/api/auth/activate',{email:'adel@example.com',code:oldCode,password:'VeryLongPassword123!'},'203.0.113.14'),env);
    assert.equal(response.status,400,'resending invalidates previous code');
  }
  response=await handleSelfSignup(request('/api/auth/activate',{email:'adel@example.com',code:newCode,password:'VeryLongPassword123!'},'203.0.113.14'),env);
  assert.equal(response.status,201);
  response=await handleSelfSignup(request('/api/auth/activate',{email:'adel@example.com',code:newCode,password:'VeryLongPassword123!'},'203.0.113.14'),env);
  assert.equal(response.status,400,'activation code must be one-time only');

  // Missing or rejected Turnstile tokens must never send mail or create tenants.
  response=await handleSelfSignup(request('/api/auth/signup',{name:'No Token',storeName:'Denied Store',email:'denied@example.com',turnstileToken:''},'203.0.113.15'),env);
  assert.equal(response.status,403);
  challengeValid=false;
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Bot',storeName:'Bot Store',email:'bot@example.com'},'203.0.113.16'),env);
  assert.equal(response.status,403);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM signup_pending WHERE email=?').get('bot@example.com').count,0);
  challengeValid=true;

  // Check fail-closed delivery: an undelivered code must not block later retries.
  mailValid=false;
  response=await handleSelfSignup(request('/api/auth/signup',{name:'Nour',storeName:'Nour Store',email:'nour@example.com'},'203.0.113.9'),env);
  assert.equal(response.status,503);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM signup_pending WHERE email=?').get('nour@example.com').count,0);
  console.log('Self-signup: email, Turnstile, code expiry, 5 attempts, resend cooldown, atomic activation, trial, tenant, wallet, replay and error-handling tests passed.');
}finally{globalThis.fetch=originalFetch;db.close();}
