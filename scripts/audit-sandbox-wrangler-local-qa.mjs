/* Runs the auth-only Worker in REAL local Wrangler/workerd + local D1.
 * STRICTLY NO Cloudflare remote calls: --local on EVERY resource CLI command,
 * blank Cloudflare env credentials, new synthetic UUID/name, localhost only.
 * This is not a real deployed Cloudflare Sandbox or Production verification.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyAuditSandboxConfig} from './verify-audit-sandbox-config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFile(join(root,name),'utf8');
const noCloud={...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',
  CLOUDFLARE_ACCOUNT_ID:'',WRANGLER_SEND_METRICS:'false'};
const wrangler=join(root,'node_modules','.bin','wrangler');
const port=18764,base='http://127.0.0.1:'+port;
const qaKey='FAKE-LOCAL-ONLY-'+randomBytes(32).toString('hex');
const name='kunonline-audit-sandbox-local-'+randomBytes(4).toString('hex');
const dbName='kunonline-audit-db-local-'+randomBytes(4).toString('hex');
const dir=await mkdtemp(join(tmpdir(),'kun-audit-workerd-local-'));
const configPath=join(root,'.kun-audit-workerd-'+process.pid+'.toml');
let child=null,out='',err='';
const short=(text,max=900)=>String(text||'').slice(-max)
  .replaceAll(qaKey,'[REDACTED_TEST_KEY]');
const command=(args,timeout=60000)=>{
  assert.ok(args.includes('--local'),'A Wrangler command without --local is FORBIDDEN');
  assert.ok(!args.includes('--remote'),'Never permit Wrangler remote commands');
  assert.ok(!args.includes('deploy')&&!args.includes('publish'),'Never deploy via QA');
  const res=spawnSync(wrangler,args,{cwd:root,env:noCloud,encoding:'utf8',timeout,maxBuffer:1024*1024});
  if(res.error||res.status!==0)
    throw Error('Local Wrangler command failed: '+args.slice(0,4).join(' ')+'\n'+short(res.stderr)+'\n'+short(res.stdout));
  return short(res.stdout);
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  const [template,production,preview]=await Promise.all([
    read('wrangler.audit-sandbox.example.toml'),read('wrangler.production.toml'),read('wrangler.preview.toml')
  ]);
  const config=template
    .replace('REPLACE_WITH_UNIQUE_AUDIT_WORKER_NAME',name)
    .replace('REPLACE_WITH_NEW_AUDIT_D1_NAME',dbName)
    .replace('REPLACE_WITH_NEW_D1_UUID',randomUUID());
  const report=verifyAuditSandboxConfig(config,production,preview);
  assert.equal(report.offlineOnly,true);
  assert.equal(report.runtimeIsolationVerified,false);
  await writeFile(configPath,config,'utf8');
  // The migration directory is ONLY sandbox/migrations, never main migrations.
  command(['d1','migrations','apply','DB','--local','--config',configPath,'--persist-to',dir]);
  child=spawn(wrangler,['dev','--local','--config',configPath,
      '--persist-to',dir,'--ip','127.0.0.1','--port',String(port),
      '--var','AUDIT_QA_KEY:'+qaKey],{
    cwd:root,env:noCloud,stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',v=>{out=short(out+String(v),2500);});
  child.stderr.on('data',v=>{err=short(err+String(v),2500);});
  let live=false;
  for(let i=0;i<65;i++){
    if(child.exitCode!==null)break;
    try{
      const resp=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1200)});
      if(resp.ok){const result=await resp.json();assert.equal(result.kind,'isolated_auth_sandbox');live=true;break;}
    }catch{}
    await sleep(350);
  }
  if(!live)throw Error('Local workerd did not start on localhost: '+short(err)+' / '+short(out));
  const invoke=async(path,method='GET',authorized=false)=>{
    const resp=await fetch(base+path,{method,headers:authorized?{'X-Audit-QA-Key':qaKey}:{}});
    return {status:resp.status,body:await resp.json(),cookie:resp.headers.get('set-cookie')};
  };
  assert.equal((await invoke('/api/orders','POST')).status,404);
  assert.equal((await invoke('/api/logout','POST')).status,404);
  assert.equal((await invoke('/qa/revocation-selftest','POST')).status,403);
  let checked=await invoke('/qa/revocation-selftest','POST',true);
  assert.equal(checked.status,200,'Isolated D1 reads/writes and replay must work in real local workerd');
  assert.equal(checked.body.checks.afterLogoutRevoked,true);
  assert.equal(checked.body.checks.dualD1WritesAtomic,true);
  assert.equal(checked.cookie,null,'No session cookies or real user logins in QA runtime');
  checked=await invoke('/qa/revocation-selftest','POST',true);
  assert.equal(checked.status,200,'Two separate synthetic logouts must succeed');
  assert.doesNotMatch(JSON.stringify(checked.body),/token_hash|revoked_at|session_secret|KUN_AUDIT_SYNTHETIC/i);
  // Only aggregate counts; never retrieve or output hash rows.
  const sqlCounts=command(['d1','execute','DB','--local','--config',configPath,
    '--persist-to',dir,'--command',
    'SELECT COUNT(*) AS n FROM revoked_sessions;']);
  assert.ok(/\b2\b/.test(sqlCounts),'Actual local D1 should contain two synthetic legacy revocations');
  const sqlCanonical=command(['d1','execute','DB','--local','--config',configPath,
    '--persist-to',dir,'--command',
    'SELECT COUNT(*) AS n FROM revoked_session_tokens;']);
  assert.ok(/\b2\b/.test(sqlCanonical),'Actual local D1 should contain two synthetic canonical revocations');
  console.log('REAL LOCAL WORKER+D1 QA PASS: Wrangler workerd, isolated migration, two atomic fake revocations, denied commerce routes and unauthenticated access. NO CLOUD ACCESS.');
}catch(error){
  // Local Wrangler may not be compatible with this runner. This is a real
  // error; no silent skip or fake success.
  console.error('REAL LOCAL WORKER+D1 QA FAILED:',short(error?.message||error));
  process.exitCode=1;
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await sleep(700);if(child.exitCode===null)child.kill('SIGKILL');}
  await rm(configPath,{force:true}).catch(()=>{});
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
}
