import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [runner,outer,conf,legacy]=await Promise.all([
 readFile(new URL('./smoke-test-current-preview.mjs',import.meta.url),'utf8'),
 readFile(new URL('../src/index-commerce-v38.js',import.meta.url),'utf8'),
 readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),
 readFile(new URL('../src/index-commerce-v36.js',import.meta.url),'utf8')
]);
assert.match(conf,/main\s*=\s*"src\/index-commerce-v38\.js"/);
const build=outer.match(/(?:export\s+)?const\s+KUN_PREVIEW_ENTRYPOINT_BUILD\s*=\s*['"]([^'"]+)['"]/i)?.[1];
assert.ok(build&&build.includes('preview-v38'),'Exactly configured outer v38 must own the version route');
assert.match(outer,/pathname==='\/api\/preview\/version'/);
assert.match(runner,/const ownBuild=source\.match\(\/(?:.*)KUN_PREVIEW_ENTRYPOINT_BUILD/);
assert.match(runner,/const build=ownBuild\|\|source\.match/);
const old=legacy.match(/const\s+BUILD\s*=\s*['"]([^'"]+)['"]/i)?.[1];
assert.ok(old&&old!==build,'v36 compatibility build must differ from the latest outward v38 route');
assert.match(runner,/data\?\.build===expectedBuild&&data\?\.entrypoint===expectedEntrypoint/);
assert.match(runner,/environment==='preview'/);
console.log('Preview v38 outer build smoke attestation PASS: configured Worker v38 owns actual /api/preview/version; legacy nested v36 cannot falsely reject it.');
