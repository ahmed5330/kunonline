/**
 * Isolated real-route integration: self signup -> Resend/Turnstile test doubles ->
 * atomic D1-style SQLite transaction -> existing /api/login and signed cookie ->
 * /api/me, /api/state tenant isolation -> subscription access -> expiry -> logout.
 * No Cloudflare account, live mail, production data, secrets or network used.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import legacyWorker from '../src/index.js';
import { handleSelfSignup } from '../src/self-signup.js';
import { handleSubscriptionControl } from '../src/subscription-control.js';
import { subscriptionAccess } from '../src/subscription-billing.js';
globalThis.crypto ||= webcrypto;

const db = new DatabaseSync(':memory:');
function createTable(name,columns) {
  const cols=columns.split(',').map(x=>x.trim());
  db.exec('CREATE TABLE '+name+' ('+cols.map((col,index)=>col+' TEXT'+(index===0?' PRIMARY KEY':'')).join(',')+')');
}
createTable('users','id,email,name,password,role,client_id,status,created_at,last_login');
db.exec('CREATE UNIQUE INDEX users_unique_email ON users(email)');
createTable('tenant_settings','client_id,display_name,timezone,currency,locale,plan,status,created_at,updated_at');
createTable('subscriptions','id,client_id,plan,status,billing_cycle,amount,currency,period_start,period_end,provider,created_at,updated_at');
createTable('wallet_accounts','client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at');
createTable('stores','id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at');
createTable('user_store_access','id,client_id,user_id,store_id,role,created_at');
db.exec('CREATE UNIQUE INDEX idx_user_store_uniq ON user_store_access(client_id,user_id,store_id)');
createTable('login_attempts','email,fails,locked_until');
createTable('revoked_sessions','token_hash,expires_at');
createTable('state','id,json,updated_at');
createTable('audit_log','id,client_id,actor_email,action,entity_type,entity_id,metadata_json,created_at');
createTable('wallet_log','id,client_id,idempotency_key');
const source=fs.readFileSync('src/index.js','utf8');
for(const [table,key] of [['orders','ORDER_COLS'],['products','PRODUCT_COLS']]){
  const found=source.match(new RegExp('const '+key+" = '([^']+)'"));
  assert.ok(found,'expected real legacy '+key+' projection');
  createTable(table,found[1]);
}
db.exec(fs.readFileSync('migrations/0100_self_signup_email_trial.sql','utf8'));
db.prepare('INSERT INTO state (id,json,updated_at) VALUES (?,?,?)').run('1',JSON.stringify({
  agency:{name:'كن أونلاين',adminEmail:''},clients:[{id:'other-client',name:'Another Store',status:'active'}],entries:[],funding:[]
}),new Date().toISOString());
db.prepare("INSERT INTO orders (id,client_id,date,state,history) VALUES (?,?,?,?,?)").run('PRIVATE-1','other-client','2026-11-01','pending','[]');
const statement=(sql)=>{
  const prepared=db.prepare(sql);
  const scope=(args=[])=>({
    bind(...values){return scope(values);},
    async first(){return prepared.get(...args)||null;},
    async all(){return {results:prepared.all(...args)};},
    async run(){const res=prepared.run(...args);return {meta:{changes:Number(res.changes),last_row_id:res.lastInsertRowid}};}
  });
  return scope();
};
const DB={prepare:statement,async batch(statements){
  db.exec('BEGIN');
  try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
}};
const env={
  DB,SESSION_SECRET:'integration-cookie-signing-secret-please-keep-off-live',
  SELF_SIGNUP_ENABLED:'true',SIGNUP_TOKEN_SECRET:'integration-code-signing-secret-please-keep-off-live',
  SIGNUP_TURNSTILE_SITE_KEY:'integration-site-key',SIGNUP_TURNSTILE_SECRET_KEY:'integration-server-secret',
  SIGNUP_EMAIL_FROM:'accounts@example.test',RESEND_API_KEY:'integration-fake'
};
const origin='https://app.kun-online.com';
const post=(path,payload,cookie='')=>new Request(origin+path,{method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
  body:JSON.stringify(payload)});
const get=(path,cookie='')=>new Request(origin+path,{method:'GET',headers:{...(cookie?{Cookie:cookie}:{})}});
const originalFetch=globalThis.fetch;
let messages=[],challengeChecks=0;
globalThis.fetch=async(url,opts)=>{
  if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
    challengeChecks++;
    const data=JSON.parse(opts.body);
    assert.equal(data.secret,env.SIGNUP_TURNSTILE_SECRET_KEY);
    assert.equal(data.response,'user-verified-token');
    return Response.json({success:true,hostname:'app.kun-online.com'});
  }
  if(url==='https://api.resend.com/emails'){
    messages.push(JSON.parse(opts.body));return Response.json({id:'mail-received-by-test-inbox'});
  }
  throw new Error('Unexpected network request: '+String(url));
};
const email='testjourney@example.test',password='Valid-Strong-Password-147',clientIdFrom=async()=>db.prepare('SELECT client_id FROM users WHERE email=?').get(email)?.client_id;
try{
  // Sign-up must not unlock login before inbox ownership is proven.
  let res=await handleSelfSignup(post('/api/auth/signup',{
    name:'Test Owner',storeName:'Test Fishing Store',email,turnstileToken:'user-verified-token'
  }),env);
  assert.equal(res.status,202);
  assert.equal(challengeChecks,1);
  assert.equal(messages.length,1,'provider accepted one mock email');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0,'no account created before verification');
  res=await legacyWorker.fetch(post('/api/login',{email,password}),env);
  assert.equal(res.status,401,'real login must reject unverified user');

  const code=messages[0].text.match(/([0-9]{8})/)[1];
  res=await handleSelfSignup(post('/api/auth/activate',{email,code,password}),env);
  assert.equal(res.status,201,'code verification must provision a new account');
  const activation=await res.json();
  assert.ok(activation.storeId,'activation returns default store ID');

  const cid=await clientIdFrom();
  assert.ok(cid?.startsWith('SELF-'));
  assert.equal(db.prepare('SELECT count(*) n FROM stores WHERE client_id=?').get(cid).n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM user_store_access WHERE client_id=? AND role=?').get(cid,'owner').n,1);

  // Call the EXISTING login implementation, not a password-hash reproduction.
  res=await legacyWorker.fetch(post('/api/login',{email,password}),env);
  assert.equal(res.status,200,'real login must accept activated password');
  const setCookie=res.headers.get('Set-Cookie');
  assert.match(setCookie||'',/^ko_session=.+; HttpOnly; Secure; SameSite=Lax/);
  const cookie=setCookie.split(';')[0];
  res=await legacyWorker.fetch(get('/api/me',cookie),env);
  assert.equal(res.status,200,'real signed session verification');
  const me=await res.json();
  assert.equal(me.clientId,cid);
  assert.equal(me.role,'client');
  assert.equal(me.name,'Test Owner');

  // Open an actual account-scoped API endpoint, not just a SQL query.
  res=await legacyWorker.fetch(get('/api/state',cookie),env);
  assert.equal(res.status,200,'real app state must load for self-created owner');
  const account=await res.json();
  assert.equal(account.clients.length,1);
  assert.equal(account.clients[0].name,'Test Fishing Store');
  assert.equal(account.clients[0].id,cid);
  assert.equal(account.orders.length,0,'another tenant private order must remain hidden');
  res=await legacyWorker.fetch(get('/api/state?clientId=other-client',cookie),env);
  assert.equal(res.status,403,'cross-tenant read must fail');

  const during=await subscriptionAccess(env,cid);
  assert.equal(during.locked,false,'zero-wallet trial must operate normally');
  assert.equal(during.trialActive,true);
  assert.equal(during.trialDaysRemaining,30);
  assert.equal(during.orderFee,0);
  const route='/api/orders';
  res=await handleSubscriptionControl({request:post(route,{clientId:cid},cookie),env,ctx:{},delegate:legacyWorker});
  assert.equal(res,null,'trial must NOT be blocked by paid-wallet gate');

  // Simulate exactly the expired period without touching real clock or live data.
  db.prepare('UPDATE subscriptions SET period_end=? WHERE client_id=?').run('2020-01-01',cid);
  const expired=await subscriptionAccess(env,cid);
  assert.equal(expired.trialActive,false);
  assert.equal(expired.locked,true);
  assert.equal(expired.reason,'balance_empty');
  res=await handleSubscriptionControl({request:post(route,{clientId:cid},cookie),env,ctx:{},delegate:legacyWorker});
  assert.equal(res.status,402,'existing middleware must lock paid operations after expiry');
  assert.equal((await res.json()).code,'SUBSCRIPTION_BALANCE_REQUIRED');
  res=await legacyWorker.fetch(get('/api/me',cookie),env);
  assert.equal(res.status,200,'user must still log in to view wallet after expiry');

  // Replay and invalidation must not create another store or free trial.
  res=await handleSelfSignup(post('/api/auth/activate',{email,code,password}),env);
  assert.notEqual(res.status,201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE client_id=?').get(cid).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stores WHERE client_id=?').get(cid).n,1);

  // Existing logout revokes the signed session.
  res=await legacyWorker.fetch(post('/api/logout',{},cookie),env);
  assert.equal(res.status,200);
  res=await legacyWorker.fetch(get('/api/me',cookie),env);
  const loggedOut=await res.json();
  assert.equal(loggedOut.role,null,'revoked cookie cannot authenticate');

  console.log(JSON.stringify({ok:true,checks:['real login before/after activation','Turnstile verification','email provider stub','atomic tenant and owner store','real session cookie /api/me','real /api/state tenant isolation','30-day free trial','paid-wallet gate after expiry','replay resistance','real logout cookie revocation'],liveEmail:false,liveD1:false}));
}finally{
 globalThis.fetch=originalFetch;
 db.close();
}
