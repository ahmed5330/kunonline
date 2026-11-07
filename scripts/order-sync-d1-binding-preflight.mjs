/**
 * Offline, read-only configuration gate for the dual-D1 Kun Online worker.
 * Prevents accidental migration of Production's preserved 'DB' when the
 * authenticated Worker currently routes operational APIs via 'PREVIEW_DB'.
 *
 * This checks committed configuration only. Actual deployment binding,
 * backup, and migration approval still require independent verification.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const config=get('wrangler.production.toml');
const matches=[...config.matchAll(/\[\[d1_databases\]\]\s*binding\s*=\s*"([^"]+)"\s*database_name\s*=\s*"([^"]+)"\s*database_id\s*=\s*"([^"]+)"/g)];
const map=new Map(matches.map(x=>[x[1],{name:x[2],id:x[3]}]));
assert(map.has('DB')&&map.has('PREVIEW_DB'),'Expected both isolated D1 bindings');
assert.notEqual(map.get('DB').id,map.get('PREVIEW_DB').id,'D1 bindings must be isolated');
assert.equal(map.get('DB').name,'kunonline');
assert.equal(map.get('PREVIEW_DB').name,'kunonline-preview');
const worker=get('src/index-production-mobile-update.js');
assert(worker.includes("if(key==='DB')return target.PREVIEW_DB"),
  'Operational API D1 routing changed; stop until canonical schema is independently audited');
assert(worker.includes("const dataEnv=previewRuntimeEnv(env)"),
  'Production must not silently mix data bindings for order writes');
const journal=get('migrations/0100_order_change_journal.sql');
const push=get('migrations/0101_mobile_push_device_registry.sql');
assert(journal.includes('order_change_log')&&journal.includes('trg_order_changelog_update'));
assert(push.includes('mobile_push_devices')&&push.includes('token_ciphertext'));
assert(worker.includes("dataEnv.ORDER_CHANGE_FEED_ENABLED!=='1'"),
  'Unapproved D1 migration must not make change feed public automatically');
const handler=get('src/mobile-push.js');
assert(handler.includes("ORDER_FCM_ENABLED==='1'")&&handler.includes("ORDER_CHANGE_FEED_ENABLED==='1'"),
  'FCM must remain disabled without both explicit feature flags');
console.log('PASS: Production canonical API DB is PREVIEW_DB ('+map.get('PREVIEW_DB').name+
  '), distinct from preserved '+map.get('DB').name+
  '; 0100 then 0101 must be backed up and applied to the canonical target only by approved rollout');
