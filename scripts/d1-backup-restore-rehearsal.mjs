import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export function classifyWranglerFailure(text){
  const categories=[];
  for(const [category,pattern] of [
    ['FOREIGN_KEY',/foreign key constraint failed/i],['UNIQUE_CONSTRAINT',/unique constraint failed/i],
    ['MISSING_TABLE',/no such table/i],['MISSING_COLUMN',/no such column/i],['EXISTING_OBJECT',/already exists/i],
    ['AUTHORIZATION',/not authorized|authentication error|unauthorized|permission denied/i],
    ['UNSUPPORTED',/not supported|unsupported/i],['FILE_SIZE',/file.{0,20}too large|maximum.{0,15}size/i],
    ['SYNTAX',/syntax error/i],['NETWORK',/fetch failed|network|timed? out|econn/i],
    ['CLI_INTERNAL',/cannot read properties|typeerror|referenceerror/i],
    ['INTERACTIVE_PROMPT',/non.interactive|cannot prompt|confirmation/i]
  ])if(pattern.test(text))categories.push(category);
  const codes=[...new Set((text.match(/\b(?:SQLITE|D1)_[A-Z_]+\b/g)||[]))];
  const apiCodes=[...text.matchAll(/\[code:\s*(\d+)\]/g)].map(x=>Number(x[1]));
  return {categories,codes,apiCodes};
}
export async function inspectSqlExport(file){
  try{
    const result=await execute('python3',[new URL('./d1-export-manifest.py',import.meta.url).pathname,file],{timeout:120000,maxBuffer:1024*1024});
    return JSON.parse(result.stdout);
  }catch{throw new Error('LOCAL_EXPORT_VALIDATION_FAILED');}
}
const hash=s=>createHash('sha256').update(s).digest('hex');
const sources=Object.freeze([
  {label:'preview',worker:'kunonline-preview',binding:'DB',id:'31cd5cdf-fc01-42d7-ba1e-571f3dd58495'},
  {label:'production',worker:'kunonline',binding:'DB',id:'c426601d-182f-486e-a5c1-bb1bca0ecb0b'}
]);
const liveIds=new Set(sources.map(x=>x.id));
const uuid=s=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s||'');
const tableName=s=>{
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s))throw new Error('UNSUPPORTED_TABLE_NAME');
  return `"${s}"`;
};

