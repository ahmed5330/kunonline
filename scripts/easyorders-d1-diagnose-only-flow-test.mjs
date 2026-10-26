// Source-only contract: a diagnosis-only Preview merge runs exactly the
// read-only D1 aggregate and deliberately never enters mutation steps.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const s=await readFile(new URL('../.github/workflows/preview.yml',import.meta.url),'utf8');
const diag=s.indexOf('name: Diagnose Easy Orders error HTTP codes and Cron ticks (READ ONLY)');
const owner=s.indexOf('name: Confirm latest branch HEAD before Preview mutation');
const publish=s.indexOf('name: Deploy preview Worker');
assert.ok(diag>0&&diag<owner&&owner<publish);
assert.match(s,/if: contains\(github\.event\.head_commit\.message, '\[easyorders-diagnose-only\]'\)/);
assert.match(s,/if: \$\{\{ !contains\(github\.event\.head_commit\.message, '\[easyorders-diagnose-only\]'\) \}\}/);
const diagnosticBlock=s.slice(diag,owner);
assert.ok(diagnosticBlock.includes('node scripts/easyorders-d1-aggregate-readonly.mjs'));
for(const action of ['wrangler deploy','wrangler d1 migrations apply','wrangler versions deploy','curl -X POST']){
  assert.ok(!diagnosticBlock.includes(action),
    'Diagnosis-only step must not mutate: '+action);
}
assert.match(s,/name: Verify isolated growth wallet capability handshake\s+id: qa_growth_release\s+if: steps\.ownership\.outputs\.is_latest == 'true'/);
const qaCheck=s.slice(owner,publish);
assert.ok(qaCheck.includes("if: steps.ownership.outputs.is_latest == 'true'"),
 'Expensive QA provision and live deployment must only run for authorized code release');
for(const forbidden of ['secrets.CLOUDFLARE_API_TOKEN', 'secrets.CLOUDFLARE_ACCOUNT_ID']){
  assert.ok(!diagnosticBlock.includes(forbidden),
    'The diagnostic uses protected job-level secrets without echoing them');
}
console.log('Preview D1 read-only diagnostic gate PASS: separate marker skips QA provisioning, Worker publish, migrations, rollback and customer writes.');
