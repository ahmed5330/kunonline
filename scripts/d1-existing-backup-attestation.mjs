import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {inspectSqlExport} from './d1-backup-restore-rehearsal.mjs';
const live=new Set(['31cd5cdf-fc01-42d7-ba1e-571f3dd58495','c426601d-182f-486e-a5c1-bb1bca0ecb0b']);
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const sourceRun='40236505426';
// Exact source-export content fingerprints printed by the failed run before
// both independent copies passed import/re-export comparisons. No row values.
export const snapshots=Object.freeze([
 {source:'preview',tables:124,fingerprint:'fe8d7fe1180c3676e376fa5325c818a537bb4aa71bcd4f79d79c1364872d5544'},
 {source:'production',tables:107,fingerprint:'d8add91e2c79424a469e1c2555c6d7c9ef60c08d523418de92ae5550f133f7a5'}
]);
export function validateBackupIdentity(row,name){
 if(row?.name!==name||!/^kunonline-(?:backup|restore)-(?:preview|production)-20261025-40236505426$/.test(name)||!(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row?.uuid||''))||live.has(row.uuid))throw Error('EXISTING_COPY_IDENTITY_INVALID');
 return row.uuid;
}
export function validateSnapshotContents(data,expected){
 if(data?.integrity!=='ok'||data.contentFingerprint!==expected.fingerprint||Object.keys(data.manifest||{}).length!==expected.tables)throw Error('EXISTING_COPY_CONTENT_MISMATCH');
}
export async function metadataGet(fetcher,url,options,pause=ms=>new Promise(r=>setTimeout(r,ms))){
 if(options.method!=='GET')throw Error('ATTESTATION_ONLY_GET_ALLOWED');
 for(let attempt=0;attempt<4;attempt++){
  const response=await fetcher(url,options);
  if(![429,500,502,503,504].includes(response.status)||attempt===3)return response;
  await response.arrayBuffer();await pause(1000*2**attempt);
 }
}
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('ATTESTATION_RUNTIME_UNAVAILABLE');
 async function api(path){
  const response=await metadataGet(fetch,`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  const d=await response.json().catch(()=>({}));
  if(!response.ok||d.success!==true){console.error(JSON.stringify({stage:'metadata-failure',endpointFingerprint:hash(path),httpStatus:response.status,code:Number(d.errors?.[0]?.code)||0}));throw Error('ATTESTATION_METADATA_FAILED');}
  return d.result;
 }
 const wanted=new Map(snapshots.flatMap(source=>['backup','restore'].map(role=>[`kunonline-${role}-${source.source}-20261025-${sourceRun}`,{...source,role}]))),found=new Map();
 for(let page=1;page<=20&&found.size<4;page++){
  const rows=await api(`d1/database?per_page=100&page=${page}`);if(!Array.isArray(rows))throw Error('ATTESTATION_DATABASE_LIST_INVALID');
  for(const row of rows)if(wanted.has(row.name)){validateBackupIdentity(row,row.name);if(found.has(row.name)&&found.get(row.name).uuid!==row.uuid)throw Error('ATTESTATION_DUPLICATE_NAME');found.set(row.name,row);}
  if(rows.length<100)break;
 }
 if(found.size!==4)throw Error('ATTESTATION_COPIES_MISSING');
 const dir=await mkdtemp(join(tmpdir(),'kun-readonly-copy-attestation-')),reports=[];
 try{
  for(const [name,expected] of wanted){
   const row=found.get(name),id=validateBackupIdentity(row,name),cfg=join(dir,name+'.toml'),file=join(dir,name+'.sql');
   const info=await api(`d1/database/${id}`);validateBackupIdentity(info,name);
   await writeFile(cfg,`name = "kun-readonly-copy-attestation"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${name}"\ndatabase_id = "${id}"\n`,{mode:0o600});
   try{await promisify(execFile)(resolve('node_modules/.bin/wrangler'),['d1','export',name,'--remote','--output',file,'--config',cfg,'--skip-confirmation'],{timeout:300000,maxBuffer:64*1024*1024});}catch{throw Error('ATTESTATION_EXPORT_FAILED');}
   const data=await inspectSqlExport(file);validateSnapshotContents(data,expected);
   const report={source:expected.source,role:expected.role,name,tableCount:expected.tables,contentFingerprint:data.contentFingerprint,sourceExportContentsMatch:true};reports.push(report);console.log(JSON.stringify({stage:'existing-copy-content-proven',...report}));
  }
  const ids=new Set([...found.values()].map(x=>x.uuid)),workers=await api('workers/scripts');
  if(!Array.isArray(workers))throw Error('ATTESTATION_WORKER_LIST_INVALID');
  for(const worker of workers){
   if(!/^[A-Za-z0-9_-]+$/.test(worker.id||''))throw Error('ATTESTATION_WORKER_NAME_INVALID');
   const info=await api(`workers/scripts/${worker.id}/settings`),bindings=info.bindings||info.settings?.bindings;
   if(!Array.isArray(bindings))throw Error('ATTESTATION_BINDINGS_MISSING');
   if(bindings.some(x=>x.type==='d1'&&ids.has(x.id)))throw Error('ATTESTATION_COPY_BOUND_TO_WORKER');
  }
  console.log(JSON.stringify({kind:'EXISTING_D1_BACKUP_AND_RESTORE_ATTESTED',sourceRun,reports,allCopyContentsMatchSourceExport:true,allCopiesUnbound:true,customerRowsModified:false,newResourcesCreated:false,workersDeployed:false},null,2));
 }finally{await rm(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'ATTESTATION_FAILED',customerRowsModified:false}));process.exitCode=1;});
