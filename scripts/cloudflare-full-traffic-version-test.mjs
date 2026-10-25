import assert from 'node:assert/strict';
import {fullTrafficVersion} from './cloudflare-full-traffic-version.mjs';
const a='11111111-2222-4333-8444-555555555555',b='22222222-3333-4444-8555-666666666666';
const version=(id,percentage)=>({version_id:id,percentage});
assert.equal(fullTrafficVersion({versions:[version(a,100)]}),a);
assert.equal(fullTrafficVersion({result:{versions:[version(a,100),version(b,0)]}}),a);
assert.equal(fullTrafficVersion({deployments:[{versions:[version(a,100)]},{versions:[version(b,100)]}]}),a);
assert.equal(fullTrafficVersion([{versions:[version(a,100)]}]),a);
for(const input of [
  {versions:[version(a,1),version(b,99)]},
  {versions:[version(a,1)]},
  {versions:[version(a,50),version(b,50)]},
  {versions:[{version_id:a}]},
  {versions:[version(a,100),version(a,0)]},
  [{versions:[version(a,100)]},{versions:[version(b,100)]}],
  {versions:[version('invalid',100)]}
])assert.throws(()=>fullTrafficVersion(input),'Split, fractional, ambiguous or missing ownership must fail closed');
console.log('PASS: only one explicitly verified 100% Worker owner is accepted; 1% is never full ownership and historical versions cannot override the current deployment.');
