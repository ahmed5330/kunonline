import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const configPath='wrangler.production.toml';
const deployWorkflowPath='.github/workflows/production.yml';
const rollbackWorkflowPath='.github/workflows/production-rollback.yml';
const productionEntryPath='src/index-production-mobile-update.js';
const productionSyncPath='src/index-production-sync.js';
const productionIndexSqlPath='ops/sql/cloudflare-free-tier-indexes-production.sql';

const [config,deployWorkflow,rollbackWorkflow,productionEntry,productionSync,productionIndexSql]=await Promise.all([
  readFile(configPath,'utf8'),readFile(deployWorkflowPath,'utf8'),readFile(rollbackWorkflowPath,'utf8'),readFile(productionEntryPath,'utf8'),readFile(productionSyncPath,'utf8'),readFile(productionIndexSqlPath,'utf8')
]);

const requiredConfig=[
  ['Worker name',/^name\s*=\s*"kunonline"\s*$/m],
  ['Production composed mobile/J&T entry point',/^main\s*=\s*"src\/index-production-mobile-update\.js"\s*$/m],
  ['Production environment marker',/^APP_ENV\s*=\s*"production"\s*$/m],
  ['D1 binding',/^binding\s*=\s*"DB"\s*$/m],
  ['Production D1 name',/^database_name\s*=\s*"kunonline"\s*$/m],
  ['Production D1 ID',/^database_id\s*=\s*"c426601d-182f-486e-a5c1-bb1bca0ecb0b"\s*$/m],
  ['Easy Orders five-minute recovery Cron',/^crons\s*=\s*\[[^\]]*"\*\/5 \* \* \* \*"[^\]]*\]\s*$/m],
  ['Near-live fifteen-minute sync Cron',/^crons\s*=\s*\[[^\]]*"\*\/15 \* \* \* \*"[^\]]*\]\s*$/m],
  ['Two-hour deep sync Cron',/^crons\s*=\s*\[[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]\s*$/m],
];
for(const [label,pattern] of requiredConfig)if(!pattern.test(config))throw new Error(`Production safety check failed: ${label} is missing or unexpected.`);
if(/migrations_dir\s*=/.test(config))throw new Error('Production safety check failed: migrations_dir must not exist in Production config.');

const compositionGuards=[
  [productionEntry.includes("import app from './index-production-jt-history.js';"),'Production composed entry must retain the J&T history runtime.'],
  [productionEntry.includes("import {handleMobileAppUpdate} from './mobile-app-update.js';"),'Production composed entry must retain the Android updater.'],
  [productionEntry.includes("import {handleProductionCustomerService} from './production-customer-service.js';"),'Production composed entry must retain the Customer Service guard.'],
  [productionEntry.includes("import {handleProductionMobileOrderGuard} from './production-mobile-order-guard.js';"),'Production composed entry must retain the mobile order guard.'],
  [productionEntry.includes('const mobileUpdate=await handleMobileAppUpdate(request);'),'Production mobile updater must be awaited before deciding whether to short-circuit the request.'],
  [productionEntry.includes('return app.fetch(request,env,ctx);'),'Production composed entry must delegate unmatched requests to the J&T/history application.'],
];
for(const [ok,message] of compositionGuards)if(!ok)throw new Error(`Production composition safety check failed: ${message}`);

for(const path of ['src/mobile-app-update.js','src/production-customer-service.js','src/production-mobile-order-guard.js','src/jt-history-reconcile.js','src/index-production-jt-history.js',productionSyncPath,productionEntryPath,'public/v2/modules-v91-jt-history-reconcile.js']){
  try{execFileSync(process.execPath,['--check',path],{stdio:'pipe'});}catch(error){throw new Error(`Production syntax check failed for ${path}: ${String(error?.stderr||error?.message||error).trim()}`);}
}

