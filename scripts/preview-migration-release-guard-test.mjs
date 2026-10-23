/* Offline-only Preview D1 migration guard. No Cloudflare requests or DB mutation. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [workflow,packageRaw,validator,authSql]=await Promise.all([
  read('.github/workflows/preview.yml'),
  read('package.json'),
  read('scripts/verify-preview-config.mjs'),
  read('migrations/2026-10-23-session-revocation.sql')
]);
const packageScripts=JSON.parse(packageRaw).scripts;
assert.equal(packageScripts['db:migrate:preview'],'node scripts/reject-bulk-preview-migrations.mjs');
assert.equal(packageScripts['db:migrations:preview:list'],'wrangler d1 migrations list DB --remote --config wrangler.preview.toml');
assert.doesNotMatch(workflow,/npm run db:migrate:preview|wrangler\s+d1\s+migrations\s+apply/i,
  'normal Preview CI may not auto-apply every pending migration');
const readOnly="npx wrangler d1 execute DB --remote --config wrangler.preview.toml --command 'SELECT token_hash, expires_at, revoked_at FROM revoked_session_tokens LIMIT 0;' --yes";
assert.ok(workflow.includes(readOnly),'Preview deploy must query actual canonical schema without reading rows');
const ownership=workflow.indexOf('name: Confirm latest branch HEAD before Preview mutation');
const schema=workflow.indexOf('name: Verify Preview revocation schema read-only before deployment');
const deploy=workflow.indexOf('name: Deploy preview Worker');
assert.ok(ownership>=0&&schema>ownership&&deploy>schema,
  'Preview schema must be verified after branch ownership and before Worker rollout');
assert.match(authSql,/CREATE TABLE IF NOT EXISTS revoked_session_tokens/,'reviewed additive migration still defines tested canonical schema');
assert.ok(validator.includes('unattended Preview D1 migration is forbidden in CI.'),
  'Preview safety verifier must reject automatic bulk migrations');
assert.ok(validator.includes('legacy bulk Preview migration command must fail closed.'),
  'Verifier must prevent bulk-migration npm command from being silently restored');
const rejectFile=fileURLToPath(new URL('./reject-bulk-preview-migrations.mjs',import.meta.url));
const child=spawnSync(process.execPath,[rejectFile],{encoding:'utf8',timeout:10000});
assert.notEqual(child.status,0,'legacy bulk D1 migrations command must exit nonzero');
assert.match(child.stderr,/Preview D1 bulk migration is disabled/);
console.log('Preview D1 release guard PASS: no unattended migration, read-only canonical auth schema before deploy and unsafe npm command blocked.');
