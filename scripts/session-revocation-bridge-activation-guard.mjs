/* A deployable-code gate: compatibility bridge is intentionally UNWIRED.
 * Activation requires a separately reviewed release after remote D1/Worker
 * metadata inventory + isolated Worker E2E. This never accesses Cloudflare.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const files=[
  'src/index.js','src/index-commerce-v38.js',
  'src/index-production-mobile-update.js',
  '.github/workflows/preview.yml','.github/workflows/production.yml'
];
const outputs=await Promise.all(files.map(read));
for(let i=0;i<files.length;i++){
  assert.doesNotMatch(outputs[i],/session-revocation-compatibility-bridge|revokeAcrossBoth|isRevokedAcrossBoth/,
    'Unverified bridge must not be activated via '+files[i]);
}
const bridge=await read('src/session-revocation-compatibility-bridge.js');
assert.match(bridge,/Promise\.all\s*\(/,'Must require both read checks');
assert.match(bridge,/await db\.batch\(queries\)/,'Both revocation writes must be atomic');
assert.match(bridge,/results\.some\(x=>x\?\.success!==true\)/,'Reject nonthrowing adapter failures');
assert.doesNotMatch(bridge,/\.run\(\)/,'Never replace the D1 batch with independent writes');
assert.match(bridge,/FROM '\+LEGACY/);
assert.match(bridge,/FROM '\+CANONICAL/);
console.log('Dual revocation activation guard PASS: candidate remains offline and unwired; every logout write must use D1 batch.');
