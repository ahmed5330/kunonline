import {isolatedQaIdentity} from './isolated-qa-runtime-identity.mjs';
import {loadIsolatedPreviewQaConfig} from './isolated-preview-qa-config.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
async function main(){
  const base=process.env.KUN_PREVIEW_QA_BASE_URL;
  const config=await loadIsolatedPreviewQaConfig(base);
  const app=config.match(/^name\s*=\s*"([^"]+)"/m)?.[1],identity=isolatedQaIdentity(process.env.GITHUB_RUN_ID,process.env.GITHUB_RUN_ATTEMPT);
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,id=process.env.KUN_PREVIEW_QA_D1_ID;
  if(app!==identity.app||!/^[a-f0-9]{32}$/i.test(account||'')||!token)
    throw Error('QA_RPC_RUNTIME_INVALID');
  const name=identity.audit;
  async function api(method,path,body){
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(method==='DELETE'&&response.status===404)return null;
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.success!==true)throw Error('QA_RPC_CLOUDFLARE_FAILED');
    return payload.result;
  }
  if(process.argv[2]==='--cleanup'){
    await api('DELETE',`workers/scripts/${name}`);
    console.log(JSON.stringify({qaAuditCallerRemoved:true,liveWorkerModified:false}));return;
  }
  const settings=await api('GET',`workers/scripts/${app}/settings`);
  if((settings.bindings||[]).filter(x=>x.type==='d1').length!==1||!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id===id)||(settings.bindings||[]).some(x=>x.type==='service'))
    throw Error('QA_RPC_APP_NOT_ISOLATED');
  const connection=identity.connection;
  async function snapshot(){
    const result=await api('POST',`d1/database/${id}/query`,{sql:'SELECT config_json,(SELECT COUNT(*) FROM orders) AS order_count FROM store_connections WHERE id=? AND client_id=?',params:[connection,'QA-SYNTHETIC-TENANT']});
    const row=result?.[0]?.results?.[0];
    if(!row||JSON.parse(row.config_json||'{}').qaSynthetic!==true)throw Error('QA_RPC_SYNTHETIC_SCOPE_MISSING');
    return JSON.stringify(row);
  }
  const before=await snapshot(),dir=await mkdtemp(join(tmpdir(),'kun-readonly-qa-rpc-'));
  const readToken=randomBytes(32).toString('hex');
  try{
    const cfg=join(dir,'wrangler.audit.toml');
    await writeFile(cfg,`name = "${name}"
main = ${JSON.stringify(resolve('sandbox/easyorders-readonly-audit-caller.mjs'))}
compatibility_date = "2026-08-23"
[[services]]
binding = "APP_AUDIT"
service = "${app}"
entrypoint = "SyncEntrypoint"
[vars]
KUN_READONLY_AUDIT = "true"
AUDIT_READ_TOKEN = "${readToken}"
AUDIT_EXPIRES_AT = "${Date.now()+600000}"
AUDIT_CLIENT_ID = "QA-SYNTHETIC-TENANT"
AUDIT_STORE_ID = "QA-SYNTHETIC-STORE"
AUDIT_CONNECTION_ID = "${connection}"
AUDIT_MIN_SHORT_ID = "1"
AUDIT_MAX_SHORT_ID = "3"
[triggers]
crons = []
[observability]
enabled = false
`,{mode:0o600});
    try{await promisify(execFile)(resolve('node_modules/.bin/wrangler'),['deploy','--config',cfg],{timeout:180000,maxBuffer:8*1024*1024});}
    catch{throw Error('QA_RPC_CALLER_DEPLOY_FAILED');}
    const caller=await api('GET',`workers/scripts/${name}/settings`),bindings=caller.bindings||[];
    if(bindings.some(x=>x.type==='d1')||bindings.filter(x=>x.type==='service').length!==1||!bindings.some(x=>x.type==='service'&&x.name==='APP_AUDIT'&&x.service===app&&x.entrypoint==='SyncEntrypoint'))
      throw Error('QA_RPC_CALLER_BINDING_INVALID');
    const host=new URL(base).hostname.split('.').slice(1).join('.'),url=`https://${name}.${host}/audit`;
    let report;
    for(let attempt=0;attempt<20;attempt++){
      const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${readToken}`,'Content-Type':'application/json'},body:JSON.stringify({clientId:'DO_NOT_OVERRIDE_SCOPE',fromShortId:1,toShortId:3})});
      if(response.status===404){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
      if(!response.ok)throw Error('QA_RPC_REQUEST_FAILED');
      report=await response.json();break;
    }
    if(report?.ok!==true||report.mode!=='read_only'||report.dbWritesAllowed!==false||report.recoveryPerformed!==false||report.requests!==3||report.alreadyInKun!==3||report.missingInKun!==0||report.unconfirmedShortIds?.length!==0)
      throw Error('QA_RPC_COMPARISON_FAILED');
    for(const forbidden of ['QA-PROVIDER','QA-SYNTHETIC','CON-QA','Synthetic QA Customer','01000000000','KUN_SYNTHETIC'])
      if(JSON.stringify(report).includes(forbidden))throw Error('QA_RPC_PRIVATE_DATA_EXPOSED');
    const denied=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"fromShortId":1,"toShortId":3}'});
    if(denied.status!==404)throw Error('QA_RPC_CALLER_AUTH_FAILED');
    if(await snapshot()!==before)throw Error('QA_RPC_MUTATED_QA_STATE');
    console.log(JSON.stringify({kind:'ISOLATED_READONLY_RPC_AUDIT_PROVEN',syntheticOnly:true,knownOrdersMatched:3,scopePinned:true,customerRowsModified:false,qaRowsModified:false,credentialsExposed:false}));
  }finally{
    try{await api('DELETE',`workers/scripts/${name}`);}
    finally{await rm(dir,{recursive:true,force:true});}
  }
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'QA_RPC_AUDIT_FAILED'}));process.exitCode=1;});
