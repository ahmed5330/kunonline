import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyWorkerSecretNames,REQUIRED_AUTH_SECRETS} from './verify-cloudflare-secret-names.mjs';

const valid=JSON.stringify([
  {name:'SESSION_SECRET',type:'secret_text'},
  {name:'TOKEN_ENC_KEY',type:'secret_text'},
  {name:'INTEGRATION_ENCRYPTION_KEY',type:'secret_text'}
]);
assert.deepEqual(verifyWorkerSecretNames(valid),{ok:true,requiredCount:2,valuesInspected:false});
assert.deepEqual([...REQUIRED_AUTH_SECRETS],['SESSION_SECRET','TOKEN_ENC_KEY']);
for(const [what,response,error] of [
  ['missing session',JSON.stringify([{name:'TOKEN_ENC_KEY',type:'secret_text'}]),/SESSION_SECRET/],
  ['missing legacy token encryption',JSON.stringify([{name:'SESSION_SECRET',type:'secret_text'}]),/TOKEN_ENC_KEY/],
  ['plain text variable instead of secret',JSON.stringify([{name:'SESSION_SECRET',type:'plain_text'},{name:'TOKEN_ENC_KEY',type:'plain_text'}]),/SECRET_NAME_PREFLIGHT_MISSING/],
  ['invalid JSON','not json',/INVALID_JSON/],
  ['wrong response shape',JSON.stringify({items:[]}),/EXPECTED_ARRAY/],
  ['accidental values',JSON.stringify([{name:'SESSION_SECRET',type:'secret_text',value:'NEVER_EMIT_OR_SAVE'},{name:'TOKEN_ENC_KEY',type:'secret_text'}]),/INVALID_RESPONSE/]
]){
  assert.throws(()=>verifyWorkerSecretNames(response),error,what+' must fail closed');
}
const workflow=await readFile(new URL('../.github/workflows/production.yml',import.meta.url),'utf8');
assert.match(workflow,/node scripts\/verify-cloudflare-secret-names\.mjs wrangler\.production\.toml/);
assert.match(workflow,/node scripts\/verify-cloudflare-secret-names\.mjs wrangler\.preview\.toml/);
assert.ok(workflow.indexOf('Verify backend Worker secret names')<workflow.indexOf('Deploy production Worker only'));
console.log('Cloudflare secret-name preflight PASS: both effective Workers must have SESSION_SECRET and TOKEN_ENC_KEY; no secret values disclosed.');
