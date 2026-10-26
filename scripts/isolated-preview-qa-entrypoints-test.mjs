import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadIsolatedPreviewQaConfig} from './isolated-preview-qa-config.mjs';

const execute=promisify(execFile);
const entries=JSON.parse(await readFile(new URL('./isolated-preview-qa-entrypoints.json',import.meta.url),'utf8'));
const dir=await mkdtemp(join(tmpdir(),'kun-isolation-regression-'));
const safeId='11111111-2222-4333-8444-555555555555';
const safeConfig=`name = "kunonline-isolated-qa"
main = "src/index-commerce-v38.js"
[[d1_databases]]
binding = "DB"
database_name = "kunonline-isolated-qa"
database_id = "${safeId}"`;
const configPath=join(dir,'qa.toml');
const env={KUN_PREVIEW_QA_WRANGLER_CONFIG:configPath,KUN_PREVIEW_QA_D1_ID:safeId};
const target='https://kunonline-isolated-qa.example.test';
try{
  await writeFile(configPath,safeConfig);
  assert.equal(await loadIsolatedPreviewQaConfig(target,{env}),safeConfig);
  await assert.rejects(loadIsolatedPreviewQaConfig(target,{env:{...env,KUN_EASYORDERS_QA_D1_ID:'DIFFERENT'}}),/conflicting/);
  await assert.rejects(loadIsolatedPreviewQaConfig('https://different-qa.example.test',{env}),/exact HTTPS origin/);
  for(const unsafe of [
    safeConfig.replaceAll(safeId,'c426601d-182f-486e-a5c1-bb1bca0ecb0b'),
    safeConfig+'\n[env.production]\nname = "kunonline"',
    safeConfig+'\n[[services]]\nbinding = "OTHER"\nservice = "another-live-worker"'
  ]){
    await writeFile(configPath,unsafe);
    await assert.rejects(loadIsolatedPreviewQaConfig(target,{env}),/ISOLATION_REQUIRED/);
  }
  const trap=join(dir,'network-trap.mjs');
  await writeFile(trap,"globalThis.fetch=()=>{throw new Error('NETWORK_ATTEMPT_BEFORE_ISOLATION');};\n");
  const acceptedTrap=join(dir,'accepted-target-trap.mjs');
  await writeFile(acceptedTrap,"globalThis.fetch=()=>{process.stderr.write('QA_GUARD_ACCEPTED_REQUEST\\n');process.exit(86);};\n");
  await writeFile(configPath,safeConfig);
  const childEnv={...process.env,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'TEST_ONLY'};
  for(const key of ['KUN_PREVIEW_QA_WRANGLER_CONFIG','KUN_PREVIEW_QA_D1_ID','KUN_EASYORDERS_QA_WRANGLER_CONFIG','KUN_EASYORDERS_QA_D1_ID'])delete childEnv[key];
  const liveConfigPath=fileURLToPath(new URL('../wrangler.preview.toml',import.meta.url));
  for(const entry of entries){
    const path=fileURLToPath(new URL(`./${entry}`,import.meta.url));
    await execute(process.execPath,['--check',path]);
    for(const testEnv of [childEnv,{...childEnv,KUN_PREVIEW_QA_WRANGLER_CONFIG:liveConfigPath,KUN_PREVIEW_QA_D1_ID:safeId}]){
      let failure;
      try{await execute(process.execPath,['--import',pathToFileURL(trap).href,path,target],{env:testEnv,timeout:10000});}catch(error){failure=error;}
      assert.ok(failure,`${entry} must fail before network without isolated configuration`);
      assert.match(failure.stderr,/EASYORDERS_QA_ISOLATION_REQUIRED/,entry);
      assert.doesNotMatch(failure.stderr,/NETWORK_ATTEMPT_BEFORE_ISOLATION/,entry);
    }
    let accepted;
    try{await execute(process.execPath,['--import',pathToFileURL(acceptedTrap).href,path,target],{
      env:{...childEnv,...env,KUN_PREVIEW_QA_EASYORDERS_CONNECTION_ID:'CON-QA-EASYORDERS-12345'},timeout:10000
    });}catch(error){accepted=error;}
    assert.equal(accepted?.code,86,`${entry} must accept the approved QA target before its first stubbed request: ${accepted?.stderr||''}`);
    assert.match(accepted.stderr,/QA_GUARD_ACCEPTED_REQUEST/);
  }
  for(const name of await readdir(new URL('.',import.meta.url))){
    if(!/^(live|browser)-preview-.*\.mjs$/.test(name))continue;
    const source=await readFile(new URL(name,import.meta.url),'utf8');
    if(/\b(?:INSERT|UPDATE|DELETE)\b/.test(source)&&source.includes('/d1/database/')){
      assert.ok(entries.includes(name),`State-writing D1 entrypoint missing from isolation coverage: ${name}`);
      assert.ok(source.includes('loadIsolatedPreviewQaConfig'),name);
      assert.ok(!source.includes("new URL('../wrangler.preview.toml'"),`Live configuration fallback in ${name}`);
    }
  }
  console.log(`PASS: ${entries.length} state-writing Preview QA entrypoints reject missing/live config and accept the approved QA target before a stubbed request; wrong origins, Production D1, env overrides and service proxies checked. No network requests.`);
}finally{await rm(dir,{recursive:true,force:true});}
