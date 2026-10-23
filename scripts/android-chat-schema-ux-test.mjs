import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const backend = readFileSync(new URL('../src/internal-collaboration.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/MobileCollaboration.kt', import.meta.url), 'utf8');
const home = readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/KunNativeAppV25.kt', import.meta.url), 'utf8');

assert.ok(backend.includes('PRAGMA table_info(collab_messages)'), 'Legacy columns must be detected, not assumed');
assert.ok(backend.includes("column.name==='channel_id'"), 'The legacy NOT NULL field must be detected');
assert.ok(backend.includes('...(legacyChannel?[conversationId]:[])'), 'The legacy ID must be populated');
assert.ok(backend.includes('COLLAB_STORAGE_ERROR'), 'Do not leak raw SQL diagnostics to staff');

// Execute exactly the two SQL variants from the production Worker against
// SQLite's actual NOT NULL constraint. No production rows are touched.
const sqlVariants = [...backend.matchAll(/'INSERT INTO collab_messages \([^']+\) VALUES \([^']+\)'/g)].map(match => match[0].slice(1, -1));
const legacy = sqlVariants.find(sql => sql.includes('channel_id'));
const canonical = sqlVariants.find(sql => !sql.includes('channel_id'));
assert.ok(legacy && canonical, 'Both schema generations must remain supported');
// Test actual SQLite constraints through Node's built-in SQLite engine.
// This works on Linux and Windows without relying on python3 or py.exe.
for (const [mode,sql] of [['legacy',legacy],['canonical',canonical]]) {
  const db=new DatabaseSync(':memory:');
  try {
    const channel=mode==='legacy'?', channel_id TEXT NOT NULL':'';
    db.exec('CREATE TABLE collab_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL'+channel+', client_id TEXT, store_id TEXT, sender_user_id TEXT, sender_name TEXT, body TEXT, order_id TEXT, assigned_to_user_id TEXT, assigned_to_name TEXT, task_id TEXT, mentions_json TEXT, created_at TEXT)');
    const fields=sql.slice(sql.indexOf('(')+1,sql.indexOf(')')).split(',').map(x=>x.trim());
    const args=fields.map(field=>['conversation_id','channel_id'].includes(field)?'CONV-1':field==='id'?'MSG-1':'test');
    db.prepare(sql).run(...args);
    const row=db.prepare('SELECT conversation_id'+(mode==='legacy'?', channel_id':'')+' FROM collab_messages').get();
    assert.equal(row.conversation_id,'CONV-1',mode+' must preserve conversation ID');
    if(mode==='legacy')assert.equal(row.channel_id,'CONV-1','legacy NOT NULL channel ID must be populated');
  }finally{
    db.close();
  }
}

for (const value of ['validText(', 'جاري تحميل الرسائل', 'جاري تحميل وتحديث بيانات التواصل', 'KunApi.cachedStoreOptions', 'Icons.Outlined.AddComment', 'Icons.Outlined.Refresh', 'Icons.Outlined.Storefront', 'Icons.Outlined.Send', 'FilledTonalButton(onClick = onHome)']) {
  assert.ok(chat.includes(value), 'Chat UI lost required affordance: '+value);
}
const design = readFileSync(new URL('../android/app/src/main/java/com/kunonline/callerid/KunDesignV3.kt', import.meta.url), 'utf8');
assert.ok(home.includes('KunGreetingHero('), 'Home must delegate the time-aware greeting to its shared component');
for (const greeting of ['صباح الخير', 'مساء الخير']) assert.ok(design.includes(greeting), 'Greeting must remain available: ' + greeting);
for (const value of ['KunApi.userDisplayName(context)', 'MobileV25Tab.CUSTOMER_SERVICE', 'MobileV25Tab.ORDERS', 'onOpenCollaboration', 'onOpenSystemSections']) {
  assert.ok(home.includes(value), 'Android home lost required affordance: '+value);
}
console.log('SQLite legacy and canonical collaboration message inserts passed');
console.log('Android collaboration compatibility, loading, personalization and navigation contracts passed');
