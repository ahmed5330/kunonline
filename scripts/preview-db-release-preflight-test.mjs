import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const workflow = readFileSync('.github/workflows/preview.yml', 'utf8');
const gate = readFileSync('scripts/preview-db-release-preflight.sh', 'utf8');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert(!manifest.scripts['deploy:preview'].includes('wrangler deploy'), 'Direct Preview deploy must not bypass shared D1 gate');
assert(gate.includes('d1 migrations list kunonline-preview --remote'), 'Must inspect actual remote pending migration set');
assert(gate.includes('d1 export kunonline-preview --remote --no-data --skip-confirmation'), 'Never copy real customer records onto CI runners');
assert(!gate.includes('backup.sql'), 'Legacy full customer data export must remain disabled');
assert(gate.includes('Unreviewed pending remote D1 migration'), 'Unrehearsed pending migrations must block release');
assert(gate.includes('recovery_bookmark') && gate.includes('GITHUB_STEP_SUMMARY'), 'Pre-migration recovery bookmark must be recorded');
for (const variable of ['GITHUB_SHA','PREVIEW_D1_BACKUP_REF','stable_sha']) {
  const unescaped = String.fromCharCode(96) + '$' + variable + String.fromCharCode(96);
  assert(!gate.includes(unescaped), 'Shell summary must not execute substitution for ' + variable);
}
const safetyStep = workflow.indexOf('run: bash scripts/preview-db-release-preflight.sh');
const migrationStep = workflow.indexOf('run: npm run db:migrate:preview');
assert(safetyStep > 0 && migrationStep > safetyStep, 'D1 preflight must precede migrations');
assert(workflow.includes("steps.shared_d1_preflight.outputs.apply_migrations == 'true'"), 'Only preflight-approved migrations may run');
assert(gate.includes('apply_migrations=false') && gate.includes('apply_migrations=true'), 'Preflight must distinguish unchanged releases from approved schema changes');
for (const text of ['inputs.shared_d1_approved_sha','inputs.verified_backup_reference'])
  assert(workflow.includes(text), 'Missing manual release input: ' + text);
for (const text of ['workflow_dispatch','GITHUB_SHA','d1 time-travel info','d1 export','PRAGMA integrity_check;','sqlite3 -bail'])
  assert(gate.includes(text), 'Missing shared DB safety mechanism: ' + text);

const temp = mkdtempSync(path.join(os.tmpdir(), 'kun-preview-db-'));
const fakeBin = path.join(temp, 'bin');
mkdirSync(fakeBin);
const gitScript = [
  '#!/usr/bin/env bash',
  'set -e',
  'case "$1" in',
  '  ls-remote) printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\\\trefs/tags/preview-stable\\\\n" ;;',
  '  fetch|cat-file) exit 0 ;;',
  '  diff)',
  '    if [[ "$*" == *"--name-only"* && "$TEST_SCHEMA_DIFF" == "1" ]]; then',
  '      echo migrations/0092_inventory_unit_qr_tracking.sql',
  '    elif [[ "$*" == *"--name-status"* ]]; then',
  '      printf "A\\\\tmigrations/0092_inventory_unit_qr_tracking.sql\\\\n"',
  '    fi ;;',
  '  *) exit 98 ;;',
  'esac',
  '',
].join('\n');
const gitPath = path.join(fakeBin, 'git');
writeFileSync(gitPath, gitScript);
chmodSync(gitPath, 0o755);
const sha = 'a'.repeat(40);
function run(variables) {
  return spawnSync('bash', ['scripts/preview-db-release-preflight.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: fakeBin + path.delimiter + process.env.PATH,
      GITHUB_SHA: sha,
      GITHUB_EVENT_NAME: 'push',
      TEST_SCHEMA_DIFF: '1',
      PREVIEW_D1_APPROVAL: '',
      PREVIEW_D1_BACKUP_REF: '',
      ...variables,
    },
  });
}
try {
  const unchanged = run({ TEST_SCHEMA_DIFF: '0' });
  assert.equal(unchanged.status, 0, unchanged.stderr + unchanged.stdout);
  const automatic = run({});
  assert.notEqual(automatic.status, 0, 'Automatic schema migration must be blocked');
  assert.match(automatic.stdout + automatic.stderr, /Automatic push release blocked/);
  const noApproval = run({ GITHUB_EVENT_NAME: 'workflow_dispatch' });
  assert.notEqual(noApproval.status, 0, 'Manual release without SHA approval must be blocked');
  const noBackup = run({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    PREVIEW_D1_APPROVAL: sha + ':kunonline-preview',
  });
  assert.notEqual(noBackup.status, 0, 'Manual release without verified backup reference must be blocked');
  console.log('Shared D1 release preflight guard tests passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
