/**
 * Kun Online main admin login: strictly read-only D1 identity audit.
 * Outputs only aggregate diagnostics; never emails, user IDs, password hashes,
 * tokens, cookies, Cloudflare response bodies, or SQL result rows.
 *
 * --self-test: offline, no Cloudflare access.
 * --read-only: compare both configured D1s (real Production auth is Preview).
 *
 * This DOES NOT reset a password or prove a successful credential login.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const clean = value => String(value ?? '').trim().toLowerCase();
function validPasswordHash(value) {
  const parts = String(value ?? '').split('$');
  if(parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const rounds = Number(parts[1]);
  if(!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 500000) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(parts[2])
    && /^[A-Za-z0-9+/]+={0,2}$/.test(parts[3])
    && parts[2].length >= 20 && parts[3].length >= 40;
}
function inspect(rows, locks, now) {
  if(!Array.isArray(rows) || rows.length > 100) throw Error('Admin identity inventory exceeded safe bounds');
  const byEmail=new Map();
  let active=0, malformedHashes=0, unnormalizedEmails=0, locked=0, expiredLockRows=0, duplicateKeys=0;
  for(const row of rows) {
    const key=clean(row.email);
    if(!key) throw Error('An administrator has no usable email');
    if(byEmail.has(key)) duplicateKeys++;
    byEmail.set(key,row);
    if(String(row.email)!==key) unnormalizedEmails++;
    if(row.status==='active') active++;
    if(!validPasswordHash(row.password)) malformedHashes++;
    const lock=locks.get(key);
    if(lock?.locked_until) {
      const t=Date.parse(lock.locked_until);
      if(Number.isNaN(t)) throw Error('Invalid lock timestamp');
      if(t>now) locked++; else expiredLockRows++;
    }
  }
  return {total:rows.length,active,malformedHashes,unnormalizedEmails,locked,expiredLockRows,duplicateKeys,byEmail};
}
function summarize(prod,preview,prodLocks,previewLocks,now=Date.now()) {
  const p=inspect(prod,prodLocks,now),v=inspect(preview,previewLocks,now);
  let sharedAdmins=0, sameStoredPasswordHash=0, differentStoredPasswordHash=0;
  let prodOnly=0, previewOnly=0, canonicalAdminStatusDisagreements=0;
  for(const [key,pUser] of p.byEmail) {
    const vUser=v.byEmail.get(key);
    if(!vUser){prodOnly++;continue;}
    sharedAdmins++;
    if(pUser.password===vUser.password) sameStoredPasswordHash++; else differentStoredPasswordHash++;
    if(pUser.status!==vUser.status) canonicalAdminStatusDisagreements++;
  }
  for(const key of v.byEmail.keys()) if(!p.byEmail.has(key))previewOnly++;
  return {
    readOnly:true,canonicalAuthentication:'PREVIEW_APP / PREVIEW_DB',
    production:{adminCount:p.total,activeAdmins:p.active,invalidPasswordHashFormat:p.malformedHashes,
      accountsWithFutureLoginLock:p.locked,unnormalizedAdminEmails:p.unnormalizedEmails,duplicateNormalizedEmails:p.duplicateKeys},
    canonicalPreview:{adminCount:v.total,activeAdmins:v.active,invalidPasswordHashFormat:v.malformedHashes,
      accountsWithFutureLoginLock:v.locked,unnormalizedAdminEmails:v.unnormalizedEmails,duplicateNormalizedEmails:v.duplicateKeys},
    crossDatabase:{sharedAdminEmails:sharedAdmins,matchingStoredPasswordHashes:sameStoredPasswordHash,
      mismatchedStoredPasswordHashes:differentStoredPasswordHash,adminsOnlyInProduction:prodOnly,
      adminsOnlyInPreview:previewOnly,adminStatusDisagreements:canonicalAdminStatusDisagreements},
    verifiedActualPassword:false,releaseAuthorized:false,passwordResetPerformed:false
  };
}
function databaseId(conf,binding) {
  const sections=conf.split('[[d1_databases]]').slice(1);
  for(const section of sections) {
    const body=section.split(/\n\s*\[/)[0];
    const get=name=>new RegExp('(?:^|\\n)\\s*'+name+'\\s*=\\s*"([^"]+)"').exec(body)?.[1];
    if(get('binding')===binding) return get('database_id');
  }
  return null;
}
async function main() {
  const arg=process.argv[2];
  if(arg==='--self-test') {
    const demo=[
      {email:'ADMIN@Example.test ',status:'active',password:'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}
    ];
    const empty=new Map();
    const a=summarize(demo,demo,empty,empty);
    assert.equal(a.crossDatabase.matchingStoredPasswordHashes,1);
    assert.equal(a.canonicalPreview.activeAdmins,1);
    assert.equal(a.canonicalPreview.unnormalizedAdminEmails,1);
    assert.equal(a.verifiedActualPassword,false);
    const b=summarize(demo,[{...demo[0],password:'not-a-hash',status:'disabled'}],empty,empty);
    assert.equal(b.crossDatabase.mismatchedStoredPasswordHashes,1);
    assert.equal(b.crossDatabase.adminStatusDisagreements,1);
    assert.equal(b.canonicalPreview.invalidPasswordHashFormat,1);
    assert.equal(summarize([],demo,empty,empty).crossDatabase.adminsOnlyInPreview,1);
    assert.equal(summarize(demo,[],empty,empty).crossDatabase.adminsOnlyInProduction,1);
    assert.equal(summarize(demo,demo,empty,new Map([[clean(demo[0].email),{locked_until:'2099-01-01T00:00:00Z'}]])).canonicalPreview.accountsWithFutureLoginLock,1);
    assert.equal(databaseId('[[d1_databases]]\nbinding = "DB"\ndatabase_id = "ID"\n\n[vars]\n','DB'),'ID');
    console.log('Admin login D1 read-only audit: offline cases OK');
    return;
  }
  if(arg!=='--read-only') throw Error('Only --read-only or --self-test is permitted');

  const conf=fs.readFileSync('wrangler.production.toml','utf8');
  const source=fs.readFileSync('src/index-production-mobile-update.js','utf8');
  if(!source.includes("const AUTH_PATHS=new Set(['/api/login','/api/me','/api/logout'])")
     || !source.includes('const identity=await previewFetch(request,env)'))
     throw Error('Authentication routing differs from audited version; do not infer canonical identity');
  const production=databaseId(conf,'DB'),preview=databaseId(conf,'PREVIEW_DB');
  const account=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN;
  if(!production||!preview||production===preview||!account||!token)
    throw Error('Distinct database bindings or scoped read token unavailable');
  const allowSql=new Set([
    "SELECT email,status,password FROM users WHERE role='admin' LIMIT 101",
    "SELECT fails,locked_until FROM login_attempts WHERE lower(trim(email))=? LIMIT 1"
  ]);
  async function select(db,sql,params=[]) {
    if(!allowSql.has(sql)) throw Error('Query is not on the fixed read-only SQL allowlist');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    let response;
    try {
      response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/d1/database/'+encodeURIComponent(db)+'/query',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({sql,params}),signal:controller.signal
      });
    } finally {clearTimeout(timer);}
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.success===false||data.result?.[0]?.success===false)
      throw Error('Read-only Cloudflare D1 query failed (HTTP '+response.status+')');
    if(!Array.isArray(data.result?.[0]?.results))throw Error('D1 result missing; inspection blocked');
    return data.result[0].results;
  }
  async function snapshot(db) {
    const admins=await select(db,"SELECT email,status,password FROM users WHERE role='admin' LIMIT 101");
    if(admins.length>100)throw Error('Too many admin identities; inspection blocked');
    const locks=new Map();
    for(const admin of admins) {
      const key=clean(admin.email);
      if(!key)throw Error('Admin email is empty');
      const result=await select(db,"SELECT fails,locked_until FROM login_attempts WHERE lower(trim(email))=? LIMIT 1",[key]);
      if(result.length)locks.set(key,result[0]);
    }
    return {admins,locks};
  }
  const [prod,canonical]=await Promise.all([snapshot(production),snapshot(preview)]);
  const summary=summarize(prod.admins,canonical.admins,prod.locks,canonical.locks);
  console.log('Safe aggregated admin authentication audit: '+JSON.stringify(summary));
  if(summary.canonicalPreview.activeAdmins<1||
    summary.canonicalPreview.invalidPasswordHashFormat>0||
    summary.canonicalPreview.duplicateNormalizedEmails>0||
    summary.canonicalPreview.accountsWithFutureLoginLock>0||
    summary.crossDatabase.mismatchedStoredPasswordHashes>0||
    summary.crossDatabase.adminsOnlyInProduction>0)
      console.log('ATTENTION: admin login needs an operator-reviewed remediation; no credentials changed.');
  else console.log('No structural admin credential mismatch detected; actual password remains unverified.');
}
main().catch(error=>{
  // Never log Cloudflare response payloads or SQL result rows.
  console.error('Admin login audit BLOCKED: '+String(error?.message||'unknown').replace(/\n/g,' ').slice(0,180));
  process.exitCode=1;
});
