/**
 * Narrowest Kun Super Admin diagnosis, read-only, ONE canonical D1, ONE login email.
 * Needs only Cloudflare D1 Read permission for canonical kunonline-preview.
 * Token/email must be passed through a trusted local environment, never PR/CI.
 * No credential attempts, password reset, user creation, deployment or write SQL.
 *
 * Run: node scripts/admin-login-canonical-readonly.mjs --read-only
 * Test: node scripts/admin-login-canonical-readonly.mjs --self-test
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';

const emailKey = value => String(value ?? '').trim().toLowerCase();

function hashCompatible(value) {
  const p=String(value??'').split('$');
  const rounds=Number(p[1]);
  if(p.length!==4||p[0]!=='pbkdf2'||!Number.isSafeInteger(rounds)||rounds<1||rounds>500000)
    return false;
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(p[2]||'')||!/^[A-Za-z0-9+/]+={0,2}$/.test(p[3]||''))
    return false;
  const salt=Buffer.from(p[2],'base64'),digest=Buffer.from(p[3],'base64');
  return salt.length===16&&digest.length===32;
}
function diagnose(users,locks,login,now=Date.now()) {
  if(!Array.isArray(users)||!Array.isArray(locks)||users.length>2||locks.length>1)
    throw Error('Identity or lock query returned ambiguous or oversized data');
  const match=users.length===1?users[0]:null;
  const duplicate=users.length>1;
  const exactEmail=!!match&&String(match.email)===login;
  const roleAdmin=!!match&&match.role==='admin';
  const active=!!match&&match.status==='active';
  const validHash=!!match&&hashCompatible(match.password);
  const lockUntil=locks[0]?.locked_until;
  const deadline=lockUntil?Date.parse(String(lockUntil)):null;
  if(lockUntil&&(!Number.isFinite(deadline)))throw Error('Invalid login lock timestamp');
  const locked=deadline!==null&&deadline>now;
  return {
    source:'canonical-preview-D1',readOnly:true,oneEmailOnly:true,
    accountFound:users.length>0,exactlyOneMatchingUser:!!match,
    duplicateNormalizedEmail:duplicate,storedEmailExactlyMatchesLogin:exactEmail,
    superAdminRole:roleAdmin,activeAccount:active,compatiblePasswordHash:validHash,
    loginTemporarilyLocked:locked,
    safeToUseStandardLogin:!!match&&!duplicate&&exactEmail&&roleAdmin&&active&&validHash&&!locked,
    actualPasswordVerified:false,passwordChanged:false,liveLoginVerified:false
  };
}
function canonicalDatabaseId() {
  const conf=fs.readFileSync('wrangler.production.toml','utf8');
  const section=conf.split('[[d1_databases]]').slice(1).find(s=>/^\s*binding\s*=\s*"PREVIEW_DB"\s*$/m.test(s.split(/\n\s*\[/)[0]));
  const id=/^\s*database_id\s*=\s*"([a-zA-Z0-9-]+)"\s*$/m.exec(section?.split(/\n\s*\[/)[0]||'')?.[1];
  if(!id)throw Error('Canonical D1 binding missing');
  const entry=fs.readFileSync('src/index-production-mobile-update.js','utf8');
  if(!entry.includes("const AUTH_PATHS=new Set(['/api/login','/api/me','/api/logout'])")||
     !entry.includes('const identity=await previewFetch(request,env)'))
    throw Error('Production auth routing changed; cannot infer canonical D1');
  return id;
}
async function promptEmail() {
  const preset=process.env.KUN_ADMIN_EMAIL;
  if(preset)return emailKey(preset);
  if(!process.stdin.isTTY)throw Error('Local administrator email required via KUN_ADMIN_EMAIL or interactive terminal');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  return await new Promise(resolve=>rl.question('Main Kun Admin login email: ',value=>{rl.close();resolve(emailKey(value));}));
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--self-test') {
    const password='pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const login='owner@example.test';
    const row={email:login,role:'admin',status:'active',password};
    const ok=diagnose([row],[],login);
    assert.equal(ok.safeToUseStandardLogin,true);
    assert.equal(ok.actualPasswordVerified,false);
    assert.equal(diagnose([],[],login).accountFound,false);
    assert.equal(diagnose([{...row,role:'client'}],[],login).superAdminRole,false);
    assert.equal(diagnose([{...row,email:login.toUpperCase()}],[],login).storedEmailExactlyMatchesLogin,false);
    assert.equal(diagnose([row,row],[],login).duplicateNormalizedEmail,true);
    assert.equal(diagnose([{...row,password:'bad'}],[],login).compatiblePasswordHash,false);
    assert.equal(diagnose([row],[{locked_until:'2099-01-01T00:00:00.000Z'}],login).loginTemporarilyLocked,true);
    console.log('Narrow canonical admin read-only audit offline tests PASS');
    return;
  }
  if(args.length!==1||args[0]!=='--read-only')throw Error('Only --read-only or --self-test allowed');
  if(process.env.CI==='true'||process.env.GITHUB_ACTIONS==='true')
    throw Error('Do not use live Cloudflare token with a pull request or CI job');
  const account=process.env.CLOUDFLARE_ACCOUNT_ID;
  const token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account||!token)throw Error('Cloudflare account and temporary D1 Read token required locally');
  const login=await promptEmail();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login))throw Error('Invalid login email');
  const database=canonicalDatabaseId();
  const sqlUsers='SELECT email,role,status,password FROM users WHERE lower(trim(email))=? LIMIT 3';
  const sqlLocks='SELECT locked_until FROM login_attempts WHERE email=? LIMIT 2';
  const permitted=new Set([sqlUsers,sqlLocks]);
  async function selectOnly(sql,param) {
    if(!permitted.has(sql)||typeof param!=='string'||param!==login)
      throw Error('Only fixed, parameterized, read-only administrator queries are authorized');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
    let response;
    try {
      response=await fetch(
        'https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+
        '/d1/database/'+encodeURIComponent(database)+'/query',{
          method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({sql,params:[param]}),signal:abort.signal
        });
    } finally {clearTimeout(timer);}
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.success!==true||data.result?.[0]?.success!==true||
      !Array.isArray(data.result?.[0]?.results))
      throw Error('Canonical D1 read denied or query/schema incompatible (HTTP '+response.status+')');
    return data.result[0].results;
  }
  const users=await selectOnly(sqlUsers,login);
  if(users.length>2)throw Error('More than two accounts match normalized email; stop and investigate');
  const locks=await selectOnly(sqlLocks,login);
  if(locks.length>1)throw Error('Multiple login lock rows found; investigate');
  const result=diagnose(users,locks,login);
  console.log('Redacted primary administrator diagnosis: '+JSON.stringify(result));
  if(!result.safeToUseStandardLogin)
    console.log('STOP: investigate reported mismatch or lock; no live data has been modified.');
  else console.log('Canonical admin record structurally valid; real password has NOT been verified.');
}
main().catch(error=>{
  console.error('Canonical admin diagnosis BLOCKED: '+String(error?.message||'unknown').replace(/\n/g,' ').slice(0,180));
  process.exitCode=1;
});
