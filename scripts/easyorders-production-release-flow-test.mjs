import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const flow=await readFile(new URL('../.github/workflows/production.yml',import.meta.url),'utf8');
const i=flow.indexOf('      - name: Read current Production Worker rollback version without mutation');
const d=flow.indexOf('      - name: Deploy production Worker only — no migrations');
const a=flow.indexOf('      - name: Attest newly deployed Production Worker version');
const v=flow.indexOf('      - name: Verify live branded dashboard');
const r=flow.indexOf('      - name: Restore prior Production Worker after failed smoke only if owned');
assert.ok(i>0&&i<d&&d<a&&a<v&&v<r,'Rollback baseline, candidate, verification, smoke and restore order required');
for(const phrase of [
  'environment:', 'name: production',
  'npx wrangler deployments status --config wrangler.production.toml --json',
  'id: rollback_base', 'id: deploy_worker',
  'npx wrangler deploy --config wrangler.production.toml --keep-vars',
  'Current Version ID:',
  'expected="${{ steps.deploy_worker.outputs.version_id }}"',
  'if [ "$current" = "$expected" ]',
  'id: deployed_version', 'version_id=$current',
  "if: failure() && steps.deploy_worker.outputs.version_id != ''",
  'if [ "$current" != "$deployed" ]',
  'npx wrangler versions deploy "$previous@100%" --yes --config wrangler.production.toml',
  'Verify live V2 login gateway and session endpoints',
  'Verify live ChatGPT MCP discovery and unauthorized access protection'
])assert.ok(flow.includes(phrase),'Production safety contract missing: '+phrase);
assert.ok(!flow.includes('\"$current\" != \"$previous\"'),'Any different version must not be mistaken for this deployment');
assert.ok(flow.includes('deployed=\"${{ steps.deploy_worker.outputs.version_id }}\"'),'Rollback authority must come from the deployment output');
assert.ok(flow.includes('test \"$restored\" = \"$previous\"'),'Verify exact restored ownership');
assert.equal((flow.match(/node scripts\/cloudflare-full-traffic-version\.mjs/g)||[]).length,4,'All Production ownership and restored-traffic checks must require 100%');
const baseline=flow.slice(i,d);
assert.ok(!/^[ \t]*(?:npx\s+)?wrangler\s+(?:deploy|versions deploy|d1 migrations apply)/m.test(baseline),
  'Baseline acquisition must never mutate Cloudflare');
assert.ok(!flow.includes('wrangler d1 migrations apply'), 'Production hotfix may not migrate D1');
assert.ok(r>flow.indexOf('Verify live V2 login gateway and session endpoints'),
  'Rollback must follow the full live smoke suite');
console.log('Production Easy Orders guarded release offline PASS: read-only rollback baseline, Worker version ownership, live smoke and guarded restoration, no D1 migration.');
