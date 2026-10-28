import {readFile} from 'node:fs/promises';
import {assertIsolatedEasyOrdersQa} from './easyorders-qa-isolation-guard.mjs';
import {installIsolatedQaFetch} from './isolated-qa-fetch.mjs';

export async function loadIsolatedPreviewQaConfig(baseUrl,{env=process.env}={}){
  const configPath=env.KUN_PREVIEW_QA_WRANGLER_CONFIG||env.KUN_EASYORDERS_QA_WRANGLER_CONFIG;
  const databaseId=env.KUN_PREVIEW_QA_D1_ID||env.KUN_EASYORDERS_QA_D1_ID;
  if(!configPath||!databaseId)throw new Error('EASYORDERS_QA_ISOLATION_REQUIRED: dedicated QA config and approved D1 ID are required for all state-writing Preview QA');
  if(env.KUN_PREVIEW_QA_WRANGLER_CONFIG&&env.KUN_EASYORDERS_QA_WRANGLER_CONFIG&&env.KUN_PREVIEW_QA_WRANGLER_CONFIG!==env.KUN_EASYORDERS_QA_WRANGLER_CONFIG)
    throw new Error('EASYORDERS_QA_ISOLATION_REQUIRED: conflicting QA configs');
  if(env.KUN_PREVIEW_QA_D1_ID&&env.KUN_EASYORDERS_QA_D1_ID&&env.KUN_PREVIEW_QA_D1_ID!==env.KUN_EASYORDERS_QA_D1_ID)
    throw new Error('EASYORDERS_QA_ISOLATION_REQUIRED: conflicting approved QA D1 IDs');
  const config=await readFile(configPath,'utf8');
  assertIsolatedEasyOrdersQa({baseUrl,configText:config,approvedDatabaseId:databaseId});
  if(env===process.env&&env.KUN_ISOLATED_QA_HTTP_RETRY==='1')
    installIsolatedQaFetch({baseUrl,configText:config,approvedDatabaseId:databaseId});
  return config;
}
