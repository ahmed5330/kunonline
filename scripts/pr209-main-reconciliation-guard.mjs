// Offline merge safety guard. Does not read Cloudflare, secrets, or live data.
// This is a source gate, NOT authorization to choose a live D1 migration.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [entry,revoker,ui,html,pkg,loginUI]=await Promise.all([
  read('src/index.js'),read('src/session-revocation.js'),
  read('public/v2/modules-v23-admin.js'),read('public/v2/index.html'),
  read('package.json'),read('public/v2/modules-v26-auth.js')
]);
const names=(await readdir(new URL('migrations/',root)))
  .filter(name=>name.endsWith('.sql')&&(/session.revoc|revoked.session|(?:^|[_-])0098[_-]/i.test(name)));
assert.deepEqual(names,['2026-10-23-session-revocation.sql'],
  'STOP MERGE: simultaneous 0099_revoked_sessions.sql and PR session-revocation migration are incompatible; reconcile remote D1 ledgers and choose ONE schema');
assert.match(revoker,/FROM revoked_session_tokens\b/);
assert.match(revoker,/INTO revoked_session_tokens\b/);
assert.doesNotMatch(entry,/FROM revoked_sessions\b|INTO revoked_sessions\b/,
  'STOP MERGE: legacy main revoked_sessions queries cannot run against PR schema');
assert.match(entry,/request\.method !== 'POST'/,'Logout mutates state and must require POST');
assert.match(entry,/hasDuplicateSessionCookies\(request\)/,
  'Fail closed on ambiguous session cookies');
assert.match(entry,/revokeSession\(env,sessionTokenFromRequest\(request\)/,
  'Revocation must target exact authenticated token');
assert.match(entry,/TOKEN_ENC_KEY is required to store secrets/,
  'Do not reintroduce plaintext secret persistence');
assert.match(ui,/K\._v23ClientAdminPending/,'Preserve main in-flight owner drawer deduplication');
assert.match(ui,/resetInput\.type\s*=\s*'password'|id="v23ResetPassword" type="password"/,
  'Owner reset input must be masked');
assert.match(ui,/result\?\.ok\s*!==\s*true/,
  'A missing success receipt must not display password reset success');
assert.match(html,/modules-v23-admin\.js\?v=23\.6/,'Browser must not cache pre-fix admin UI');
assert.match(loginUI,/showAuth\('login'\)/);
const scripts=JSON.parse(pkg).scripts;
assert.match(scripts['test:admin-client-command'],/admin-client-password-reset-ui-test\.mjs/,
  'Run preserved main admin UI regression with normal CI');
assert.match(scripts['test:session-revocation-schema'],/pr209-main-reconciliation-guard\.mjs/,
  'Run this conflict guard in normal CI');
console.log('Offline main/PR209 reconciliation guard PASS (source only). Remote D1 schema and deployed Workers remain UNVERIFIED.');