export async function rehearseD1Backup({api,cli,inspectExport,dir,runId,onProgress=()=>{}}){
  if(!/^\d{1,20}$/.test(runId||''))throw new Error('INVALID_RUN_ID');
  const created=new Map(),reports=[];
  // Prove both actual source bindings before exporting or creating anything.
  for(const source of sources){
    const settings=await api('GET',`workers/scripts/${source.worker}/settings`);
    const binding=(settings.bindings||settings.settings?.bindings||[]).find(x=>x.name===source.binding&&x.type==='d1');
    if(binding?.id!==source.id)throw new Error('SOURCE_BINDING_CHANGED');
  }
  async function target(role,source){
    const name=`kunonline-${role}-${source.label}-20261025-${runId}`;
    const result=await api('POST','d1/database',{name});
    if(!uuid(result.uuid)||liveIds.has(result.uuid)||created.has(result.uuid)||result.name!==name)
      throw new Error('UNSAFE_TARGET_IDENTITY');
    created.set(result.uuid,{name,role});
    const info=await api('GET',`d1/database/${result.uuid}`);
    if(info.uuid!==result.uuid||info.name!==name)throw new Error('TARGET_METADATA_MISMATCH');
    return {id:result.uuid,name,role};
  }
  async function config(database){
    const path=join(dir,`${database.name}.toml`);
    await writeFile(path,`name = "kunonline-backup-tool"\ncompatibility_date = "2026-08-23"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${database.name}"\ndatabase_id = "${database.id}"\n`,{mode:0o600});
    return path;
  }
  async function importAndVerify(database,file,manifest){
    if(liveIds.has(database.id)||!created.has(database.id))throw new Error('LIVE_IMPORT_FORBIDDEN');
    const path=await config(database);
    await cli(['d1','execute',database.name,'--remote','--file',file,'--config',path,'--yes']);
    const tables=Object.keys(manifest).sort();
    if(!tables.length)throw new Error('EMPTY_EXPORT_MANIFEST');
    const sql=tables.map(name=>`SELECT '${name}' AS table_name, COUNT(*) AS n FROM ${tableName(name)}`).join(' UNION ALL ');
    const result=await api('POST',`d1/database/${database.id}/query`,{sql,params:[]});
    if(!Array.isArray(result)||result.length!==1||result[0]?.success===false||!Array.isArray(result[0]?.results))
      throw new Error('RESTORE_VALIDATION_UNAVAILABLE');
    const actual=Object.fromEntries(result[0].results.map(row=>[row.table_name,Number(row.n)]));
    if(JSON.stringify(tables.map(x=>[x,actual[x]]))!==JSON.stringify(tables.map(x=>[x,manifest[x]])))
      throw new Error('RESTORE_ROW_COUNT_MISMATCH');
    return {databaseName:database.name,databaseFingerprint:hash(database.id),allTableCountsMatch:true,tableCount:tables.length};
  }
  for(const source of sources){
    onProgress({stage:'export-source',source:source.label});
    const bookmark=await api('GET',`d1/database/${source.id}/time_travel/bookmark`);
    const value=typeof bookmark==='string'?bookmark:bookmark?.bookmark;
    if(!value)throw new Error('SOURCE_BOOKMARK_UNAVAILABLE');
    const sourceConfig=await config({id:source.id,name:`kunonline-source-${source.label}`});
    const file=join(dir,`${source.label}.sql`);
    await cli(['d1','export',`kunonline-source-${source.label}`,'--remote','--output',file,'--config',sourceConfig,'--skip-confirmation']);
    const {manifest,dumpSha256,contentFingerprint,integrity,foreignKeyViolationCount,hasDeferredForeignKeys}=await inspectExport(file);
    onProgress({stage:'source-export-integrity',source:source.label,integrity,
      foreignKeyViolationCount:foreignKeyViolationCount??null,hasDeferredForeignKeys:hasDeferredForeignKeys??null});
    if(integrity!=='ok'||!/^[a-f0-9]{64}$/.test(dumpSha256)||!/^[a-f0-9]{64}$/.test(contentFingerprint))throw new Error('EXPORT_INTEGRITY_FAILED');
    for(const name of Object.keys(manifest))tableName(name);
    const backup=await target('backup',source);
    onProgress({stage:'restore-backup-copy',source:source.label,target:backup.name});
    const backupReport=await importAndVerify(backup,file,manifest);
    // Re-export the independent backup and restore THAT into a second unbound D1.
    const backupFile=join(dir,`${source.label}-backup.sql`),backupConfig=await config(backup);
    await cli(['d1','export',backup.name,'--remote','--output',backupFile,'--config',backupConfig,'--skip-confirmation']);
    const backupExport=await inspectExport(backupFile);
    if(backupExport.integrity!=='ok'||backupExport.contentFingerprint!==contentFingerprint||JSON.stringify(backupExport.manifest)!==JSON.stringify(manifest))
      throw new Error('BACKUP_EXPORT_MANIFEST_MISMATCH');
    const restored=await target('restore',source);
    onProgress({stage:'rehearse-independent-restore',source:source.label,target:restored.name});
    const restoreReport=await importAndVerify(restored,backupFile,manifest);
    const restoreFile=join(dir,`${source.label}-restored.sql`),restoreConfig=await config(restored);
    await cli(['d1','export',restored.name,'--remote','--output',restoreFile,'--config',restoreConfig,'--skip-confirmation']);
    const restoreExport=await inspectExport(restoreFile);
    if(restoreExport.integrity!=='ok'||restoreExport.contentFingerprint!==contentFingerprint||JSON.stringify(restoreExport.manifest)!==JSON.stringify(manifest))
      throw new Error('RESTORED_CONTENT_MISMATCH');
    reports.push({source:source.label,sourceDatabaseFingerprint:hash(source.id),
      sourceRecoveryBookmarkFingerprint:hash(value),dumpSha256,contentFingerprint,restoredContentsMatch:true,
      backup:backupReport,restore:restoreReport,independentBackupCreated:true,isolatedRestoreProven:true});
  }
  // All Workers, including those outside the three live entrypoints, must remain
  // unbound to these customer-data copies. They are NEVER synthetic QA stores.
  const workers=await api('GET','workers/scripts');
  if(!Array.isArray(workers))throw new Error('WORKER_BINDING_INVENTORY_UNAVAILABLE');
  for(const worker of workers){
    if(!/^[A-Za-z0-9_-]+$/.test(worker.id||''))throw new Error('INVALID_WORKER_NAME');
    const settings=await api('GET',`workers/scripts/${worker.id}/settings`);
    const bindings=settings.bindings||settings.settings?.bindings;
    if(!Array.isArray(bindings))throw new Error('WORKER_BINDINGS_UNAVAILABLE');
    if(bindings.some(x=>x.type==='d1'&&created.has(x.id)))throw new Error('BACKUP_DATABASE_BOUND_TO_WORKER');
  }
  return {kind:'D1_INDEPENDENT_BACKUP_AND_RESTORE_REHEARSAL',testedAt:new Date().toISOString(),reports,
    copiedDatabasesUnboundToWorkers:true,customerSourceRowsModified:false,workersDeployed:false,
    sourceCredentialsChanged:false,syntheticQaEnvironmentCreated:false};
}

