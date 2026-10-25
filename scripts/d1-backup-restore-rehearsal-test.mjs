import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rehearseD1Backup,inspectSqlExport,classifyWranglerFailure,prepareChunkedImport} from './d1-backup-restore-rehearsal.mjs';

const live=['31cd5cdf-fc01-42d7-ba1e-571f3dd58495','c426601d-182f-486e-a5c1-bb1bca0ecb0b'];
const dir=await mkdtemp(join(tmpdir(),'kun-backup-regression-'));
let ids=new Map(),mutations=[],cliCalls=[],sourceMismatch=false,unsafeTarget=false,badContents=false,boundCopy=false;
let inspectCalls=0,queryManifest={orders:3,users:2};
async function api(method,path,body){
  if(method==='POST')mutations.push({path,body});
  if(path==='workers/scripts')return [{id:'kunonline'},{id:'kunonline-preview'}];
  if(path.endsWith('/settings'))return {bindings:[{name:'DB',type:'d1',id:boundCopy&&ids.size?[...ids.keys()][0]:path.includes('/kunonline-preview/')?(sourceMismatch?live[1]:live[0]):live[1]}]};
  if(path.endsWith('/time_travel/bookmark'))return {bookmark:'PRIVATE_SOURCE_RECOVERY_POINT'};
  if(method==='POST'&&path==='d1/database'){
    const id=unsafeTarget?live[0]:`11111111-2222-4333-8444-${String(ids.size+1).padStart(12,'0')}`;
    ids.set(id,body.name);return {uuid:id,name:body.name};
  }
  if(path.endsWith('/query')){
    const id=path.split('/')[2];
    assert.ok(!live.includes(id),'Never submit any SQL to a customer source database');
    assert.ok(ids.has(id),'Only inspect newly created targets');
    assert.match(body.sql,/^SELECT /);
    assert.doesNotMatch(body.sql,/INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE/);
    const selected=[...body.sql.matchAll(/SELECT '([^']+)' AS table_name/g)].map(x=>x[1]);
    assert.ok(selected.length<=10,'Bound compound count validation to ten tables');
    return [{success:true,results:selected.map(name=>({table_name:name,n:queryManifest[name]}))}];
  }
  const id=path.split('/')[2];return {uuid:id,name:ids.get(id)};
}
async function cli(args){
  cliCalls.push(args);
  const config=await readFile(args[args.indexOf('--config')+1],'utf8');
  const id=config.match(/database_id = "([^"]+)"/)[1];
  if(args[1]==='execute'){
    assert.ok(ids.has(id)&&!live.includes(id),'Every import must target a newly created non-live D1');
    assert.ok(args[2].startsWith('kunonline-backup-')||args[2].startsWith('kunonline-restore-'));
  }else assert.equal(args[1],'export');
}
const inspectExport=async()=>({manifest:{orders:3,users:2},dumpSha256:'a'.repeat(64),integrity:'ok',contentFingerprint:badContents&&++inspectCalls>1?'b'.repeat(64):'c'.repeat(64)});
const options={api,cli,inspectExport,dir,runId:'12345'};
try{
  const diagnostic=classifyWranglerFailure('PRIVATE_CUSTOMER_SECRET foreign key constraint failed SQLITE_CONSTRAINT [code: 7500]');
  assert.deepEqual(diagnostic,{categories:['FOREIGN_KEY'],codes:['SQLITE_CONSTRAINT'],apiCodes:[7500]});
  assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE_CUSTOMER_SECRET'));
  const sqlPath=join(dir,'synthetic.sql');
  await writeFile(sqlPath,"CREATE TABLE orders(id TEXT, amount INTEGER); INSERT INTO orders VALUES('fake-1',100),('fake-2',200);");
  const original=await inspectSqlExport(sqlPath);
  assert.deepEqual(original.manifest,{orders:2});
  assert.equal(original.integrity,'ok');
  await writeFile(sqlPath,"CREATE TABLE orders(id TEXT, amount INTEGER); INSERT INTO orders VALUES('fake-2',200),('fake-1',100);");
  assert.equal((await inspectSqlExport(sqlPath)).contentFingerprint,original.contentFingerprint,'Content verification ignores insertion order');
  await writeFile(sqlPath,"CREATE TABLE orders(id TEXT, amount INTEGER); INSERT INTO orders VALUES('fake-2',201),('fake-1',100);");
  assert.notEqual((await inspectSqlExport(sqlPath)).contentFingerprint,original.contentFingerprint,'Same row count with changed values must fail content verification');
  const longValue="Unicode\nأهلاً ' quoted ".repeat(8000),blob='00ff'.repeat(20000);
  await writeFile(sqlPath,`CREATE TABLE parent(id TEXT PRIMARY KEY, payload TEXT, binary BLOB); CREATE TABLE child(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id)); INSERT INTO parent VALUES('one','${longValue.replaceAll("'","''")}',X'${blob}'); INSERT INTO child VALUES('child','one');`);
  const large=await inspectSqlExport(sqlPath),bounded=await prepareChunkedImport(sqlPath);
  assert.equal(bounded.rewrittenInsertCount,1);
  assert.ok(bounded.largestOriginalStatementBytes>100000);
  assert.equal((await inspectSqlExport(bounded.file)).contentFingerprint,large.contentFingerprint,'Large text/BLOB values, quotes, newlines and relationships must survive bounded import exactly');
  assert.ok(!(await readFile(bounded.file,'utf8')).includes('BEGIN TRANSACTION;'));
  const report=await rehearseD1Backup(options);
  assert.equal(ids.size,4);
  assert.equal(cliCalls.filter(x=>x[1]==='execute').length,4);
  assert.equal(report.copiedDatabasesUnboundToWorkers,true);
  assert.equal(report.customerSourceRowsModified,false);
  assert.ok(report.reports.every(x=>x.restoredContentsMatch&&x.isolatedRestoreProven));
  for(const secret of [...live,'PRIVATE_SOURCE_RECOVERY_POINT'])assert.ok(!JSON.stringify(report).includes(secret));
  ids=new Map();queryManifest=Object.fromEntries(Array.from({length:24},(_,i)=>['table_'+i,i]));
  await rehearseD1Backup({...options,inspectExport:async()=>({manifest:queryManifest,dumpSha256:'a'.repeat(64),contentFingerprint:'c'.repeat(64),integrity:'ok'})});
  queryManifest={orders:3,users:2};
  ids=new Map();mutations=[];sourceMismatch=true;
  await assert.rejects(rehearseD1Backup(options),/SOURCE_BINDING_CHANGED/);
  assert.equal(mutations.length,0,'Verify all source bindings before creating resources');
  sourceMismatch=false;unsafeTarget=true;cliCalls=[];
  await assert.rejects(rehearseD1Backup(options),/UNSAFE_TARGET_IDENTITY/);
  assert.ok(cliCalls.every(x=>x[1]==='export'),'An unsafe target must never be imported into');
  unsafeTarget=false;ids=new Map();badContents=true;inspectCalls=0;
  await assert.rejects(rehearseD1Backup(options),/BACKUP_EXPORT_MANIFEST_MISMATCH/);
  badContents=false;ids=new Map();boundCopy=true;
  await assert.rejects(rehearseD1Backup(options),/BACKUP_DATABASE_BOUND_TO_WORKER/);
  console.log('PASS: backup/restore writes only new D1 targets; source binding, full-content fingerprint, row counts, live import rejection and unbound copies enforced. Offline only.');
}finally{await rm(dir,{recursive:true,force:true});}
