/**
 * Kun Online primary admin recovery: operator-driven, never CI.
 *
 * Live D1 mutation only with --apply --backup-confirmed --owner-verified.
 * Run from a trusted interactive terminal. A credential and owner email
 * are NEVER provided as CLI args, workflow inputs, or recorded in logs.
 *
 * Usage:
 *  node scripts/admin-login-recovery.mjs --dry-run
 *  node scripts/admin-login-recovery.mjs --apply --backup-confirmed --owner-verified
 *  node scripts/admin-login-recovery.mjs --self-test
 *
 * Validating hash format is not validating the user's existing password.
 */
import {createInterface} from 'node:readline';
import {pbkdf2Sync,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';

const lowered=s=>String(s??'').trim().toLowerCase();
const hashPassword=password=>{
  const salt=randomBytes(16);
  const digest=pbkdf2Sync(password,salt,100000,32,'sha256');
  return 'pbkdf2$100000$'+salt.toString('base64')+'$'+digest.toString('base64');
};
const verifyHash=(password,hash)=>{
  const parts=String(hash??'').split('$');
  if(parts.length!==4||parts[0]!=='pbkdf2')return false;
  const rounds=Number(parts[1]);if(!Number.isSafeInteger(rounds)||rounds<1||rounds>500000)return false;
  try {
    const actual=pbkdf2Sync(password,Buffer.from(parts[2],'base64'),rounds,32,'sha256');
    const expected=Buffer.from(parts[3],'base64');
    return actual.length===expected.length&&timingSafeEqual(actual,expected);
  } catch {return false;}
};
const plans={
  lookup:"SELECT id,email,status,password FROM users WHERE lower(trim(email))=? AND role='admin' LIMIT 2",
  lock:"SELECT fails,locked_until FROM login_attempts WHERE email=? LIMIT 1",
  update:"UPDATE users SET password=? WHERE id=? AND role='admin' AND status='active' AND email=? AND password=?",
  clearLock:"DELETE FROM login_attempts WHERE email=?"
};
function assertIdentity(rows,wanted){
  if(!Array.isArray(rows)||rows.length!==1)throw Error('Exactly one administrator must match; no password changed');
  const row=rows[0];
  if(row.role&&row.role!=='admin')throw Error('Target account role mismatch');
  if(row.status!=='active')throw Error('Target administrator inactive; do not reset blindly');
  if(row.email!==wanted)throw Error('Admin email differs from canonical normalized login; manual review required');
  if(!row.id||!verifyHash('__format_probe__',row.password)&&!/^pbkdf2\$\d+\$/.test(String(row.password))) {
    throw Error('Stored administrator hash has incompatible format');
  }
  return row;
}
function d1id(){
  const config=readFileSync('wrangler.production.toml','utf8');
  const preview=/\[\[d1_databases\]\]\s*binding\s*=\s*"PREVIEW_DB"\s*database_name\s*=\s*"[^"]+"\s*database_id\s*=\s*"([^"]+)"/.exec(config)?.[1];
  if(!preview)throw Error('Canonical Preview DB binding not found');
  const worker=readFileSync('src/index-production-mobile-update.js','utf8');
  if(!worker.includes("const AUTH_PATHS=new Set(['/api/login','/api/me','/api/logout'])")||
     !worker.includes('const identity=await previewFetch(request,env)'))
    throw Error('Authentication source changed; do not recover against guessed database');
  return preview;
}
async function ask(prompt){
  if(!process.stdin.isTTY)throw Error('Interactive local terminal required');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  return await new Promise(resolve=>rl.question(prompt,v=>{rl.close();resolve(v);}));
}
async function secret(prompt){
  if(!process.stdin.isTTY||!process.stdin.setRawMode)throw Error('Interactive TTY with private input required');
  process.stdout.write(prompt);
  return await new Promise((resolve,reject)=>{
    const chunks=[];
    const finish=(error)=>{
      process.stdin.off('data',onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if(error)reject(error);else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData=(data)=>{
      for(const byte of Buffer.from(data)){
        if(byte===13||byte===10){finish();return;}
        if(byte===3){finish(Error('Operator canceled'));return;}
        if(byte===127||byte===8){
          if(chunks.length)chunks.pop();
        }else if(byte!==0&&byte!==27)chunks.push(Buffer.from([byte]));
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data',onData);
  });
}
async function run(){
  const flags=process.argv.slice(2);
  if(flags.length===1&&flags[0]==='--self-test'){
    const pwd='ExampleRecovery!2026';
    const value=hashPassword(pwd);
    if(!verifyHash(pwd,value)||verifyHash('wrong',value))throw Error('PBKDF2 mismatch');
    const row={id:'synthetic',email:'owner@example.test',status:'active',password:value};
    if(assertIdentity([row],row.email)!==row)throw Error('Identity guard failed');
    for(const data of [[],[row,row],[{...row,email:'UPPER@example.test'}],[{...row,status:'disabled'}]]){
      let blocked=false;try{assertIdentity(data,row.email);}catch{blocked=true;}
      if(!blocked)throw Error('Unsafe admin identity incorrectly accepted');
    }
    if(!plans.update.includes("AND role='admin'")||!plans.update.includes('AND password=?')||!plans.update.includes("AND status='active'"))
      throw Error('Compare-and-set constraints missing');
    console.log('Primary admin recovery offline: scoped identity, hash, conflict guards OK. No live access.');
    return;
  }
  if(flags.length===0)flags.push('--dry-run');
  if(!['--dry-run','--apply'].includes(flags[0])||new Set(flags).size!==flags.length)
    throw Error('Only --dry-run or --apply --backup-confirmed --owner-verified is supported');
  const apply=flags.includes('--apply');
  if(apply){
    if(flags.length!==3||!flags.includes('--backup-confirmed')||!flags.includes('--owner-verified'))
      throw Error('Recovery requires --apply --backup-confirmed --owner-verified');
  } else if(flags.length!==1)throw Error('Unexpected dry-run flags');
  if(process.env.CI==='true'||process.env.GITHUB_ACTIONS==='true')
    throw Error('Live account recovery is forbidden in CI');
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account||!token)throw Error('Cloudflare D1 scoped credentials are required locally');
  const db=d1id();
  const allowed=new Set([plans.lookup,plans.lock,plans.update,plans.clearLock]);
  async function query(sql,params=[]){
    if(!allowed.has(sql)||(!apply&&!sql.startsWith('SELECT ')))throw Error('D1 SQL denied by read-only/mutation policy');
    const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),15000);
    let response;
    try{
      response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/d1/database/'+encodeURIComponent(db)+'/query',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({sql,params}),signal:abort.signal
      });
    }finally{clearTimeout(timeout);}
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success===false||result.result?.[0]?.success===false||!result.result?.[0])
      throw Error('Cloudflare D1 operation failed (HTTP '+response.status+'); inspect without revealing response data');
    return result.result[0];
  }
  const email=lowered(await ask('Kun main admin email (kept local): '));
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Invalid email format');
  const original=assertIdentity((await query(plans.lookup,[email])).results,email);
  const locked=(await query(plans.lock,[email])).results||[];
  const lockUntil=Date.parse(locked[0]?.locked_until||'');
  const lockedNow=Number.isFinite(lockUntil)&&lockUntil>Date.now();
  console.log(JSON.stringify({canonical:'PREVIEW_DB',adminAccountMatched:true,role:'admin',active:true,
    lockActive:lockedNow,storedPasswordFormat:'pbkdf2',mode:apply?'privileged-recovery':'read-only',
    dataModified:false}));
  if(!apply)return;
  console.log('An authoritative D1 backup and out-of-band administrator ownership verification must already be completed.');
  const confirmation=await ask('Type RESET CANONICAL KUN ADMIN to proceed: ');
  if(confirmation!=='RESET CANONICAL KUN ADMIN')throw Error('Operator declined recovery');
  const password=await secret('New private admin password (not echoed; 12+ characters): ');
  if(password.length<12)throw Error('Recovery password must be 12+ characters');
  const confirm=await secret('Repeat the new private password: ');
  if(password!==confirm)throw Error('Passwords do not match');
  const newHash=hashPassword(password);
  const operation=await query(plans.update,[newHash,original.id,original.email,original.password]);
  if(Number(operation.meta?.changes)!==1){
    throw Error('Conditional update did not change exactly one administrator. Review D1 before further steps');
  }
  // Verify exactly the intended row was updated before clearing only its login lock.
  const verify=assertIdentity((await query(plans.lookup,[email])).results,email);
  if(verify.id!==original.id||verify.password!==newHash)
    throw Error('Recovery update verification FAILED; inspect canonical D1 immediately');
  await query(plans.clearLock,[email]);
  console.log('One canonical admin password hash changed and its login lock cleared. Fresh user login and /api/me must still be verified privately.');
}
run().catch(error=>{
  console.error('Kun admin recovery stopped: '+String(error?.message||'unknown').slice(0,180));
  process.exitCode=1;
});
