import {isolatedQaRunSuffix,waitForIsolatedQaAsset} from './isolated-qa-runtime-identity.mjs';
import {mkdtemp,writeFile,appendFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {encryptSecret} from '../src/integration-secrets.js';
import {assertIsolatedEasyOrdersQa} from './easyorders-qa-isolation-guard.mjs';
import {SYNTHETIC_API_KEY,SYNTHETIC_EXTERNAL_STORE} from '../sandbox/easyorders-synthetic-provider.mjs';

const execute=promisify(execFile);
const sourceId='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';
const liveIds=new Set([sourceId,'c426601d-182f-486e-a5c1-bb1bca0ecb0b']);
const sha=s=>createHash('sha256').update(s).digest('hex');
export function validateNewQaDatabase(database,name){
  if(database.name!==name||!/^kunonline-isolated-qa-\d+$/.test(name)||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database.uuid||'')||liveIds.has(database.uuid))
    throw new Error('QA_DATABASE_IDENTITY_UNSAFE');
}

async function main(){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,runId=process.env.GITHUB_RUN_ID;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token||!/^\d{1,20}$/.test(runId||''))throw new Error('QA_RUNTIME_UNAVAILABLE');
  const api=async(method,path,body)=>{
    if(!/^[A-Za-z0-9_\/-]+$/.test(path))throw new Error('QA_INVALID_API_PATH');
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{
      method,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.success!==true)throw new Error(`QA_CLOUDFLARE_HTTP_${response.status}_CODE_${Number(payload.errors?.[0]?.code)||0}`);
    return payload.result;
  };
  const settings=await api('GET','workers/scripts/kunonline-preview/settings');
  if(!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id===sourceId))throw new Error('QA_SOURCE_SCHEMA_BINDING_CHANGED');
  const name=`kunonline-isolated-qa-${isolatedQaRunSuffix(runId,process.env.GITHUB_RUN_ATTEMPT)}`;
  const database=await api('POST','d1/database',{name});
  validateNewQaDatabase(database,name);
  const temporary=await mkdtemp(join(tmpdir(),'kun-schema-only-'));
  // QA config must outlive provisioning because later job steps use it.
  const configDir=await mkdtemp(join(tmpdir(),'kun-isolated-qa-runtime-'));
  const cli=async args=>{
    try{await execute(resolve('node_modules/.bin/wrangler'),args,{env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:300000,maxBuffer:64*1024*1024});}
    catch{throw new Error(`QA_WRANGLER_${args[1].toUpperCase()}_FAILED`);}
  };
  const query=async(sql,params=[])=>{
    if(liveIds.has(database.uuid))throw new Error('QA_LIVE_SQL_FORBIDDEN');
    const result=await api('POST',`d1/database/${database.uuid}/query`,{sql,params});
    if(!Array.isArray(result)||result.some(x=>x.success===false))throw new Error('QA_QUERY_FAILED');
    return result[0]?.results||[];
  };
  try{
    const sourceConfig=join(temporary,'source-schema.toml'),schema=join(temporary,'schema-only.sql');
    await writeFile(sourceConfig,`name = "kunonline-schema-reader"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "kunonline-schema-source"\ndatabase_id = "${sourceId}"\n`,{mode:0o600});
    await cli(['d1','export','kunonline-schema-source','--remote','--no-data','--output',schema,'--config',sourceConfig,'--skip-confirmation']);
    const sessionSecret=randomBytes(32).toString('hex');
    const candidateSha=(await execute('git',['rev-parse','HEAD'])).stdout.trim();
    if(!/^[a-f0-9]{40}$/.test(candidateSha))throw new Error('QA_SOURCE_SHA_MISSING');
    const config=join(configDir,'wrangler.qa.toml');
    const configText=`name = "${name}"
main = ${JSON.stringify(resolve('sandbox/preview-isolated-worker.mjs'))}
compatibility_date = "2026-08-23"
[assets]
directory = ${JSON.stringify(resolve('public'))}
binding = "ASSETS"
run_worker_first = ["/", "/index.html", "/v2", "/v2/", "/v2/index.html"]
[[d1_databases]]
binding = "DB"
database_name = "${name}"
database_id = "${database.uuid}"
[vars]
APP_ENV = "preview"
KUN_ISOLATED_QA = "true"
KUN_CANDIDATE_SHA = "${candidateSha}"
SESSION_SECRET = "${sessionSecret}"
EASYORDERS_TARGETED_RECOVERY_ENABLED = "true"
TRACKING_PROVIDER = "track123"
META_GRAPH_API_VERSION = "v25.0"
[triggers]
crons = []
[ai]
binding = "AI"
`;
    const subdomain=(await api('GET','workers/subdomain')).subdomain;
    if(!/^[a-z0-9-]+$/i.test(subdomain||''))throw new Error('QA_WORKERS_SUBDOMAIN_UNAVAILABLE');
    const base=`https://${name}.${subdomain}.workers.dev`;
    assertIsolatedEasyOrdersQa({baseUrl:base,configText,approvedDatabaseId:database.uuid});
    await writeFile(config,configText,{mode:0o600});
    await cli(['d1','execute',name,'--remote','--file',schema,'--config',config,'--yes']);
    const counts=await query('SELECT (SELECT COUNT(*) FROM orders) AS orders_count, (SELECT COUNT(*) FROM users) AS users_count, (SELECT COUNT(*) FROM store_connections) AS connections_count');
    if(!counts.length||Object.values(counts[0]).some(x=>Number(x)!==0))throw new Error('QA_SCHEMA_EXPORT_CONTAINED_CUSTOMER_ROWS');
    const clientId='QA-SYNTHETIC-TENANT',storeId='QA-SYNTHETIC-STORE',connectionId=`CON-QA-EASYORDERS-${runId}`,at=new Date().toISOString();
    const fixtureClient='PREVIEW-STORE-001';
    const fixtureState={agency:{name:'Synthetic QA Agency',adminEmail:'qa@example.test'},clients:[
      {id:fixtureClient,name:'Synthetic Store A/B tenant',status:'active',walletFeePerOrder:0,walletBalance:0},
      {id:clientId,name:'Synthetic Easy Orders tenant',status:'active',walletFeePerOrder:0,walletBalance:0}
    ],entries:[],funding:[]};
    await query('INSERT INTO state (id,json,updated_at) VALUES (1,?,?)',[JSON.stringify(fixtureState),at]);
    for(const [id,code] of [['STR-CD14EDC5','QA-A'],['STR-EEA6FD86','QA-B']])
      await query('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id,fixtureClient,`Synthetic ${code}`,code,'EGP','Africa/Cairo','active',id==='STR-CD14EDC5'?1:0,at,at]);
    await query('INSERT INTO stores (id,client_id,name,code,currency,timezone,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [storeId,clientId,'Synthetic isolated QA','SYNTHETIC','EGP','Africa/Cairo','active',1,at,at]);
    const cfg={kunStoreId:storeId,qaSynthetic:true,orderSyncMode:'since_connection',orderSyncStartedAt:'2026-10-24T00:00:00Z',
      webhookLastShortId:3,easyOrdersRecoveryHighestShortId:3,easyOrdersRecoveryCursor:1};
    await query('INSERT INTO store_connections (id,client_id,provider,store_name,external_store_id,status,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [connectionId,clientId,'easyorders','Synthetic provider fixture',SYNTHETIC_EXTERNAL_STORE,'connected',JSON.stringify(cfg),at,at]);
    const encrypted=await encryptSecret({APP_ENV:'preview',SESSION_SECRET:sessionSecret},SYNTHETIC_API_KEY);
    await query('INSERT INTO integration_secrets (id,client_id,connection_id,secret_name,ciphertext_b64,iv_b64,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [`QA-SECRET-${runId}`,clientId,connectionId,'api_key',encrypted.ciphertextB64,encrypted.ivB64,at,at]);
    await cli(['deploy','--config',config,'--message',`Synthetic isolated QA candidate ${candidateSha}`]);
    const actual=await api('GET',`workers/scripts/${name}/settings`);
    const actualBindings=actual.bindings||[];
    const d1=actualBindings.filter(x=>x.type==='d1');
    if(d1.length!==1||d1[0].id!==database.uuid||d1[0].name!=='DB'||actualBindings.some(x=>x.type==='service'))
      throw new Error('QA_DEPLOYED_ISOLATION_MISMATCH');
    await waitForIsolatedQaAsset({base,expectedBytes:await readFile(resolve('public/v2/modules-v106-manual-jnt-order.js'))});
    console.log(`::add-mask::${database.uuid}`);
    if(!process.env.GITHUB_ENV)throw new Error('QA_JOB_ENVIRONMENT_UNAVAILABLE');
    await appendFile(process.env.GITHUB_ENV,`KUN_PREVIEW_QA_WRANGLER_CONFIG=${config}\nKUN_PREVIEW_QA_D1_ID=${database.uuid}\nKUN_PREVIEW_QA_BASE_URL=${base}\nKUN_PREVIEW_QA_EASYORDERS_CONNECTION_ID=${connectionId}\nKUN_PREVIEW_QA_SOURCE_SHA=${candidateSha}\n`);
    console.log(JSON.stringify({kind:'ISOLATED_SYNTHETIC_QA_PROVISIONED',worker:name,baseUrl:base,sourceSha:candidateSha,
      databaseFingerprint:sha(database.uuid),actualD1BindingVerified:true,serviceBindings:0,
      customerRowsCopied:false,liveWorkersDeployed:false,liveCredentialsUsedForProvider:false}));
  }finally{await rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)
  main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'QA_PROVISIONING_FAILED',liveWorkersDeployed:false}));process.exitCode=1;});
