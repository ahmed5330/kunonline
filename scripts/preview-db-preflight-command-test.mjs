// Exercises both approval and rejection of the shared D1 gate with mocked commands.
// All data are synthetic. No network or remote database connection is possible.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';

const sha='a'.repeat(40),dir=mkdtempSync(join(tmpdir(),'kun-db-positive-'));
const bin=join(dir,'bin');mkdirSync(bin);
function mock(name,lines){
  const file=join(bin,name);
  writeFileSync(file,['#!/usr/bin/env bash','set -euo pipefail',...lines].join('\n')+'\n');
  chmodSync(file,0o755);
}
mock('git',[
  'case "$1" in',
  '  ls-remote) printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/tags/preview-stable\\n" ;;',
  '  fetch|cat-file) exit 0 ;;',
  '  diff)',
  '    if [[ "$*" == *"--name-only"* ]]; then',
  '      echo migrations/0092_inventory_unit_qr_tracking.sql',
  '    else',
  '      printf "A\\tmigrations/0092_inventory_unit_qr_tracking.sql\\n"',
  '    fi ;;',
  '  *) exit 50 ;;',
  'esac'
]);
mock('npx',[
  'case "$*" in',
  '  *"d1 migrations list "*)',
  '    if [[ "$TEST_PENDING" == "bad" ]]; then',
  '      echo 0091_unapproved_changes.sql',
  '    elif [[ "$TEST_PENDING" == "empty" ]]; then',
  '      echo "No migrations to apply"',
  '    else',
  '      echo 0092_inventory_unit_qr_tracking.sql',
  '    fi ;;',
  '  *"d1 info "*) echo \'{ "version": "production" }\' ;;',
  '  *"d1 time-travel info "*) echo "Bookmark: 00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683" ;;',
  '  *"d1 execute "*)',
  '    echo \'[{"success":true,"results":[{"type":"table","name":"orders","sql":"CREATE TABLE orders(id TEXT PRIMARY KEY)"}]}]\' ;;',
  '  *) exit 52 ;;',
  'esac'
]);
function execute({pending='good',approval=true,backup=true,action='workflow_dispatch'}={}){
  const output=join(dir,'output-'+pending+'.txt'),summary=join(dir,'summary-'+pending+'.md');
  const result=spawnSync('bash',['scripts/preview-db-release-preflight.sh'],{
    encoding:'utf8',timeout:15000,
    env:{...process.env,PATH:bin+delimiter+process.env.PATH,
      GITHUB_SHA:sha,GITHUB_EVENT_NAME:action,TEST_PENDING:pending,
      PREVIEW_D1_APPROVAL:approval?sha+':kunonline-preview':'',
      PREVIEW_D1_BACKUP_REF:backup?'backup-ticket:verified-independent-backup-001':'',
      GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary}
  });
  return {result,output,summary};
}
try {
  const good=execute();
  assert.equal(good.result.status,0,good.result.stdout+'\n'+good.result.stderr);
  assert.match(readFileSync(good.output,'utf8'),/apply_migrations=true/);
  assert.match(readFileSync(good.summary,'utf8'),/00000085-0000024c/);
  const unknown=execute({pending:'bad'});
  assert.notEqual(unknown.result.status,0);
  assert.match(unknown.result.stdout+unknown.result.stderr,/Unreviewed pending remote D1 migration/);
  assert.notEqual(execute({approval:false}).result.status,0);
  assert.notEqual(execute({backup:false}).result.status,0);
  assert.notEqual(execute({action:'push'}).result.status,0);
  console.log('Shared D1 preflight command integration PASS (approved, unknown migration and denied release)');
} finally {
  rmSync(dir,{recursive:true,force:true});
}
