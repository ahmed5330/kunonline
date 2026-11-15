'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findUnusedDuplicateAliases } = require('./release-storage-cleanup.cjs');

const digestA = 'sha256:' + 'a'.repeat(64);
const digestB = 'sha256:' + 'b'.repeat(64);
const f = (id, name, digest, downloads = 0, size = 45000000) =>
  ({ id, name, digest, download_count: downloads, size });

test('select only old unused aliases with matching canonical digest', () => {
  const assets = [
    f(1, 'Kun-Online-Mobile-v2.9.25-c156.apk', digestB),
    f(2, 'Kun-Online-Mobile-v2.9.25.apk', digestB),
    f(3, 'Kun-Online-Mobile-v2.9.24-c155.apk', digestA),
    f(4, 'Kun-Online-Mobile-v2.9.24.apk', digestA),
    f(5, 'Kun-Online-Mobile-v2.9.23-c154.apk', digestA),
    f(6, 'Kun-Online-Mobile-v2.9.23.apk', digestA, 1),
    f(7, 'Kun-Online-Mobile-v2.9.22.apk', digestB),
    f(8, 'Kun-Online-Mobile.apk', digestB),
    f(9, 'Kun-Online-Mobile-latest.json', digestB, 0, 242)
  ];
  assert.deepEqual(findUnusedDuplicateAliases(assets).map(asset => asset.id), [4]);
});

test('reject missing digest, mismatched bytes, ambiguous matches and unknown ids', () => {
  const assets = [
    f(1, 'Kun-Online-Mobile-v2.9.25-c156.apk', digestB),
    f(2, 'Kun-Online-Mobile-v2.9.24-c155.apk', digestA),
    f(3, 'Kun-Online-Mobile-v2.9.24-c154.apk', digestA),
    f(4, 'Kun-Online-Mobile-v2.9.24.apk', digestA),
    f(5, 'Kun-Online-Mobile-v2.9.23-c153.apk', digestA),
    f(6, 'Kun-Online-Mobile-v2.9.23.apk', digestA, 0, 12),
    f(7, 'Kun-Online-Mobile-v2.9.22.apk', null),
    f(null, 'Kun-Online-Mobile-v2.9.21.apk', digestA)
  ];
  assert.equal(findUnusedDuplicateAliases(assets).length, 0);
});
