import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=source('src/internal-collaboration.js');
const web=source('public/v2/modules-v117-team-collaboration.js');
const android=source('android/app/src/main/java/com/kunonline/callerid/MobileCollaboration.kt');
const entry=source('src/index-production-mobile-update.js');
const html=source('public/v2/index.html');
const gradle=source('android/app/build.gradle.kts');

// The read receipt must never consume messages inserted after SELECT completed.
assert.match(server,/const readThrough=results\[0\]\?\.created_at\|\|null/);
assert.match(server,/MAX\(collab_reads.last_read_at,excluded.last_read_at\)/);
assert.match(server,/read_at IS NULL AND created_at<=\?/);
assert.match(server,/await conversationFor\(env,clientId,storeId,conversationId,mine\)/);

// Polling cannot erase partially composed chat messages or interrupt a task modal.
for(const fragment of ['p.dataset.draftKey=draftKey','if(draft!==null','if(orderDraft!==null','if(assignDraft!==null',"if($('.kc-modalback',p))return",'if(state.sending||!state.selected)return']){
  assert.ok(web.includes(fragment), 'Web chat draft safety missing: '+fragment);
}
assert.match(web,/revision!==state.scopeRevision\|\|id!==state.selected/);
assert.match(web,/previousScope!==/);
assert.match(web,/version:'117\.2'/);
assert.match(html,/modules-v117-team-collaboration\.js\?v=117\.2/);
assert.match(entry,/modules-v117-team-collaboration\.js\?v=117\.2/);

// Never pick an arbitrary store based on the first order or first accessible store.
assert.match(android,/KunApi\.loadStoreOptions\(context\)/);
assert.match(android,/result\.stores\.singleOrNull\(\)/);
assert.match(android,/selectedStore == null ->/);
assert.match(android,/val choice = selectedStore \?: return null/);
assert.doesNotMatch(android,/private fun resolveScope\(context: Context, cookie: String\)/);
assert.doesNotMatch(android,/\/api\/state\?clientId=/);
assert.match(android,/quiet: Boolean = false/);
assert.match(gradle,/versionCode\s*=\s*133/);
assert.match(gradle,/versionName\s*=\s*"2\.9\.2"/);
console.log('Collaboration web/native scoped-store, draft, read-receipt and release tests passed.');