async function main(){
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(accountId||'')||!token)throw new Error('CREDENTIALS_UNAVAILABLE');
  const dir=await mkdtemp(join(tmpdir(),'kun-private-d1-backup-'));
  const api=async(method,path,body)=>{
    if(!/^(?:workers\/scripts(?:\/[A-Za-z0-9_-]+\/settings)?|d1\/database(?:\/[a-f0-9-]{36}(?:\/query|\/time_travel\/bookmark)?)?)$/.test(path))throw new Error('UNEXPECTED_API_PATH');
    if(method==='POST'&&path!=='d1/database'&&!/^d1\/database\/[a-f0-9-]{36}\/query$/.test(path))throw new Error('UNEXPECTED_MUTATION');
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,{
      method,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.success!==true)throw new Error(`CLOUDFLARE_HTTP_${response.status}_CODE_${Number(payload.errors?.[0]?.code)||0}`);
    return payload.result;
  };
  const cli=async args=>{
    try{
      await execute(resolve('node_modules/.bin/wrangler'),args,{cwd:dir,env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:300000,maxBuffer:64*1024*1024});
    }catch(error){
      // Wrangler errors can include SQL/customer values. Only expose its operation and exit code.
      console.error(JSON.stringify({operation:args[1],exitCode:Number(error.code)||0,
        diagnostic:classifyWranglerFailure(String(error.stdout||'')+'\n'+String(error.stderr||''))}));
      throw new Error(`WRANGLER_${args[1].toUpperCase()}_FAILED_EXIT_${Number(error.code)||0}`);
    }
  };
  try{
    const result=await rehearseD1Backup({api,cli,inspectExport:inspectSqlExport,dir,runId:process.env.GITHUB_RUN_ID,
      onProgress:progress=>console.log(JSON.stringify(progress))});
    console.log(JSON.stringify(result,null,2));
  }finally{await rm(dir,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'BACKUP_REHEARSAL_FAILED',
    customerSourceRowsModified:false,workersDeployed:false}));process.exitCode=1;});
}
