'use strict';

// Guarded cleanup of exact duplicate historical version-name APK aliases.
// Canonical versionCode APKs and all current release URLs are preserved.
const EXPECTED_REPO = 'ahmed5330/kunonline';
const TAG = 'android-latest';
const CANONICAL = /^Kun-Online-Mobile-v(\d+\.\d+\.\d+)-c(\d+)\.apk$/;
const ALIAS = /^Kun-Online-Mobile-v(\d+\.\d+\.\d+)\.apk$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/i;

function findUnusedDuplicateAliases(assets) {
  if (!Array.isArray(assets)) throw new Error('Missing GitHub release assets');
  const canonicals = assets.map(asset => {
    const match = CANONICAL.exec(asset.name || '');
    return match ? { asset, version: match[1], code: Number(match[2]) } : null;
  }).filter(Boolean);
  if (canonicals.length === 0) return [];
  const newestCode = Math.max(...canonicals.map(item => item.code));
  return assets.filter(alias => {
    const match = ALIAS.exec(alias.name || '');
    if (!match || alias.download_count !== 0 || !Number.isInteger(alias.id)) return false;
    if (!DIGEST.test(alias.digest || '') || !(alias.size > 0)) return false;
    const matches = canonicals.filter(entry =>
      entry.version === match[1] &&
      entry.code < newestCode &&
      entry.asset.size === alias.size &&
      entry.asset.digest === alias.digest &&
      DIGEST.test(entry.asset.digest || '')
    );
    return matches.length === 1;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Unknown argument');
  const apply = args.includes('--apply');
  const repository = process.env.GITHUB_REPOSITORY || EXPECTED_REPO;
  if (repository !== EXPECTED_REPO) throw new Error('Unexpected repository');
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  if (apply) {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Apply only from main');
    if (process.env.CLEANUP_CONFIRMATION !== 'DELETE_VERIFIED_ZERO_DOWNLOAD_DUPLICATES') {
      throw new Error('Explicit typed confirmation required');
    }
  }
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kunonline-safe-release-storage-audit'
  };
  const endpoint = 'https://api.github.com/repos/' + EXPECTED_REPO;
  const response = await fetch(endpoint + '/releases/tags/' + TAG, { headers });
  if (!response.ok) throw new Error('Release lookup failed: HTTP ' + response.status);
  const release = await response.json();
  if (release.tag_name !== TAG) throw new Error('Unexpected release tag');
  const candidates = findUnusedDuplicateAliases(release.assets);
  const bytes = candidates.reduce((sum, asset) => sum + asset.size, 0);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    release: TAG,
    assetCount: release.assets.length,
    candidates: candidates.map(asset => ({
      id: asset.id, name: asset.name, bytes: asset.size,
      sha256: asset.digest, downloads: asset.download_count
    })),
    candidateCount: candidates.length,
    bytes,
    megabytes: Number((bytes / 1e6).toFixed(2))
  }, null, 2));
  if (!apply) return;
  for (const asset of candidates) {
    const result = await fetch(endpoint + '/releases/assets/' + asset.id, {
      method: 'DELETE', headers
    });
    if (result.status !== 204) {
      throw new Error('Failed to remove ' + asset.name + ': HTTP ' + result.status);
    }
    console.log('Removed verified legacy alias: ' + asset.name);
  }
  console.log('Finished: all canonical APKs, newest alias, stable APK and manifest retained');
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { findUnusedDuplicateAliases };
