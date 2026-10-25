import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {fullTrafficVersion} from './cloudflare-full-traffic-version.mjs';
import {summarizeCandidate} from './wefaq-readonly-scope-inventory.mjs';
const fingerprint=value=>createHash('sha256').update(String(value)).digest('hex');
export const AUDIT_CALLER_SHA256='8fbe7d498059a192ba5b24483719bf6f670c1f72cfd5d1f924a4eef508f25381';
export const expectedScope=Object.freeze({clientFingerprint:'719318eb4257a238f8dd5e65818122a0da906062f4788b4e70e945e9196b2dc2',storeFingerprint:'9381d0b26157bd6283d4c526e9d4baac139d103cc1bf5abc3e96cd1bbbec292d',connectionFingerprint:'975a5f7977c84755da82f3b732d6ff9b39bb850ad7e6713484378bb027d2457d',externalStoreFingerprint:'6bb4884d34c51ae38ce86b015c7573d3ce65b7dc4722d8b8819aea9a55befc7d'});
export const scopeMatches=report=>report?.upstreamIdentityVerified===true&&Object.entries(expectedScope).every(([key,value])=>report[key]===value);
export function auditCallerName(run){if(!/^\d{1,20}$/.test(run||''))throw Error('RPC_AUDIT_RUN_INVALID');return `kunonline-wefaq-readonly-${run}`;}
export function recentRange(highest){const to=Number(highest);if(!Number.isSafeInteger(to)||to<1)throw Error('RPC_AUDIT_HIGH_WATER_INVALID');return {from:Math.max(1,to-29),to};}
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,expected=process.env.KUN_EXPECTED_PREVIEW_VERSION;
 const name=auditCallerName(process.env.GITHUB_RUN_ID),database='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('RPC_AUDIT_RUNTIME_UNAVAILABLE');
 async function api(method,path,body){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(method==='DELETE'&&response.status===404)return null;
  const payload=await response.json().catch(()=>({}));if(!response.ok||payload.success!==true)throw Error('RPC_AUDIT_CLOUDFLARE_FAILED');return payload.result;
 }
 if(process.argv[2]==='--cleanup'){await api('DELETE',`workers/scripts/${name}`);console.log(JSON.stringify({auditCallerRemoved:true,customerWorkerModified:false}));return;}
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expected||''))throw Error('RPC_AUDIT_VERSION_REQUIRED');
 if(createHash('sha256').update(await readFile(resolve('sandbox/easyorders-readonly-audit-caller.mjs'))).digest('hex')!==AUDIT_CALLER_SHA256)throw Error('RPC_AUDIT_CALLER_SOURCE_CHANGED');
 async function ownership(){if(fullTrafficVersion(await api('GET','workers/scripts/kunonline-preview/deployments'))!==expected)throw Error('RPC_AUDIT_VERSION_CHANGED');}
 await ownership();
 const app=await api('GET','workers/scripts/kunonline-preview/settings');
 if(!(app.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id===database)||(app.bindings||[]).filter(x=>x.type==='d1').length!==1)throw Error('RPC_AUDIT_SOURCE_BINDING_CHANGED');
 async function scope(){
  const sql=`SELECT id,client_id,external_store_id,status,
   CASE WHEN json_valid(config_json) THEN COALESCE(json_extract(config_json,'$.kunStoreId'),json_extract(config_json,'$.storeId')) END AS config_store_id,
   CASE WHEN json_valid(config_json) THEN json_extract(config_json,'$.easyOrdersRecoveryHighestShortId') END AS highest,
   CASE WHEN json_valid(config_json) THEN json_extract(config_json,'$.easyOrdersRecoveryLastCronAt') END AS last_cron_at,
   CASE WHEN json_valid(config_json) THEN json_extract(config_json,'$.easyOrdersRecoveryLastPositiveControlAt') END AS positive_control_at,
   CASE WHEN json_valid(config_json) THEN json_extract(config_json,'$.easyOrdersRecoveryLastPositiveControlHttpStatus') END AS positive_control_http,
   CASE WHEN json_valid(config_json) THEN json_extract(config_json,'$.easyOrdersRecoveryLastPositiveControlIdentityVerified') END AS positive_control_identity
   FROM store_connections WHERE provider='easyorders' AND status='connected'`;
  const result=await api('POST',`d1/database/${database}/query`,{sql});
  const rows=result?.[0]?.results||[],matches=rows.filter(x=>fingerprint(x.id)===expectedScope.connectionFingerprint);
  if(matches.length!==1||!scopeMatches(summarizeCandidate(matches[0],{})))throw Error('RPC_AUDIT_SCOPE_OR_IDENTITY_CHANGED');
  return matches[0];
 }
 const selected=await scope(),range=recentRange(selected.highest),readToken=randomBytes(32).toString('hex');
 const dir=await mkdtemp(join(tmpdir(),'kun-live-readonly-rpc-'));
 const report={kind:'WEFAQ_READONLY_PROVIDER_COMPARISON',testedAt:new Date().toISOString(),sourceVersion:expected,...expectedScope,
  fromShortId:range.from,toShortId:range.to,requests:0,presentShortIds:[],missingShortIds:[],providerMissingShortIds:[],unconfirmedShortIds:[],ambiguousShortIds:[],httpStatusCounts:{},customerRowsModified:false,providerSecretsExposed:false,manualReplayExecuted:false};
 try{
  const cfg=join(dir,'wrangler.audit.toml');
  const variables={KUN_READONLY_AUDIT:'true',AUDIT_READ_TOKEN:readToken,AUDIT_EXPIRES_AT:String(Date.now()+15*60*1000),AUDIT_CLIENT_ID:selected.client_id,AUDIT_STORE_ID:selected.config_store_id,AUDIT_CONNECTION_ID:selected.id,AUDIT_MIN_SHORT_ID:String(range.from),AUDIT_MAX_SHORT_ID:String(range.to)};
  const text=`name = "${name}"\nmain = ${JSON.stringify(resolve('sandbox/easyorders-readonly-audit-caller.mjs'))}\ncompatibility_date = "2026-08-23"\n[[services]]\nbinding = "APP_AUDIT"\nservice = "kunonline-preview"\nentrypoint = "SyncEntrypoint"\n[vars]\n`+Object.entries(variables).map(([key,value])=>`${key} = ${JSON.stringify(String(value))}`).join('\n')+'\n[triggers]\ncrons = []\n[observability]\nenabled = false\n';
  await writeFile(cfg,text,{mode:0o600});
  try{await promisify(execFile)(resolve('node_modules/.bin/wrangler'),['deploy','--config',cfg],{timeout:180000,maxBuffer:8*1024*1024});}catch{throw Error('RPC_AUDIT_CALLER_DEPLOY_FAILED');}
  const settings=await api('GET',`workers/scripts/${name}/settings`),bindings=settings.bindings||[];
  if(bindings.some(x=>x.type==='d1')||bindings.filter(x=>x.type==='service').length!==1||!bindings.some(x=>x.type==='service'&&x.name==='APP_AUDIT'&&x.service==='kunonline-preview'&&x.entrypoint==='SyncEntrypoint'))throw Error('RPC_AUDIT_CALLER_BINDING_INVALID');
  const subdomain=(await api('GET','workers/subdomain')).subdomain;if(!/^[a-z0-9-]+$/i.test(subdomain||''))throw Error('RPC_AUDIT_SUBDOMAIN_INVALID');
  const url=`https://${name}.${subdomain}.workers.dev/audit`;
  let nextAllowed=Date.now();
  for(let from=range.from;from<=range.to;from+=10){
   while(Date.now()<nextAllowed)await new Promise(resolve=>setTimeout(resolve,Math.min(20000,nextAllowed-Date.now())));
   await ownership();await scope();
   const to=Math.min(range.to,from+9);let response;
   for(let attempt=0;attempt<15;attempt++){
    response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(150000),headers:{Authorization:`Bearer ${readToken}`,'Content-Type':'application/json'},body:JSON.stringify({fromShortId:from,toShortId:to})});
    if(response.status!==404)break;
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(!response?.ok)throw Error('RPC_AUDIT_CALL_FAILED');
   const result=await response.json();
   if(result.mode!=='read_only'||result.dbWritesAllowed!==false||result.recoveryPerformed!==false||!Array.isArray(result.checkedShortIds)||result.requests>10)throw Error('RPC_AUDIT_RESULT_INVALID');
   for(const field of ['presentShortIds','missingShortIds','providerMissingShortIds','unconfirmedShortIds','ambiguousShortIds']){
    if(!Array.isArray(result[field])||result[field].some(x=>!Number.isSafeInteger(x)||x<from||x>to))throw Error('RPC_AUDIT_RESULT_SCOPE_INVALID');
    report[field].push(...result[field]);
   }
   report.requests+=result.requests;
   for(const [status,count] of Object.entries(result.httpStatusCounts||{})){
    if(!/^\d{3}$/.test(status)||!Number.isSafeInteger(count)||count<0||count>10)throw Error('RPC_AUDIT_HTTP_METADATA_INVALID');
    report.httpStatusCounts[status]=(report.httpStatusCounts[status]||0)+count;
   }
   console.log(JSON.stringify({stage:'readonly-batch',fromShortId:from,toShortId:to,status:result.status,present:result.alreadyInKun,missing:result.missingInKun,unconfirmed:result.unconfirmedShortIds.length,httpStatusCounts:result.httpStatusCounts,customerRowsModified:false}));
   if(!['complete','complete_with_unconfirmed'].includes(result.status))throw Error('RPC_AUDIT_BATCH_STOPPED');
   nextAllowed=Date.now()+60000;
  }
  await ownership();
  report.comparisonComplete=report.unconfirmedShortIds.length===0&&report.ambiguousShortIds.length===0;
  report.allProviderOrdersInRangePresentInKun=report.comparisonComplete?report.missingShortIds.length===0:null;
  console.log(JSON.stringify(report,null,2));
 }finally{try{await api('DELETE',`workers/scripts/${name}`);}finally{await rm(dir,{recursive:true,force:true});}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'RPC_AUDIT_FAILED',customerRowsModified:false}));process.exitCode=1;});
