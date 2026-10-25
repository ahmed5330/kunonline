import assert from 'node:assert/strict';
import {validateNewQaDatabase} from './provision-isolated-preview-qa.mjs';
import {isolatedSchedulerName} from './verify-isolated-preview-native-cron.mjs';
const name='kunonline-isolated-qa-12345',uuid='11111111-2222-4333-8444-555555555555';
validateNewQaDatabase({name,uuid},name);
for(const database of [
  {name,uuid:'31cd5cdf-fc01-42d7-ba1e-571f3dd58495'},
  {name,uuid:'c426601d-182f-486e-a5c1-bb1bca0ecb0b'},
  {name:'kunonline-preview',uuid},{name,uuid:'not-a-uuid'}
])assert.throws(()=>validateNewQaDatabase(database,name),/UNSAFE/);
assert.throws(()=>validateNewQaDatabase({name:'kunonline-preview',uuid},'kunonline-preview'),/UNSAFE/);
assert.equal(isolatedSchedulerName(name),'kunonline-isolated-qa-sync-12345');
for(const app of ['kunonline','kunonline-preview','kunonline-sync-preview','random-qa'])assert.throws(()=>isolatedSchedulerName(app),/UNSAFE/);
console.log('PASS: QA provisioning refuses customer database identities, malformed UUIDs and unexpected resource names.');
