import {createHash} from 'node:crypto';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadIsolatedPreviewQaConfig} from './isolated-preview-qa-config.mjs';

export function isolatedSchedulerName(app){
  if(!/^kunonline-isolated-qa-\d+$/.test(app))throw new Error('QA_SCHEDULER_TARGET_UNSAFE');
  return app.replace('-qa-','-qa-sync-');
}

async function main(){
  const base=process.env.KUN_PREVIEW_QA_BASE_URL;
  const config=await loadIsolatedPreviewQaConfig(base);
  const app=config.match(/^name\s*=\s*"([^"]+)"/m)?.[1],name=isolatedSchedulerName(app);
  const id=process.env.KUN_PREVIEW_QA_D1_ID,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  const connection=process.env.KUN_PREVIEW_QA_EASYORDERS_CONNECTION_ID;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token||!/^CON-QA-EASYORDERS-\d+$/.test(connection||''))throw new Error('QA_CRON_RUNTIME_UNAVAILABLE');
  const api=async(method,path,body)=>{
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{
      method,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const payload=await response.json().catch(()=>({}));
    if(response.status===404&&method==='PUT'&&path===`workers/scripts/${name}/schedules`)return null;
    if(!response.ok||payload.success!==true)throw new Error(`QA_CRON_HTTP_${response.status}`);
    return payload.result;
  };
  if(process.argv[2]==='--cleanup'){
    await api('PUT',`workers/scripts/${name}/schedules`,[]);
    console.log(JSON.stringify({qaScheduler:name,qaCronDisabled:true,liveCronModified:false}));
    return;
  }
  const appSettings=await api('GET',`workers/scripts/${app}/settings`);
  const bindings=appSettings.bindings||[];
  if(bindings.filter(x=>x.type==='d1').length!==1||!bindings.some(x=>x.type==='d1'&&x.name==='DB'&&x.id===id)||bindings.some(x=>x.type==='service'))
    throw new Error('QA_CRON_APP_BINDING_MISMATCH');
  async function receipt(){
    const result=await api('POST',`d1/database/${id}/query`,{
      sql:'SELECT config_json FROM store_connections WHERE id=? AND client_id=? AND external_store_id=?',
      params:[connection,'QA-SYNTHETIC-TENANT','EO-SYNTHETIC-QA']
    });
    const cfg=JSON.parse(result?.[0]?.results?.[0]?.config_json||'null');
    if(cfg?.qaSynthetic!==true)throw new Error('QA_CRON_FIXTURE_SCOPE_MISMATCH');
    if(cfg.easyOrdersRecoveryLastError||['error','rate_limited'].includes(cfg.easyOrdersRecoveryLastStatus))throw new Error('QA_NATIVE_CRON_RECOVERY_FAILED');
    return cfg.easyOrdersRecoveryLastCronAt||null;
  }
  // Only after proving this app owns one isolated QA D1, seed two synthetic fingerprints.
  const fingerprint=label=>createHash('sha256').update(`${app}:${label}`).digest('hex');
  const expiredFingerprint=fingerprint('session-maintenance-expired'),validFingerprint=fingerprint('session-maintenance-valid');
  const expiryNow=Math.floor(Date.now()/1000);
  for(const [hash,expiry] of [[expiredFingerprint,expiryNow-60],[validFingerprint,expiryNow+3600]]){
    const inserted=await api('POST',`d1/database/${id}/query`,{sql:'INSERT INTO revoked_sessions (token_hash,expires_at) VALUES (?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at',params:[hash,expiry]});
    if(inserted?.[0]?.success!==true)throw new Error('QA_SESSION_MAINTENANCE_SEED_FAILED');
  }
  const before=await receipt();
  const dir=await mkdtemp(join(tmpdir(),'kun-qa-cron-'));
  let report;
  try{
    const path=join(dir,'wrangler.qa-sync.toml');
    await writeFile(path,`name = "${name}"\nmain = ${JSON.stringify(resolve('src/sync-scheduler-preview.js'))}\ncompatibility_date = "2026-08-23"\n[[services]]\nbinding = "APP_SYNC"\nservice = "${app}"\nentrypoint = "SyncEntrypoint"\n[triggers]\ncrons = ["*/5 * * * *"]\n`,{mode:0o600});
    try{await promisify(execFile)(resolve('node_modules/.bin/wrangler'),['deploy','--config',path,'--message','Isolated synthetic QA native Cron proof'],{timeout:180000,maxBuffer:16*1024*1024});}
    catch{throw new Error('QA_SCHEDULER_DEPLOY_FAILED');}
    const settings=await api('GET',`workers/scripts/${name}/settings`);
    const services=(settings.bindings||[]).filter(x=>x.type==='service');
    if(services.length!==1||services[0].name!=='APP_SYNC'||services[0].service!==app||services[0].entrypoint!=='SyncEntrypoint')
      throw new Error('QA_SCHEDULER_SERVICE_MISMATCH');
    const schedules=await api('GET',`workers/scripts/${name}/schedules`);
    if(schedules.schedules?.length!==1||schedules.schedules[0].cron!=='*/5 * * * *')throw new Error('QA_SCHEDULE_MISMATCH');
    const receipts=new Set(),deadline=Date.now()+25*60*1000;
    console.log(JSON.stringify({stage:'waiting-for-two-native-five-minute-QA-events',scheduler:name,app,liveCronExecutionProven:false}));
    while(Date.now()<deadline&&receipts.size<2){
      const value=await receipt();
      if(value&&value!==before&&!receipts.has(value)){
        receipts.add(value);
        console.log(JSON.stringify({stage:'native-QA-cron-receipt',receipt:value,count:receipts.size}));
      }
      if(receipts.size<2)await new Promise(resolve=>setTimeout(resolve,20000));
    }
    if(receipts.size!==2)throw new Error('QA_TWO_NATIVE_CRON_RECEIPTS_NOT_OBSERVED');
    const maintenance=await api('POST',`d1/database/${id}/query`,{
      sql:'SELECT COUNT(CASE WHEN token_hash=? THEN 1 END) AS expiredRemaining,COUNT(CASE WHEN token_hash=? THEN 1 END) AS validRemaining FROM revoked_sessions WHERE token_hash IN (?,?)',
      params:[expiredFingerprint,validFingerprint,expiredFingerprint,validFingerprint]
    });
    const maintenanceRows=maintenance?.[0]?.results?.[0];
    if(maintenance?.[0]?.success!==true||maintenanceRows?.expiredRemaining!==0||maintenanceRows?.validRemaining!==1)
      throw new Error('QA_NATIVE_SESSION_MAINTENANCE_NOT_PROVEN');
    report={kind:'ISOLATED_QA_NATIVE_CRON_PROVEN',scheduler:name,receipts:[...receipts],
      syntheticOnly:true,sessionMaintenanceProven:true,expiredSyntheticFingerprintRemoved:true,validSyntheticRevocationPreserved:true,liveCronExecutionProven:false,customerRowsModified:false};
  }finally{
    try{await api('PUT',`workers/scripts/${name}/schedules`,[]);}
    finally{await rm(dir,{recursive:true,force:true});}
  }
  console.log(JSON.stringify({...report,qaCronDisabled:true}));
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)
  main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'QA_NATIVE_CRON_FAILED',customerRowsModified:false}));process.exitCode=1;});
