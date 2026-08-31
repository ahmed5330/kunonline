import {readFile} from 'node:fs/promises';

const [config,appConfig,scheduler,appEntry]=await Promise.all([
  readFile(new URL('../wrangler.sync.preview.toml',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),
  readFile(new URL('../src/sync-scheduler-preview.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8')
]);
const assert=(ok,message)=>{if(!ok)throw new Error(`Sync Preview safety check failed: ${message}`);};
const value=(source,key)=>source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`,'m'))?.[1];
assert(value(config,'name')==='kunonline-sync-preview','worker name must be kunonline-sync-preview');
assert(value(config,'main')==='src/sync-scheduler-preview.js','entrypoint must be src/sync-scheduler-preview.js');
assert(!/\[\[d1_databases\]\]|database_name\s*=|database_id\s*=/m.test(config),'scheduler must not bind D1 directly');
assert(!/SESSION_SECRET|INTEGRATION_ENCRYPTION_KEY|EASYORDERS_WEBHOOK_SECRET/m.test(config),'scheduler must not own application secrets');
assert(/\[\[services\]\][\s\S]*binding\s*=\s*"APP_SYNC"[\s\S]*service\s*=\s*"kunonline-preview"[\s\S]*entrypoint\s*=\s*"SyncEntrypoint"/m.test(config),'APP_SYNC must bind to the app SyncEntrypoint');
assert(/crons\s*=\s*\[[^\]]*"\* \* \* \* \*"[^\]]*"\*\/5 \* \* \* \*"[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]/m.test(config),'expected one-minute Meta, Easy Orders recovery and deep Meta schedules are missing');
assert(/\[triggers\][\s\S]*?crons\s*=\s*\[\s*\]/m.test(appConfig),'app Worker must own zero Cron Triggers');
assert(scheduler.includes("new Set(['* * * * *','*/5 * * * *','0 */2 * * *'])"),'scheduler must allow only the three approved cron expressions');
assert(scheduler.includes('env.APP_SYNC.runCron(cron)'),'scheduler must delegate through private RPC');
assert(appEntry.includes('export class SyncEntrypoint extends WorkerEntrypoint'),'app must export SyncEntrypoint');
assert(appEntry.includes('async runCron(cron)'),'app RPC must expose runCron');
assert(appEntry.includes("cron==='* * * * *'")&&appEntry.includes('syncAllMetaAdsNearLiveScheduled(env,{days:2})'),'app must refresh Meta campaign, Ad Set and Ad data every minute with a short lookback');
console.log('Dedicated Preview sync scheduler config passed: sole Cron owner, one-minute Meta refresh, private RPC, app has zero schedules, scheduler has no D1/secrets.');