for(const [label,workflow] of [['Production deploy',deployWorkflow],['Production rollback',rollbackWorkflow]]){
  if(/wrangler\s+d1|npm\s+run\s+db:/i.test(workflow))throw new Error(`${label} safety check failed: database commands are forbidden.`);
  if(/wrangler\.preview\.toml|kunonline-preview/i.test(workflow))throw new Error(`${label} safety check failed: Preview resources are forbidden.`);
  if(/\bwrangler\s+secret\s+(?:put|bulk|delete)\b/i.test(workflow))throw new Error(`${label} safety check failed: secret mutation is forbidden.`);
  if(!/environment:\s*\n\s*name:\s*production\b/m.test(workflow))throw new Error(`${label} safety check failed: production GitHub Environment is required.`);
}
if(!/wrangler\s+deploy\s+--config\s+wrangler\.production\.toml/.test(deployWorkflow))throw new Error('Production safety check failed: deployment is not pinned to wrangler.production.toml.');
if(!/wrangler\s+rollback\s+"\$\{\{ inputs\.version_id \}\}"\s+--config\s+wrangler\.production\.toml/.test(rollbackWorkflow))throw new Error('Production rollback safety check failed: rollback is not pinned to a requested version and Production config.');

const syncGuards=[
  [productionSync.includes("import {easyOrdersRecoveryStatus} from './easyorders-order-reconciliation.js';"),'Production sync health must read the canonical Easy Orders reconciliation state.'],
  [productionSync.includes("mode:'canonical-v38-with-legacy-parity-fallback'"),'Production Easy Orders must use canonical v38 reconciliation with the parity fallback for legacy accounts.'],
  [productionSync.includes('const LEGACY_BACKFILL_LOOKBACK=80;'),'Legacy Production accounts must receive the same 80-short-id historical recovery window as Preview.'],
  [productionSync.includes('backfillCursors'),'Legacy parity recovery must persist a historical cursor instead of rescanning only forward.'],
  [productionSync.includes('forwardCursors'),'Legacy parity recovery must persist a progressive forward cursor so gaps larger than ten ids cannot stall forever.'],
  [productionSync.includes("if(cron==='*/5 * * * *')task=runFiveMinute(event,env,ctx);"),'Five-minute Production recovery must run through the canonical scheduler first.'],
  [productionSync.includes("else if(cron==='*/15 * * * *')task=delegateScheduled(event,env,ctx,'* * * * *');"),'Fifteen-minute Production sync must map to the canonical near-live scheduler contract.'],
  [productionSync.includes('const MAX_REQUESTS_PER_RUN=30;'),'Recovery must keep a 30-request global run cap.'],
  [productionSync.includes('const MAX_REQUESTS_PER_CLIENT=10;'),'Steady-state legacy fallback must keep a 10-request per-client cap.'],
  [productionSync.includes('const CATCHUP_REQUESTS_PER_CLIENT=30;'),'Historical catch-up may use the remaining global budget but must remain capped.'],
  [productionSync.includes('let remaining=MAX_REQUESTS_PER_RUN;'),'Legacy fallback must track one shared remaining budget.'],
  [productionSync.includes('remaining=Math.max(0,remaining-r.requests)'),'Legacy fallback must debit every client from the shared budget.'],
  [productionSync.includes('requestLimit:Number(legacy.requestLimit||MAX_REQUESTS_PER_RUN)'),'Production health must expose the fallback request limit.'],
  [!productionSync.includes('MAX_REQUESTS_PER_CLIENT=35'),'Legacy 35-requests-per-client behavior must not return.'],
];
for(const [ok,message] of syncGuards)if(!ok)throw new Error(`Production sync safety check failed: ${message}`);

for(const marker of ['approval-only','DO NOT run from CI','idx_orders_easyorders_recovery','idx_orders_deferred_due'])if(!productionIndexSql.includes(marker))throw new Error(`Production index maintenance SQL is missing safety marker: ${marker}`);

console.log('Production safety checks passed. Production and Preview now share the canonical five-minute path; legacy Production accounts have an 80-id parity backfill plus a progressive forward cursor, near-live sync runs every fifteen minutes, deep sync every two hours, and CI performs no direct Production database mutation.');
