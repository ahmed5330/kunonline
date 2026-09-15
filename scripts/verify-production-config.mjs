import { readFile } from 'node:fs/promises';

const configPath = 'wrangler.production.toml';
const deployWorkflowPath = '.github/workflows/production.yml';
const rollbackWorkflowPath = '.github/workflows/production-rollback.yml';
const productionSyncPath = 'src/index-production-sync.js';
const productionIndexSqlPath = 'ops/sql/cloudflare-free-tier-indexes-production.sql';

const [config, deployWorkflow, rollbackWorkflow, productionSync, productionIndexSql] = await Promise.all([
  readFile(configPath, 'utf8'),
  readFile(deployWorkflowPath, 'utf8'),
  readFile(rollbackWorkflowPath, 'utf8'),
  readFile(productionSyncPath, 'utf8'),
  readFile(productionIndexSqlPath, 'utf8'),
]);

const requiredConfig = [
  ['Worker name', /^name\s*=\s*"kunonline"\s*$/m],
  ['Production sync-safe entry point', /^main\s*=\s*"src\/index-production-sync\.js"\s*$/m],
  ['Production environment marker', /^APP_ENV\s*=\s*"production"\s*$/m],
  ['D1 binding', /^binding\s*=\s*"DB"\s*$/m],
  ['Production D1 name', /^database_name\s*=\s*"kunonline"\s*$/m],
  ['Production D1 ID', /^database_id\s*=\s*"c426601d-182f-486e-a5c1-bb1bca0ecb0b"\s*$/m],
  ['Easy Orders five-minute recovery Cron', /^crons\s*=\s*\[[^\]]*"\*\/5 \* \* \* \*"[^\]]*\]\s*$/m],
  ['Legacy two-hour shipping Cron', /^crons\s*=\s*\[[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]\s*$/m],
];

for (const [label, pattern] of requiredConfig) {
  if (!pattern.test(config)) {
    throw new Error(`Production safety check failed: ${label} is missing or unexpected.`);
  }
}

if (/migrations_dir\s*=/.test(config)) {
  throw new Error('Production safety check failed: migrations_dir must not exist in Production config.');
}

const workflows = [
  ['Production deploy', deployWorkflow],
  ['Production rollback', rollbackWorkflow],
];

for (const [label, workflow] of workflows) {
  if (/wrangler\s+d1|npm\s+run\s+db:/i.test(workflow)) {
    throw new Error(`${label} safety check failed: database commands are forbidden.`);
  }
  if (/wrangler\.preview\.toml|kunonline-preview/i.test(workflow)) {
    throw new Error(`${label} safety check failed: Preview resources are forbidden.`);
  }
  if (/\bwrangler\s+secret\s+(?:put|bulk|delete)\b/i.test(workflow)) {
    throw new Error(`${label} safety check failed: secret mutation is forbidden.`);
  }
  if (!/environment:\s*\n\s*name:\s*production\b/m.test(workflow)) {
    throw new Error(`${label} safety check failed: production GitHub Environment is required.`);
  }
}

if (!/wrangler\s+deploy\s+--config\s+wrangler\.production\.toml/.test(deployWorkflow)) {
  throw new Error('Production safety check failed: deployment is not pinned to wrangler.production.toml.');
}
if (!/wrangler\s+rollback\s+"\$\{\{ inputs\.version_id \}\}"\s+--config\s+wrangler\.production\.toml/.test(rollbackWorkflow)) {
  throw new Error('Production rollback safety check failed: rollback is not pinned to a requested version and Production config.');
}

const syncGuards = [
  [productionSync.includes('const MAX_REQUESTS_PER_RUN=30;'), 'Production Easy Orders recovery must keep a 30-request global run cap.'],
  [productionSync.includes('const MAX_REQUESTS_PER_CLIENT=10;'), 'Production Easy Orders recovery must keep a per-client fairness cap.'],
  [productionSync.includes('let remaining=MAX_REQUESTS_PER_RUN;'), 'Production Easy Orders recovery must track one shared remaining budget.'],
  [productionSync.includes('remaining=Math.max(0,remaining-r.requests)'), 'Production Easy Orders recovery must debit every client from the shared budget.'],
  [productionSync.includes('requestLimit:MAX_REQUESTS_PER_RUN'), 'Production health must expose the global request limit.'],
  [productionSync.includes("MAX_REQUESTS_PER_RUN=30") && !productionSync.includes('MAX_REQUESTS_PER_CLIENT=35'), 'Legacy 35-requests-per-client behavior must not return.'],
];
for (const [ok, message] of syncGuards) if (!ok) throw new Error(`Production free-tier safety check failed: ${message}`);

for (const marker of ['approval-only','DO NOT run from CI','idx_orders_easyorders_recovery','idx_orders_deferred_due']) {
  if (!productionIndexSql.includes(marker)) throw new Error(`Production index maintenance SQL is missing safety marker: ${marker}`);
}

console.log('Production deploy and rollback safety checks passed. Easy Orders recovery has a 30-request global budget, index SQL is approval-only, and CI contains no Production database mutation command.');