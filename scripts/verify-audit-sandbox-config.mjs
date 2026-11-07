// Static/offline only. Never provisions, deploys, migrates, calls Cloudflare,
// opens remote D1 or verifies the actual runtime binding. Refuse by default.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const denied = message => { throw new Error('UNSAFE_AUDIT_SANDBOX: ' + message); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRestrictedToml(source) {
  const result = new Map();
  let section = 'root';
  const allowed = {
    root: new Set(['name','main','compatibility_date','workers_dev']),
    d1: new Set(['binding','database_name','database_id','migrations_dir']),
    triggers: new Set(['crons']),
    vars: new Set(['APP_ENV','SANDBOX_EGRESS_OFFLINE'])
  };
  for (const raw of String(source).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^(\[\[?)([a-z_][a-z0-9_]*)\]\]?$/);
    if (header) {
      const key = header[2];
      const expected = key === 'd1_databases' ? '[[' : '[';
      if (header[1] !== expected) denied('unexpected TOML table syntax');
      section = key === 'd1_databases' ? 'd1' : key;
      if (!allowed[section]) denied('unexpected table: ' + key);
      const sectionMarker = section + ':table';
      if (result.has(sectionMarker)) denied('duplicate table: ' + key);
      result.set(sectionMarker, true);
      continue;
    }
    const pair = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!pair) denied('unexpected TOML syntax or unsupported inline value');
    const key = pair[1], rawValue = pair[2].replace(/\s+#.*$/, '').trim();
    if (!allowed[section]?.has(key)) denied('unapproved key: ' + section + '.' + key);
    const id = section + ':' + key;
    if (result.has(id)) denied('duplicate key: ' + id);
    if (!/^"(?:[^"\\]|\\.)*"$/.test(rawValue) && !['true','false','[]'].includes(rawValue))
      denied('unsupported/unsafe value: ' + id);
    let value;
    try { value = JSON.parse(rawValue); }
    catch { denied('invalid TOML scalar: ' + id); }
    result.set(id, value);
  }
  return {
    get: (section, key) => result.get(section + ':' + key),
    tables: [...result.keys()].filter(k => k.endsWith(':table'))
  };
}

function liveIdentities(source) {
  const worker = source.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
  const names = [...source.matchAll(/^\s*database_name\s*=\s*"([^"]+)"/gm)].map(x => x[1]);
  const ids = [...source.matchAll(/^\s*database_id\s*=\s*"([^"]+)"/gm)].map(x => x[1].toLowerCase());
  if (!worker || !names.length || !ids.length || names.length !== ids.length)
    denied('missing canonical Production/Preview D1 inventory');
  return {worker, names, ids};
}

export function verifyAuditSandboxConfig(sandbox, production, preview) {
  const s = parseRestrictedToml(sandbox);
  const prod = liveIdentities(production), prev = liveIdentities(preview);
  if (!prod.names.includes('kunonline') || !prod.names.includes('kunonline-preview') ||
      !prev.names.includes('kunonline-preview'))
    denied('canonical live DB names changed; inspect first');
  if (prod.worker !== 'kunonline' || prev.worker !== 'kunonline-preview')
    denied('canonical live Worker names changed; inspect first');

  if (s.tables.join(',') !== 'd1:table,triggers:table,vars:table')
    denied('exactly one D1, triggers and vars table are required');
  const worker = s.get('root','name');
  const database = s.get('d1','database_name');
  const id = s.get('d1','database_id');
  if (typeof worker !== 'string' || !/^kunonline-audit-sandbox-[a-z0-9-]{4,36}$/.test(worker) ||
      worker === prod.worker || worker === prev.worker)
    denied('unique audit sandbox Worker name required');
  if (s.get('root','main') !== 'src/audit-sandbox-probe.js')
    denied('audit sandbox must use restricted probe entrypoint');
  if (s.get('root','compatibility_date') !== '2026-08-23')
    denied('compatibility_date must match reviewed probe');
  if (s.get('root','workers_dev') !== false)
    denied('public workers.dev URL must be disabled');
  if (typeof database !== 'string' || !/^kunonline-audit-sandbox-[a-z0-9-]{4,36}$/.test(database) ||
      [...prod.names,...prev.names].includes(database))
    denied('dedicated audit sandbox D1 name required');
  if (typeof id !== 'string' || !uuid.test(id) ||
      [...prod.ids,...prev.ids].includes(id.toLowerCase()))
    denied('new D1 UUID required and must differ from BOTH live databases');
  if (s.get('d1','binding') !== 'DB')
    denied('probe requires a single dedicated DB binding only');
  if (s.get('d1','migrations_dir') !== 'sandbox/migrations')
    denied('commerce migrations must never run on the sandbox');
  if (!Array.isArray(s.get('triggers','crons')) || s.get('triggers','crons').length)
    denied('Cron must be empty');
  if (s.get('vars','APP_ENV') !== 'audit_sandbox' ||
      s.get('vars','SANDBOX_EGRESS_OFFLINE') !== 'true')
    denied('sandbox env and offline marker required');

  return {
    ok:true, offlinePreflight:true, uniqueAgainstConfiguredLiveIds:true,
    knownLiveD1Count:new Set([...prod.ids,...prev.ids]).size,
    isolatedRuntimeVerified:false, actualCloudflareBindingVerified:false,
    backupsVerified:false, restoreVerified:false, readyToDeploy:false
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) denied('usage: node scripts/verify-audit-sandbox-config.mjs <explicit-file.toml>');
  const [sandbox, production, preview] = await Promise.all([
    readFile(path,'utf8'),
    readFile(new URL('../wrangler.production.toml',import.meta.url),'utf8'),
    readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8')
  ]);
  console.log(JSON.stringify(verifyAuditSandboxConfig(sandbox,production,preview),null,2));
  console.log('STOP: requires independent Cloudflare binding verification, backups and explicit approval before any remote operation.');
}
