import {readFile} from 'node:fs/promises';

const [config,appConfig,scheduler,syncEntry]=await Promise.all([
  readFile(new URL('../wrangler.sync.preview.toml',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),
  readFile(new URL('../src/sync-scheduler-preview.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v35.js',import.meta.url),'utf8')
]);
const assert=(ok,message)=>{if(!ok)throw new Error(`Sync Preview safety check failed: ${message}`);};
const value=(source,key)=>source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`,'m'))?.[1];
assert(value(config,'name')==='kunonline-sync-preview','worker name must be kunonline-sync-preview');
assert(value(config,'main')==='src/sync-scheduler-preview.js','entrypoint must be src/sync-scheduler-preview.js');
assert(!/\[\[d1_databases\]\]|database_name\s*=|database_id\s*=/m.test(config),'scheduler must not bind D1 directly');
assert(!/SESSION_SECRET|INTEGRATION_ENCRYPTION_KEY|EASYORDERS_WEBHOOK_SECRET/m.test(config),'scheduler must not own application secrets');
assert(/\[\[services\]\][\s\S]*binding\s*=\s*"APP_SYNC"[\s\S]*service\s*=\s*"kunonline-preview"[\s\S]*entrypoint\s*=\s*"SyncEntrypoint"/m.test(config),'APP_SYNC must bind to the app SyncEntrypoint');
assert(/crons\s*=\s*\[[^\]]*"\*\/15 \* \* \* \*"[^\]]*"\*\/5 \* \* \* \*"[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]/m.test(config),'expected scheduler triggers are missing');
assert(/\[triggers\][\s\S]*?crons\s*=\s*\[\s*\]/m.test(appConfig),'app Worker must own zero Cron Triggers');
assert(scheduler.includes("new Set(['*/15 * * * *','*/5 * * * *','0 */2 * * *'])"),'scheduler must allow only the three approved cron expressions');
assert(scheduler.includes("cron==='*/15 * * * *'?'* * * * *':cron"),'native 15-minute trigger must map to the app logical Meta sync key');
assert(scheduler.includes('env.APP_SYNC.runCron(rpcCron,scheduledTime)'),'scheduler must delegate through private RPC with scheduled time');
assert(syncEntry.includes('export class SyncEntrypoint extends SyncEntrypointV34'),'sync policy must bypass the older v35 full-scan cron behavior');
assert(!syncEntry.includes('reconcileAllEasyOrdersDuplicates(this.env'),'full Easy Orders dedupe must never run from cron');
assert(syncEntry.includes("orderDedupe:{ok:true,skipped:true,mode:'manual-or-targeted-only'}"),'five-minute recovery must explicitly keep full dedupe disabled');
assert(syncEntry.includes("easyOrdersPriceSync:'four-hour'"),'price sync must be four-hour, not five-minute');
assert(syncEntry.includes("metaCampaignSync:'15-minute-gated'"),'Meta campaign sync policy must remain 15-minute');
assert(syncEntry.includes("metaGranularSync:'two-hour'"),'Meta granular sync must run every two hours');
assert(syncEntry.includes("return commerceV34.fetch(request,env,ctx);"),'Easy Orders webhook/import must delegate to targeted v34 dedupe paths');
console.log('Dedicated Preview sync scheduler config passed: Meta uses a native 15-minute Cron, Easy Orders recovery stays five-minute with a global budget, price sync is four-hour, granular Meta is two-hour, and full dedupe is manual-only.');