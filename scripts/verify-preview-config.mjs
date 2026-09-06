import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const config=read('../wrangler.preview.toml');
const syncConfig=read('../wrangler.sync.preview.toml');
const defaultConfig=read('../wrangler.toml');
const workflow=read('../.github/workflows/preview.yml');
const syncWorkflow=read('../.github/workflows/sync-preview.yml');
const packageJson=read('../package.json');
const cronVerifier=read('./verify-cloudflare-crons.mjs');

const fail=message=>{throw new Error(`Preview safety check failed: ${message}`);};
const requireText=(source,text,message)=>{if(!source.includes(text))fail(message);};
const requirePattern=(source,pattern,message)=>{if(!pattern.test(source))fail(message);};
const forbidPattern=(source,pattern,message)=>{if(pattern.test(source))fail(message);};
const value=(source,key)=>source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`,'m'))?.[1];

const d1Block=config.match(/\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|$)/)?.[1]||'';
const expected={
  worker:'kunonline-preview',
  entrypoint:'src/index-commerce-v36.js',
  database:'kunonline-preview',
  databaseId:'31cd5cdf-fc01-42d7-ba1e-571f3dd58495',
  binding:'DB'
};
const actual={
  worker:value(config,'name'),
  entrypoint:value(config,'main'),
  database:value(d1Block,'database_name'),
  databaseId:value(d1Block,'database_id'),
  binding:value(d1Block,'binding')
};
for(const [key,want] of Object.entries(expected))if(actual[key]!==want)fail(`${key} must be ${want}; got ${actual[key]??'missing'}`);

forbidPattern(config,/database_name\s*=\s*"kunonline"|^name\s*=\s*"kunonline"/m,'Production resource detected in Preview config.');
requirePattern(config,/\[triggers\][\s\S]*?crons\s*=\s*\[\s*\]/m,'app Worker must own zero Cron Triggers.');
if(value(syncConfig,'name')!=='kunonline-sync-preview')fail('dedicated sync Worker must be kunonline-sync-preview.');
requirePattern(syncConfig,/\[\[services\]\][\s\S]*binding\s*=\s*"APP_SYNC"[\s\S]*service\s*=\s*"kunonline-preview"[\s\S]*entrypoint\s*=\s*"SyncEntrypoint"/m,'sync Worker must call the Preview app through private SyncEntrypoint RPC.');
requirePattern(syncConfig,/crons\s*=\s*\[[^\]]*"\*\/5 \* \* \* \*"[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]/m,'dedicated scheduler must own the five-minute and two-hour schedules.');
forbidPattern(syncConfig,/\[\[d1_databases\]\]|database_name\s*=|database_id\s*=/m,'scheduler Worker must not bind D1 directly.');

if(value(defaultConfig,'name')!=='kunonline-local-dev-guard')fail('bare wrangler.toml must target kunonline-local-dev-guard.');
if(value(defaultConfig,'main')!=='src/dev-config-guard.js')fail('bare wrangler.toml must use src/dev-config-guard.js.');
forbidPattern(defaultConfig,/\bkunonline-preview\b|database_id\s*=\s*"31cd5cdf-fc01-42d7-ba1e-571f3dd58495"|database_name\s*=\s*"kunonline(?:-preview)?"|\[\[d1_databases\]\]|\bcrons\s*=/m,'bare config must not target shared Preview/Production resources.');

requireText(packageJson,'"dev": "wrangler dev --config wrangler.preview.toml"','npm run dev must explicitly select Preview config.');
requireText(packageJson,'"dev:scheduled": "wrangler dev --config wrangler.sync.preview.toml --test-scheduled"','scheduled local testing must use the sync Preview config.');
requireText(packageJson,'node scripts/verify-cloudflare-crons.mjs kunonline-preview --none','app live Cron check must require zero schedules.');
requireText(packageJson,'node scripts/verify-cloudflare-crons.mjs kunonline-sync-preview','sync live Cron verification is missing.');
requireText(packageJson,'node scripts/browser-preview-breakdown-controls-test.mjs','live Breakdown browser interaction must remain a hard Preview smoke gate.');
requireText(packageJson,'wrangler d1 migrations apply kunonline-preview --remote --config wrangler.preview.toml','migration command must be pinned to Preview D1/config.');
requireText(packageJson,'wrangler deploy --config wrangler.preview.toml','Preview deployment command is not pinned.');
requireText(packageJson,'wrangler deploy --config wrangler.sync.preview.toml','sync Preview deployment command is not pinned.');
requireText(packageJson,'wrangler rollback --config wrangler.preview.toml','manual rollback command is not pinned to Preview.');
requirePattern(packageJson,/"wrangler"\s*:\s*"4\.125\.0"/,'Wrangler must stay pinned to 4.125.0.');
for(const script of ['db:init','db:init-local','db:commerce','db:commerce-local'])requirePattern(packageJson,new RegExp(`"${script.replace(':','\\:')}"\\s*:\\s*"[^"]*--config wrangler\\.preview\\.toml`),`${script} must be pinned to Preview config.`);
requirePattern(cronVerifier,/workers\/scripts\/\$\{encodeURIComponent\(worker\)\}\/schedules/,'Cron verifier must query live Worker schedules.');
requireText(cronVerifier,'CLOUDFLARE_API_TOKEN','Cron verifier must authenticate against Cloudflare.');
requireText(cronVerifier,'--none','Cron verifier must support explicit zero-Cron checks.');

const automation=`${workflow}\n${syncWorkflow}\n${packageJson}`;
for(const [label,pattern] of [
  ['Production Wrangler config',/wrangler\.production\.toml/i],
  ['Production D1 command',/\bwrangler\s+d1\b[^\n]*\bkunonline\b(?!-preview)/i],
  ['Production database script',/"db:[^"]*production[^"]*"\s*:/i],
  ['Cloudflare secret mutation',/\bwrangler\s+secret\s+(?:put|bulk|delete)\b/i]
])forbidPattern(automation,pattern,`${label} is forbidden.`);

requirePattern(workflow,/environment:\s*\n\s*name:\s*preview\b/m,'workflow must use the preview GitHub Environment.');
requirePattern(workflow,/permissions:\s*\n\s*contents:\s*write\b/m,'workflow needs contents:write to maintain preview-stable after full validation.');
requireText(workflow,'git ls-remote origin refs/heads/develop/ux-system-upgrade','latest-HEAD ownership guard is missing.');
requireText(workflow,'npm run db:migrate:preview','Preview migration gate is missing.');
requireText(workflow,"if: steps.ownership.outputs.is_latest == 'true'",'Preview mutations must be gated by latest branch ownership.');
requireText(workflow,'id: deploy_ownership','deploy ownership recheck is missing.');

// Durable rollback source: Git commit/tag, not an old Cloudflare Worker UUID.
forbidPattern(workflow,/known_healthy\s*=/,'hard-coded known_healthy Worker versions are forbidden.');
forbidPattern(workflow,/wrangler versions deploy\s+["']?[0-9a-f]{8}-[0-9a-f-]{27,}@100%/i,'static Worker UUID rollback targets are forbidden.');
for(const [text,message] of [
  ['name: Resolve verified stable Preview source','stable source resolution step is missing.'],
  ['id: stable_source','stable source output step is missing.'],
  ['bootstrap_sha="05787d92d16d5b0da2bdf8dfcdd9a9cf54b875b5"','fully validated Preview CI #841 must remain the bootstrap stable source.'],
  ['refs/tags/preview-stable','preview-stable Git tag lookup is missing.'],
  ['git fetch --no-tags --depth=1 origin "$stable_sha"','stable Git source must be fetched explicitly.'],
  ['echo "source_sha=$stable_sha" >> "$GITHUB_OUTPUT"','stable source SHA must be captured.'],
  ['name: Create fresh verified rollback baseline from stable Git source','fresh same-run baseline creation is missing.'],
  ['id: rollback_base','rollback baseline output step is missing.'],
  ['git worktree add --detach "$stable_dir" "$stable_sha"','stable source must deploy from a detached worktree.'],
  ['CI rollback baseline from stable source $stable_sha','baseline deployment must be identifiable.'],
  ['node scripts/preview-health-check.mjs "$base_url"','fresh baseline must pass health check before candidate deployment.'],
  ['wrangler deployments status --config wrangler.preview.toml --json','Worker traffic ownership must be verified.'],
  ['echo "version_id=$version" >> "$GITHUB_OUTPUT"','fresh baseline/candidate version IDs must be captured.'],
  ['name: Deploy preview Worker','candidate deploy step is missing.'],
  ['Preview candidate $GITHUB_SHA','candidate deploy must identify the tested Git SHA.'],
  ['name: Confirm deployed Worker owns Preview traffic','candidate Worker ownership check is missing.']
])requireText(workflow,text,message);

// Required live/browser gates must all exist and be sequentially gated by success.
const gates=[
  ['Live authenticated Store B regression','live-preview-functional-test.mjs'],
  ['Live team and branch permission regression','live-preview-team-test.mjs'],
  ['Live Customer Service regression','live-preview-customer-service-test.mjs'],
  ['Live Easy Orders webhook regression','live-preview-easyorders-test.mjs'],
  ['Live Dashboard regression','live-preview-dashboard-test.mjs'],
  ['Browser runtime and responsive QA','browser-preview-qa.mjs']
];
for(const [name,script] of gates){requireText(workflow,`name: ${name}`,`${name} gate is missing.`);requireText(workflow,script,`${name} script is missing.`);}
for(const dependency of ['steps.smoke.outcome == \'success\'','steps.live.outcome == \'success\'','steps.team_live.outcome == \'success\'','steps.customer_service_live.outcome == \'success\'','steps.easyorders_live.outcome == \'success\'','steps.dashboard_live.outcome == \'success\''])requireText(workflow,dependency,`required live-gate dependency ${dependency} is missing.`);

requireText(workflow,'name: Require every Preview validation gate to succeed','final mandatory QA summary is missing.');
requireText(workflow,'id: qa_summary','QA summary output is missing.');
for(const envName of ['SMOKE_OUTCOME','STORE_B_OUTCOME','TEAM_OUTCOME','CUSTOMER_SERVICE_OUTCOME','EASYORDERS_OUTCOME','DASHBOARD_OUTCOME','BROWSER_OUTCOME'])requireText(workflow,`${envName}:`,`${envName} must be included in the final QA summary.`);
requireText(workflow,'if [ "$outcome" != "success" ]','skipped/incomplete QA must count as failure.');
requireText(workflow,'echo "all_success=true" >> "$GITHUB_OUTPUT"','QA summary must publish all_success only after every gate passes.');

requireText(workflow,'name: Promote fully validated HEAD to preview-stable','stable promotion step is missing.');
requireText(workflow,"if: steps.qa_summary.outputs.all_success == 'true'",'preview-stable must only move after all QA gates succeed.');
requireText(workflow,'git tag -f preview-stable "$GITHUB_SHA"','stable tag must point at the fully validated HEAD.');
requireText(workflow,'git push origin +refs/tags/preview-stable','stable tag must be persisted to GitHub.');

requireText(workflow,'name: Confirm Worker ownership before rollback','rollback Worker ownership guard is missing.');
requireText(workflow,"steps.qa_summary.outcome == 'failure'",'rollback must be driven by final QA failure.');
requireText(workflow,'name: Restore same-run verified Preview baseline after failed validation','same-run rollback step is missing.');
requireText(workflow,'steps.rollback_base.outputs.version_id','rollback must use the same-run fresh baseline Worker version.');
requireText(workflow,'steps.rollback_base.outputs.source_sha','rollback must retain stable Git source provenance.');
requireText(workflow,'wrangler versions deploy "$previous@100%" --yes --config wrangler.preview.toml','rollback must restore the same-run verified baseline to 100% traffic.');
requireText(workflow,'name: Mark Preview ownership loss','ownership-loss fail-safe is missing.');
requireText(workflow,'rollback was intentionally suppressed','ownership loss must suppress unsafe rollback.');

requireText(syncWorkflow,'name: Sync Preview CI/CD','independent sync scheduler CI/CD is missing.');
requireText(syncWorkflow,'npm run smoke:sync-preview','sync scheduler live smoke is missing.');

console.log('Preview safety checks passed: Preview-only resources, zero app Cron ownership, durable Git-source rollback authority, same-run rollback Worker capture, mandatory live/browser gates, stable-source promotion and Production isolation are enforced.');
