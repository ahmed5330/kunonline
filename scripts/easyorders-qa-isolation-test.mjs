import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertIsolatedEasyOrdersQa} from './easyorders-qa-isolation-guard.mjs';

const liveConfig=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const safeConfig=`name = "kunonline-isolated-qa"
main = "src/index-commerce-v38.js"
[[d1_databases]]
binding = "DB"
database_name = "kunonline-isolated-qa"
database_id = "11111111-2222-4333-8444-555555555555"`;
const options={baseUrl:'https://kunonline-isolated-qa.example.test',configText:safeConfig,approvedDatabaseId:'11111111-2222-4333-8444-555555555555'};
assert.equal(assertIsolatedEasyOrdersQa(options).worker,'kunonline-isolated-qa');
const denied=[
  {...options,baseUrl:'https://kunonline-preview.mr-a-mnaa.workers.dev'},
  {...options,baseUrl:'https://app.kun-online.com'},
  {...options,baseUrl:'https://some-other-worker.example.test'},
  {...options,configText:liveConfig},
  {...options,configText:safeConfig+'\n[[d1_databases]]\nbinding = "MORE"\ndatabase_name = "kunonline-preview"\ndatabase_id = "31cd5cdf-fc01-42d7-ba1e-571f3dd58495"'},
  {...options,approvedDatabaseId:'WRONG-D1'},
  {...options,configText:safeConfig.replace('kunonline-isolated-qa"','kunonline-preview"')},
  {...options,configText:safeConfig+'\n[[services]]\nbinding = "PREVIEW_APP"\nservice = "kunonline-preview"'},
  {...options,configText:safeConfig.replace('11111111-2222-4333-8444-555555555555','31cd5cdf-fc01-42d7-ba1e-571f3dd58495'),approvedDatabaseId:'31cd5cdf-fc01-42d7-ba1e-571f3dd58495'},
  {...options,configText:safeConfig.replace('kunonline-isolated-qa"','kunonline"')},
];
for(const attempt of denied)assert.throws(()=>assertIsolatedEasyOrdersQa(attempt),/EASYORDERS_QA_ISOLATION_REQUIRED/);
console.log('PASS: state-writing Easy Orders QA cannot use customer-facing Worker, live D1, live service binding, or unapproved QA DB.');
