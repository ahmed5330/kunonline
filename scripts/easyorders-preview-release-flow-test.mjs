// This release attestation tests the exact checked-out Preview CI/CD plan.
// It runs completely OFFLINE. It does not upload/deploy a Worker or read D1.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const config=await readFile(new URL('../.github/workflows/preview.yml',import.meta.url),'utf8');
const scheduler=await readFile(new URL('../wrangler.sync.preview.toml',import.meta.url),'utf8');
const expected=[
  "name: Preview CI/CD",
  "environment:",
  "name: preview",
  "Gate every Preview release on read-only live Worker and D1 checks",
  "node scripts/easyorders-cloudflare-worker-readonly-inventory.mjs",
  "node scripts/easyorders-cloudflare-worker-readonly-inventory-test.mjs",
  "wrangler d1 time-travel info kunonline-preview",
  "git diff --name-only",
  "Apply preview migrations only with explicit schema approval",
  "github.event_name == 'workflow_dispatch' && inputs.apply_reviewed_migrations == true",
  "Create fresh verified rollback baseline from stable Git source",
  "wrangler deployments status --config wrangler.preview.toml --json",
  "Restore same-run verified Preview baseline after failed validation",
  "Require every Preview validation gate to succeed",
  "Promote fully validated HEAD to preview-stable"
];
for(const token of expected)assert.ok(config.includes(token), 'release guard missing '+token);
// A tag on only the first hotfix merge is not a trustworthy release gate:
// later develop pushes redeploy the same Worker and must rerun Cloudflare checks.
const gate=config.slice(config.indexOf('      - name: Gate every Preview release on read-only live Worker and D1 checks'),
  config.indexOf('      - name: Apply preview migrations only with explicit schema approval'));
assert.match(gate,/if: steps\.ownership\.outputs\.is_latest == 'true'/);
assert.doesNotMatch(gate,/contains\(github\.event\.head_commit\.message/,
  'Commit-message hints MUST NOT bypass the Cloudflare safety preflight');
assert.match(gate,/\[ "\$\{\{ github\.event_name \}\}" = "push" \]/,
  'Push releases must block accidental migration changes');
assert.ok(gate.includes('wrangler d1 time-travel info kunonline-preview'),
  'Preview preflight must prove the backup bookmark is readable before Worker deployment');
const sections=[
  "Confirm latest branch HEAD before Preview mutation",
  "Provision verified isolated QA with synthetic fixtures",
  "Require every isolated writing QA gate before release",
  "Prove two native five-minute Cron executions on isolated QA",
  "Gate every Preview release on read-only live Worker and D1 checks",
  "Apply preview migrations only with explicit schema approval",
  "Reconfirm latest branch HEAD before deploy",
  "Create fresh verified rollback baseline from stable Git source",
  "Deploy preview Worker",
  "Require every Preview validation gate to succeed",
  "Restore same-run verified Preview baseline after failed validation"
];
let previous=-1;
for(const name of sections){
 const at=config.indexOf('      - name: '+name);
 assert.ok(at>previous,'Preview safe-release order missing/out of sequence: '+name);
 previous=at;
}
const between=config.slice(config.indexOf("Create fresh verified rollback baseline from stable Git source"),
  config.indexOf("      - name: Deploy preview Worker"));
assert.ok(between.includes('git worktree add --detach "$stable_dir" "$stable_sha"'),
  'Rollback baseline must come from a reviewed stable Git SHA');
assert.ok(between.includes('node scripts/preview-health-check.mjs "$base_url"'),
  'Rollback baseline must be healthy before candidate deploy');
assert.ok(between.includes('CI rollback baseline from stable source $stable_sha'),
  'Rollback deployment must be attributable to the stable source');
assert.ok(config.includes("steps.rollback_base.outputs.version_id"),'Exact captured Worker version required');
const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
assert.doesNotMatch(packageJson.scripts['deploy:preview'],/\|\|\s*true/,'Preview deploy must propagate CLI failure');
assert.match(packageJson.scripts['deploy:preview'], /direct deploy is blocked/, 'Local direct deployment must remain blocked');
assert.match(packageJson.scripts['deploy:preview'], /process\.exit\(1\)/, 'Blocked deployment must fail closed');
assert.doesNotMatch(packageJson.scripts['deploy:preview'], /wrangler deploy/, 'No direct deploy may bypass protected workflow gates');
assert.equal((config.match(/deploy --config wrangler\.preview\.toml --keep-vars/g)||[]).length,2,'Both stable baseline and candidate deploy must preserve remote variables');
assert.equal((config.match(/node scripts\/cloudflare-full-traffic-version\.mjs/g)||[]).length,4,'Every Preview traffic/promotion/rollback check must prove an explicit 100% owner');
const writingEntries=JSON.parse(await readFile(new URL('./isolated-preview-qa-entrypoints.json',import.meta.url),'utf8'));
for(const name of [...writingEntries,'browser-preview-qa.mjs','browser-preview-breakdown-controls-test.mjs']){
  for(const line of config.split('\n').filter(line=>line.includes('node scripts/'+name)))
    assert.ok(line.includes('$KUN_PREVIEW_QA_BASE_URL'),`Writing QA ${name} must target isolated QA`);
  assert.ok(!packageJson.scripts['smoke:preview'].includes(name),`Live Preview smoke must not invoke writing QA ${name}`);
}
assert.ok(!packageJson.scripts['smoke:preview'].includes('preview-operational-workflow-smoke'),
  'POST-based negative smoke belongs on QA, not shared customer Preview');
assert.ok(!/\bwrangler d1 time-travel restore\b/.test(config),'NEVER automatically revert live customer D1');
assert.ok(!/\bwrangler d1 migrations apply\b/.test(config),
  'Only approved explicit npm migration step permitted, never migration from an ungated step');
assert.match(scheduler,/service\s*=\s*"kunonline-preview"/);
assert.match(scheduler,/entrypoint\s*=\s*"SyncEntrypoint"/);
assert.match(scheduler,/\*\/5 \* \* \* \*/);
console.log('Easy Orders Preview code-only release gate PASS: protected GET-only Cron/D1, no auto schema write, validated stable Git rollback version, all QA + rollback checks.');
