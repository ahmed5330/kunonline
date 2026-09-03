import { readFileSync } from 'node:fs';

const config=readFileSync(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const syncConfig=readFileSync(new URL('../wrangler.sync.preview.toml',import.meta.url),'utf8');
const defaultConfig=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/preview.yml',import.meta.url),'utf8');
const syncWorkflow=readFileSync(new URL('../.github/workflows/sync-preview.yml',import.meta.url),'utf8');
const packageJson=readFileSync(new URL('../package.json',import.meta.url),'utf8');
const cronVerifier=readFileSync(new URL('./verify-cloudflare-crons.mjs',import.meta.url),'utf8');

const d1Block=config.match(/\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|$)/)?.[1]||'';
const expected={worker:'kunonline-preview',entrypoint:'src/index-commerce-v36.js',database:'kunonline-preview',databaseId:'31cd5cdf-fc01-42d7-ba1e-571f3dd58495',binding:'DB'};
const value=(source,key)=>source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`,'m'))?.[1];
const actual={worker:value(config,'name'),entrypoint:value(config,'main'),database:value(d1Block,'database_name'),databaseId:value(d1Block,'database_id'),binding:value(d1Block,'binding')};
for(const [key,expectedValue] of Object.entries(expected))if(actual[key]!==expectedValue)throw new Error(`Preview safety check failed: ${key} must be ${expectedValue}; got ${actual[key]??'missing'}`);
if(/database_name\s*=\s*"kunonline"/m.test(config)||/^name\s*=\s*"kunonline"/m.test(config))throw new Error('Preview safety check failed: Production resource detected in Preview config.');
if(!/\[triggers\][\s\S]*?crons\s*=\s*\[\s*\]/m.test(config))throw new Error('Preview safety check failed: app Worker must own zero Cron Triggers after sync scheduler handoff.');
if(value(syncConfig,'name')!=='kunonline-sync-preview')throw new Error('Preview safety check failed: dedicated sync Worker must be kunonline-sync-preview.');
if(!/\[\[services\]\][\s\S]*binding\s*=\s*"APP_SYNC"[\s\S]*service\s*=\s*"kunonline-preview"[\s\S]*entrypoint\s*=\s*"SyncEntrypoint"/m.test(syncConfig))throw new Error('Preview safety check failed: dedicated sync Worker must call the app through private SyncEntrypoint RPC.');
if(!/crons\s*=\s*\[[^\]]*"\*\/5 \* \* \* \*"[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]/m.test(syncConfig))throw new Error('Preview safety check failed: dedicated sync Worker must own the Easy Orders five-minute and Meta/shipping two-hour schedules.');
if(/\[\[d1_databases\]\]|database_name\s*=|database_id\s*=/m.test(syncConfig))throw new Error('Preview safety check failed: scheduler Worker must not bind D1 directly.');

const defaultName=value(defaultConfig,'name'),defaultMain=value(defaultConfig,'main');
if(defaultName!=='kunonline-local-dev-guard')throw new Error(`Preview safety check failed: bare Wrangler config must target kunonline-local-dev-guard; got ${defaultName||'missing'}`);
if(defaultMain!=='src/dev-config-guard.js')throw new Error(`Preview safety check failed: bare Wrangler config must use src/dev-config-guard.js; got ${defaultMain||'missing'}`);
if(/\bkunonline-preview\b|database_id\s*=\s*"31cd5cdf-fc01-42d7-ba1e-571f3dd58495"|database_name\s*=\s*"kunonline(?:-preview)?"|\[\[d1_databases\]\]|\bcrons\s*=/m.test(defaultConfig))throw new Error('Preview safety check failed: default wrangler.toml must not be able to target shared Preview/Production resources or Cron Triggers.');
if(!/"dev"\s*:\s*"wrangler dev --config wrangler\.preview\.toml"/.test(packageJson))throw new Error('Preview safety check failed: npm run dev must explicitly select wrangler.preview.toml instead of the guarded default config.');
if(!/"dev:scheduled"\s*:\s*"wrangler dev --config wrangler\.sync\.preview\.toml --test-scheduled"/.test(packageJson))throw new Error('Preview safety check failed: scheduled local testing must use the dedicated sync scheduler config.');
if(!/"check:preview-crons"\s*:\s*"node scripts\/verify-cloudflare-crons\.mjs kunonline-preview --none"/.test(packageJson))throw new Error('Preview safety check failed: app Worker live Cron check must require zero schedules.');
if(!/"check:sync-preview-crons"\s*:\s*"node scripts\/verify-cloudflare-crons\.mjs kunonline-sync-preview/.test(packageJson))throw new Error('Preview safety check failed: dedicated scheduler live Cron verification command is missing.');
if(!/"smoke:preview"\s*:\s*"npm run check:preview-crons && npm run check:sync-preview-crons && node scripts\/smoke-sync-preview\.mjs/.test(packageJson))throw new Error('Preview safety check failed: Preview smoke must prove app has zero crons and scheduler Cron/RPC health before functional QA.');
if(!/browser-preview-breakdown-controls-test\.mjs/.test(packageJson))throw new Error('Preview safety check failed: live Breakdown browser interaction must remain a hard Preview smoke gate.');
if(!/workers\/scripts\/\$\{encodeURIComponent\(worker\)\}\/schedules/.test(cronVerifier)||!/CLOUDFLARE_API_TOKEN/.test(cronVerifier)||!/--none/.test(cronVerifier))throw new Error('Preview safety check failed: Cron verifier must query live Cloudflare schedules and support explicit zero-Cron checks.');
for(const script of ['db:init','db:init-local','db:commerce','db:commerce-local'])if(!new RegExp(`"${script.replace(':','\\:')}"\\s*:\\s*"[^"]*--config wrangler\\.preview\\.toml`).test(packageJson))throw new Error(`Preview safety check failed: ${script} must be pinned to wrangler.preview.toml.`);

const automation=`${workflow}\n${syncWorkflow}\n${packageJson}`;
const forbiddenAutomation=[['Production Wrangler config',/wrangler\.production\.toml/i],['Production D1 command',/\bwrangler\s+d1\b[^\n]*\bkunonline\b(?!-preview)/i],['Production database script',/"db:[^"]*production[^"]*"\s*:/i],['Cloudflare secret mutation',/\bwrangler\s+secret\s+(?:put|bulk|delete)\b/i]];
for(const [label,pattern] of forbiddenAutomation)if(pattern.test(automation))throw new Error(`Preview safety check failed: ${label} is forbidden.`);
if(!/environment:\s*\n\s*name:\s*preview\b/m.test(workflow))throw new Error('Preview safety check failed: workflow must use the preview GitHub Environment.');
if(!/permissions:\s*\n\s*contents:\s*write\b/m.test(workflow))throw new Error('Preview safety check failed: workflow needs contents:write only to maintain the preview-stable Git tag after full validation.');
if(!/npm run db:migrate:preview/.test(workflow))throw new Error('Preview safety check failed: Preview migration step is missing.');
if(!/wrangler d1 migrations apply kunonline-preview --remote --config wrangler\.preview\.toml/.test(packageJson))throw new Error('Preview safety check failed: migration command is not pinned to Preview D1/config.');
if(!/wrangler deploy --config wrangler\.preview\.toml/.test(packageJson))throw new Error('Preview safety check failed: deployment is not pinned to Preview config.');
if(!/wrangler deploy --config wrangler\.sync\.preview\.toml/.test(packageJson))throw new Error('Preview safety check failed: sync deployment is not pinned to dedicated scheduler config.');
if(!/wrangler rollback --config wrangler\.preview\.toml --message/.test(packageJson))throw new Error('Preview safety check failed: fallback manual rollback command is not pinned to Preview config.');
if(!/git ls-remote origin refs\/heads\/develop\/ux-system-upgrade/.test(workflow))throw new Error('Preview safety check failed: stale-run branch ownership guard is missing.');
if(!/id:\s*ownership[\s\S]*if:\s*steps\.ownership\.outputs\.is_latest == 'true'[\s\S]*npm run db:migrate:preview/.test(workflow))throw new Error('Preview safety check failed: Preview migrations are not guarded by latest-HEAD ownership.');

// Rollback authority must come from durable Git source, never from an old Cloudflare Worker UUID.
if(/known_healthy\s*=/.test(workflow))throw new Error('Preview safety check failed: hard-coded known_healthy Worker versions are forbidden; Worker versions can be garbage-collected by Cloudflare.');
if(/wrangler versions deploy\s+["']?[0-9a-f]{8}-[0-9a-f-]{27,}@100%/i.test(workflow))throw new Error('Preview safety check failed: static Worker UUID rollback targets are forbidden.');
if(!/name:\s*Resolve verified stable Preview source[\s\S]*id:\s*stable_source[\s\S]*refs\/tags\/preview-stable[\s\S]*bootstrap_sha="05787d92d16d5b0da2bdf8dfcdd9a9cf54b875b5"[\s\S]*git fetch --no-tags --depth=1 origin "\$stable_sha"[\s\S]*source_sha=\$stable_sha/.test(workflow))throw new Error('Preview safety check failed: stable rollback source must resolve from preview-stable with the fully validated #841 Git commit as bootstrap.');
if(!/name:\s*Create fresh verified rollback baseline from stable Git source[\s\S]*id:\s*rollback_base[\s\S]*steps\.stable_source\.outputs\.source_sha[\s\S]*git worktree add --detach[\s\S]*node_modules\/\.bin\/wrangler" deploy --config wrangler\.preview\.toml[\s\S]*CI rollback baseline from stable source[\s\S]*Current Version ID:[\s\S]*preview-health-check\.mjs[\s\S]*wrangler deployments status --config wrangler\.preview\.toml --json[\s\S]*version_id=\$version[\s\S]*source_sha=\$stable_sha/.test(workflow))throw new Error('Preview safety check failed: each run must recreate, health-check and capture a fresh rollback Worker from the stable Git source before candidate deployment.');
if(!/name:\s*Deploy preview Worker[\s\S]*id:\s*deploy[\s\S]*wrangler deploy --config wrangler\.preview\.toml --message "Preview candidate \$GITHUB_SHA"[\s\S]*Current Version ID:[\s\S]*version_id=\$version/.test(workflow))throw new Error('Preview safety check failed: candidate deployment must be direct, Preview-pinned and capture its exact Worker version ID.');
if(!/name:\s*Confirm deployed Worker owns Preview traffic[\s\S]*id:\s*worker_ownership[\s\S]*wrangler deployments status --config wrangler\.preview\.toml --json[\s\S]*steps\.deploy\.outputs\.version_id[\s\S]*is_current=true/.test(workflow))throw new Error('Preview safety check failed: post-deploy Worker ownership verification is missing.');

// Live gates are sequential and all are mandatory.
if(!/name:\s*Live authenticated Store B regression[\s\S]*steps\.worker_ownership\.outputs\.is_current == 'true'[\s\S]*scripts\/live-preview-functional-test\.mjs/.test(workflow))throw new Error('Preview safety check failed: live functional QA must require Worker deployment ownership.');
if(!/name:\s*Live team and branch permission regression[\s\S]*id:\s*team_live[\s\S]*scripts\/live-preview-team-test\.mjs/.test(workflow))throw new Error('Preview safety check failed: live team/store permission gate is missing.');
if(!/name:\s*Live Customer Service regression[\s\S]*id:\s*customer_service_live[\s\S]*steps\.team_live\.outcome == 'success'[\s\S]*scripts\/live-preview-customer-service-test\.mjs/.test(workflow))throw new Error('Preview safety check failed: live Customer Service multi-store gate is missing.');
if(!/name:\s*Live Easy Orders webhook regression[\s\S]*id:\s*easyorders_live[\s\S]*steps\.customer_service_live\.outcome == 'success'[\s\S]*scripts\/live-preview-easyorders-test\.mjs/.test(workflow))throw new Error('Preview safety check failed: live Easy Orders scoped-webhook gate must follow Customer Service QA.');
if(!/name:\s*Live Dashboard regression[\s\S]*id:\s*dashboard_live[\s\S]*steps\.easyorders_live\.outcome == 'success'[\s\S]*scripts\/live-preview-dashboard-test\.mjs/.test(workflow))throw new Error('Preview safety check failed: live Dashboard analytics gate must follow Easy Orders QA.');
if(!/name:\s*Browser runtime and responsive QA[\s\S]*id:\s*browser[\s\S]*steps\.team_live\.outcome == 'success'[\s\S]*steps\.customer_service_live\.outcome == 'success'[\s\S]*steps\.easyorders_live\.outcome == 'success'[\s\S]*steps\.dashboard_live\.outcome == 'success'[\s\S]*scripts\/browser-preview-qa\.mjs/.test(workflow))throw new Error('Preview safety check failed: browser gate must depend on team, Customer Service, Easy Orders and Dashboard live QA.');
if(!/name:\s*Require every Preview validation gate to succeed[\s\S]*id:\s*qa_summary[\s\S]*SMOKE_OUTCOME:[\s\S]*STORE_B_OUTCOME:[\s\S]*TEAM_OUTCOME:[\s\S]*CUSTOMER_SERVICE_OUTCOME:[\s\S]*EASYORDERS_OUTCOME:[\s\S]*DASHBOARD_OUTCOME:[\s\S]*BROWSER_OUTCOME:[\s\S]*if \[ "\$outcome" != "success" \][\s\S]*all_success=true/.test(workflow))throw new Error('Preview safety check failed: a final gate must treat skipped/incomplete live QA as failure instead of allowing a green workflow.');

// Only a fully validated, still-owned HEAD may become the next durable rollback source.
if(!/name:\s*Promote fully validated HEAD to preview-stable[\s\S]*steps\.qa_summary\.outputs\.all_success == 'true'[\s\S]*refs\/heads\/develop\/ux-system-upgrade[\s\S]*steps\.deploy\.outputs\.version_id[\s\S]*git tag -f preview-stable "\$GITHUB_SHA"[\s\S]*git push origin \+refs\/tags\/preview-stable/.test(workflow))throw new Error('Preview safety check failed: preview-stable may move only after every gate succeeds and branch/Worker ownership is reconfirmed.');
if(!/name:\s*Confirm Worker ownership before rollback[\s\S]*id:\s*rollback_worker_ownership[\s\S]*steps\.qa_summary\.outcome == 'failure'[\s\S]*wrangler deployments status --config wrangler\.preview\.toml --json[\s\S]*steps\.deploy\.outputs\.version_id[\s\S]*Automatic rollback suppressed/.test(workflow))throw new Error('Preview safety check failed: rollback must verify the failed candidate Worker still belongs to this run.');
if(!/name:\s*Restore same-run verified Preview baseline after failed validation[\s\S]*steps\.rollback_worker_ownership\.outputs\.is_current == 'true'[\s\S]*steps\.rollback_base\.outputs\.version_id[\s\S]*steps\.rollback_base\.outputs\.source_sha[\s\S]*wrangler versions deploy "\$previous@100%" --yes --config wrangler\.preview\.toml/.test(workflow))throw new Error('Preview safety check failed: rollback must restore the fresh baseline version created from stable Git source in the same run.');
if(!/name:\s*Mark Preview ownership loss[\s\S]*steps\.rollback_worker_ownership\.outputs\.is_current == 'false'[\s\S]*rollback was intentionally suppressed/.test(workflow))throw new Error('Preview safety check failed: mid-QA Worker replacement must fail safely without rollback.');

if(!/name:\s*Sync Preview CI\/CD/.test(syncWorkflow)||!/npm run smoke:sync-preview/.test(syncWorkflow))throw new Error('Preview safety check failed: independent sync scheduler CI/CD and live smoke are required.');
if(!/"wrangler"\s*:\s*"4\.125\.0"/.test(packageJson))throw new Error('Preview safety check failed: Wrangler must be pinned to 4.125.0.');

console.log('Preview safety checks passed: Preview-only resources, zero app Cron ownership, durable Git-source rollback authority, same-run rollback Worker capture, mandatory live/browser gates, stable-source promotion and Production isolation are enforced.');
