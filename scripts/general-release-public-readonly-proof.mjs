// Fixed-origin public/metadata verification only. No D1 queries or customer sessions.
import {fullTrafficVersion} from './cloudflare-full-traffic-version.mjs';
const primary='31cd5cdf-fc01-42d7-ba1e-571f3dd58495',legacy='c426601d-182f-486e-a5c1-bb1bca0ecb0b';
const required=['growth-scenario','stock-catalog','operating-evidence','accounting-cod-quality','wallet-ledger-integrity'];
const origins=['https://app.kun-online.com','https://kunonline-preview.mr-a-mnaa.workers.dev'];
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 const expected={kunonline:process.env.EXPECTED_PRODUCTION_WORKER_VERSION,'kunonline-preview':process.env.EXPECTED_PREVIEW_WORKER_VERSION};
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token||Object.values(expected).some(x=>!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x||'')))throw Error('PUBLIC_PROOF_RUNTIME_INVALID');
 const sources={production:process.env.EXPECTED_PRODUCTION_SOURCE_SHA,preview:process.env.EXPECTED_PREVIEW_SOURCE_SHA};
 if(Object.values(sources).some(x=>!/^[a-f0-9]{40}$/.test(x||'')))throw Error('PUBLIC_PROOF_SOURCE_PINS_INVALID');
 async function api(worker,kind){
  if(!['kunonline','kunonline-preview','kunonline-sync-preview'].includes(worker)||!['settings','deployments','schedules'].includes(kind))throw Error('PUBLIC_PROOF_API_TARGET_UNSAFE');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/${kind}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const d=await r.json();if(!r.ok||d.success!==true)throw Error('PUBLIC_PROOF_METADATA_UNAVAILABLE');return d.result;
 }
 const versions={};
 for(const [worker,version] of Object.entries(expected)){
  versions[worker]=fullTrafficVersion(await api(worker,'deployments'));
  if(versions[worker]!==version)throw Error('PUBLIC_PROOF_WORKER_CHANGED');
 }
 const ps=(await api('kunonline','settings')).bindings||[],bs=(await api('kunonline-preview','settings')).bindings||[];
 if(!ps.some(x=>x.type==='d1'&&x.name==='DB'&&x.id===legacy)||!ps.some(x=>x.type==='d1'&&x.name==='PREVIEW_DB'&&x.id===primary)||!ps.some(x=>x.type==='service'&&x.name==='PREVIEW_APP'&&x.service==='kunonline-preview')||bs.filter(x=>x.type==='d1').length!==1||!bs.some(x=>x.type==='d1'&&x.name==='DB'&&x.id===primary))throw Error('PUBLIC_PROOF_CANONICAL_BINDINGS_CHANGED');
 const financialFlag=bs.find(x=>x.name==='FAOS_WRITE_ENABLED');
 if(financialFlag&&(financialFlag.type!=='plain_text'||String(financialFlag.text??financialFlag.value??'')!=='0'))throw Error('PUBLIC_PROOF_PREVIEW_FINANCIAL_POSTING_NOT_DISABLED');
 const scheduler=(await api('kunonline-sync-preview','settings')).bindings||[],cron=(await api('kunonline-sync-preview','schedules')).schedules||[];
 if(!scheduler.some(x=>x.type==='service'&&x.name==='APP_SYNC'&&x.service==='kunonline-preview'&&x.entrypoint==='SyncEntrypoint')||!['*/5 * * * *','*/15 * * * *','0 */2 * * *'].every(x=>cron.some(s=>s.cron===x))||(await api('kunonline-preview','schedules')).schedules?.length!==0)throw Error('PUBLIC_PROOF_SCHEDULER_CONFIGURATION_CHANGED');
 const reports=[];
 async function publicRequest(origin,path,method='GET'){
  if(!origins.includes(origin)||!path.startsWith('/'))throw Error('PUBLIC_PROOF_ORIGIN_UNSAFE');
  return fetch(origin+path+(path.includes('?')?'&':'?')+'releaseProof='+process.env.GITHUB_RUN_ID,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','Cache-Control':'no-cache',...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})});
 }
 for(const origin of origins){
  const r=await publicRequest(origin,'/api/preview/growth-release'),data=await r.json();
  if(r.status!==200||data.ok!==true||data.release!=='kun-growth-wallet-20261015-r1'||data.environment!=='preview'||!required.every(x=>data.capabilities?.includes(x))||Object.keys(data).some(x=>!['ok','release','capabilities','environment'].includes(x)))throw Error('PUBLIC_PROOF_RELEASE_HANDSHAKE_FAILED');
  let denied=0;
  for(const [path,method] of [['/api/growth/inventory-catalog','GET'],['/api/growth/operating-evidence','GET'],['/api/growth/scaling-readiness','GET'],['/api/growth/experiment/compare','GET'],['/api/growth/scenario/preview','POST'],['/api/accounting/faos/catalog','GET']]){
   if((await publicRequest(origin,path,method)).status!==401)throw Error('PUBLIC_PROOF_DATA_API_NOT_PROTECTED');denied++;
  }
  const htmlResponse=await publicRequest(origin,'/v2/'),html=await htmlResponse.text();
  if(!htmlResponse.ok||!['modules-v51-permission-navigation.js?v=51.17','modules-v122-dashboard-experience.js?v=122.3','modules-v127-subscriptions.js?v=127.22','modules-v150-growth-planner.js?v=150.0','modules-v96-finance-command-center.js?v=96.2'].every(x=>html.includes(x)))throw Error('PUBLIC_PROOF_SHELL_ASSETS_OUTDATED');
  const assetResponse=await publicRequest(origin,'/v2/modules-v122-dashboard-experience.js'),asset=await assetResponse.text();
  if(!assetResponse.ok||!asset.includes("const VERSION='122.3'")||!asset.includes('r?.querySelector(s)||null'))throw Error('PUBLIC_PROOF_DASHBOARD_FIX_MISSING');
  const calcResponse=await publicRequest(origin,'/v2/modules-v94-ecommerce-calculator.js'),calc=await calcResponse.text();
  if(!calcResponse.ok||!calc.includes("version:'96.3'")||!calc.includes('.kun96-inputs,.kun96-results{display:grid;grid-template-columns:minmax(0,1fr)'))throw Error('PUBLIC_PROOF_CALCULATOR_FIX_MISSING');
  reports.push({origin,metadataOnlyHandshake:true,anonymousDataApisDenied401:denied,shellAssetVersionsMatched:true,partialDashboardFixServed:true,calculatorPhoneFixServed:true});
 }
 const parity=await publicRequest(origins[0],'/health/preview-parity'),pd=await parity.json();
 if(parity.status!==401||pd.code!=='AUTH_REQUIRED')throw Error('PUBLIC_PROOF_PRIVATE_DIAGNOSTIC_EXPOSED');
 const updateResponse=await publicRequest(origins[0],'/api/mobile/app-update'),update=await updateResponse.json();
 if(!updateResponse.ok||Number(update.versionCode)!==149||update.versionName!=='2.9.18'||!/^[a-f0-9]{64}$/i.test(update.sha256||''))throw Error('PUBLIC_PROOF_ANDROID_FEED_INVALID');
 console.log(JSON.stringify({kind:'GENERAL_RELEASE_PUBLIC_READONLY_PROVEN',testedAt:new Date().toISOString(),sourcePins:sources,workerVersions:versions,fullTrafficOwnershipVerified:true,canonicalBindingsVerified:true,previewFinancialPostingOptInDisabled:true,cronConfigurationVerified:true,cronExecutionProvenByThisCheck:false,reports,privateParityDenied401:true,android:{versionCode:149,versionName:'2.9.18',sha256:update.sha256},canonicalSerializedInventoryActivated:false,existingInventoryConflictResolved:false,wefaqHistoricalCompletenessProven:false,customerRowsReturned:false,directD1Queries:false,customerRowsModified:false,cloudflareMutated:false}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'PUBLIC_PROOF_FAILED',customerRowsModified:false,cloudflareMutated:false}));process.exitCode=1;});
