// Offline-only preflight. This program reads configs; it NEVER creates,
// migrates, seeds or deploys any Cloudflare resources.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const field=(source,name)=>source.match(new RegExp('^\\s*'+name+'\\s*=\\s*"([^"]+)"','m'))?.[1]||'';
const d1Blocks=source=>[...source.matchAll(/^\[\[d1_databases\]\]([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)].map(m=>m[1]);
const uuids=source=>[...source.matchAll(/^\s*database_id\s*=\s*"([^"]+)"/gm)].map(m=>m[1]);
const fail=message=>{throw new Error('UNSAFE AUDIT SANDBOX CONFIG: '+message);};

export function verifyAuditSandboxConfig(sandbox,production,preview){
  const prodName=field(production,'name'),previewName=field(preview,'name');
  const name=field(sandbox,'name'),appEnv=field(sandbox,'APP_ENV');
  if(!name||!/^[a-z][a-z0-9-]{5,60}$/.test(name)||name.startsWith('REPLACE_'))fail('Worker needs a unique valid name');
  if(name===prodName||name===previewName)fail('Worker name overlaps a live Worker');
  if(!name.includes('audit')&&!name.includes('sandbox'))fail('Worker name must identify audit/sandbox purpose');
  if(field(sandbox,'main')!=='src/audit-sandbox-auth-worker.js')fail('Use only the minimal isolated auth QA Worker, never full commerce');
  if(appEnv!=='audit_sandbox')fail('APP_ENV must be audit_sandbox');
  if(field(sandbox,'AUDIT_EGRESS_OFFLINE')!=='true')fail('Only egress-disabled sandbox mode is allowed');
  if(!/^\s*workers_dev\s*=\s*false\s*$/m.test(sandbox))fail('Public workers.dev host must be disabled');
  if(/^\s*(?:AUDIT_QA_KEY|SESSION_SECRET)\s*=/m.test(sandbox))fail('Secrets must not be embedded in TOML');
  if(/^\s*\[assets\]/m.test(sandbox))fail('Do not expose commerce assets or route assets');
  if(!/^\[triggers\]\s*\n\s*crons\s*=\s*\[\s*\]/m.test(sandbox))fail('Cron Triggers must be explicitly disabled');
  if(/^\s*(?:routes?|zone_id)\s*=/m.test(sandbox))fail('Do not attach any Cloudflare zone routes');
  if(/^\[\[(?:services|kv_namespaces|r2_buckets|queues(?:\.[^\]]+)?|durable_objects\.[^\]]+|analytics_engine_datasets)\]\]/m.test(sandbox)){
    fail('External bindings and inherited service links forbidden');
  }
  if(/\b(?:PREVIEW_DB|PREVIEW_APP|PRODUCTION_DB|TOKEN_ENC_KEY|META_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN)\b/.test(sandbox)){
    fail('Live aliases or credentials are forbidden in this config');
  }
  const blocks=d1Blocks(sandbox);
  if(blocks.length!==1)fail('Exactly one dedicated D1 binding required');
  const block=blocks[0];
  const binding=field(block,'binding'),databaseName=field(block,'database_name'),id=field(block,'database_id');
  if(field(block,'migrations_dir')!=='sandbox/migrations')
    fail('D1 may use ONLY isolated auth sandbox migrations, never full commerce migrations');
  if(binding!=='DB')fail('D1 binding must be DB (no PREVIEW_DB)');
  if(!/^[a-z][a-z0-9-]{5,80}$/.test(databaseName)||databaseName.startsWith('REPLACE_'))fail('Dedicated D1 name required');
  const names=[...production.matchAll(/^\s*database_name\s*=\s*"([^"]+)"/gm),...preview.matchAll(/^\s*database_name\s*=\s*"([^"]+)"/gm)].map(x=>x[1]);
  if(names.includes(databaseName))fail('Sandbox D1 database name is an existing live resource');
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))fail('Provide a real, newly provisioned D1 UUID');
  if(uuids(production).includes(id)||uuids(preview).includes(id))fail('Sandbox D1 ID overlaps a live resource');
  const common=[...new Set([...uuids(production),...uuids(preview)])];
  if(!common.length)fail('Live database IDs unavailable for isolation comparison');
  // Static source review alone cannot prove the deployed binding ID, effective
  // secrets, or service egress policy. Those are mandatory, separate checks.
  return {ok:true,offlineOnly:true,sandboxName:name,databaseName,
    matchesKnownLiveResources:false,scheduledTriggers:0,externalBindings:0,
    bindingId:id,knownLiveDatabaseIdsCompared:common.length,
    runtimeIsolationVerified:false,outboundProvidersVerifiedBlocked:false};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const configArg=process.argv[2];
  if(!configArg)throw Error('Usage: node scripts/verify-audit-sandbox-config.mjs <new-sandbox-config.toml> (offline only)');
  const [sandbox,production,preview]=await Promise.all([
    readFile(configArg,'utf8'),
    readFile(new URL('../wrangler.production.toml',import.meta.url),'utf8'),
    readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8')
  ]);
  const result=verifyAuditSandboxConfig(sandbox,production,preview);
  console.log(JSON.stringify(result));
  console.log('Offline static preflight only — STOP before any writes until a reviewer verifies actual deployed D1 ID, absence of credentials and outbound egress policy.');
}
