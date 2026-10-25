import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {scopeMatches,expectedScope,auditCallerName,recentRange,cursorBoundaryRange,historicalRange,AUDIT_CALLER_SHA256} from './wefaq-protected-rpc-comparison.mjs';
assert.equal(scopeMatches({...expectedScope,upstreamIdentityVerified:true}),true);
assert.equal(scopeMatches({...expectedScope,upstreamIdentityVerified:false}),false);
for(const key of Object.keys(expectedScope))assert.equal(scopeMatches({...expectedScope,upstreamIdentityVerified:true,[key]:'wrong'}),false);
assert.equal(auditCallerName('123456'),'kunonline-wefaq-readonly-123456');
for(const id of ['kunonline','../live','','123/worker'])assert.throws(()=>auditCallerName(id));
assert.deepEqual(recentRange(819),{from:790,to:819});assert.deepEqual(recentRange(5),{from:1,to:5});
for(const n of [0,-1,NaN,2.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>recentRange(n));
console.log('PASS: exact proven scope fingerprints, dedicated caller identity and at most thirty recent IDs; malformed or unverified targets fail closed.');

assert.equal(createHash('sha256').update(await readFile(new URL('../sandbox/easyorders-readonly-audit-caller.mjs',import.meta.url))).digest('hex'),AUDIT_CALLER_SHA256,'Operator caller must match the exact synthetic Cloudflare-tested source');

assert.deepEqual(cursorBoundaryRange(820,823),{from:820,to:824});
assert.deepEqual(cursorBoundaryRange(824,823),{from:824,to:824});
for(const args of [[0,823],[820,0],[1,823],[825,823],[820.5,823],[1,Number.MAX_SAFE_INTEGER]])assert.throws(()=>cursorBoundaryRange(...args));

assert.deepEqual(historicalRange(700,729),{from:700,to:729});
for(const args of [[700,730],[0,20],[700,699],[700.5,701],[700,NaN]])assert.throws(()=>historicalRange(...args));
assert.deepEqual(historicalRange(824,829),{from:824,to:829},'Authoritative provider IDs may exceed the stored high-water when webhooks are missing');
