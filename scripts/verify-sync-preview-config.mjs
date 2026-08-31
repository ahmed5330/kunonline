import {readFile} from 'node:fs/promises';

const [config,scheduler,appEntry]=await Promise.all([
  readFile(new URL('../wrangler.sync.preview.toml',import.meta.url),'utf8'),
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
assert(/crons\s*=\s*\[[^\]]*"\*\/5 \* \* \* \*"[^\]]*"0 \*\/2 \* \* \*"[^\]]*\]/m.test(config),'expected Easy Orders and Meta schedules are missing');
assert(scheduler.includes("new Set(['*/5 * * * *','0 */2 * * *'])"),'scheduler must allow only the two approved cron expressions');
assert(scheduler.includes('env.APP_SYNC.runCron(cron)'),'scheduler must delegate through private RPC');
assert(appEntry.includes('export class SyncEntrypoint extends WorkerEntrypoint'),'app must export SyncEntrypoint');
assert(appEntry.includes('async runCron(cron)'),'app RPC must expose runCron');
console.log('Dedicated Preview sync scheduler config passed: isolated Cron owner, private RPC, no D1/secrets.');
