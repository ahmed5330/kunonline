import {readFile} from 'node:fs/promises';

const must=(value,message)=>{if(!value)throw new Error(message);};

const [backend,migration,frontend,entry,schema]=await Promise.all([
  readFile(new URL('../src/internal-collaboration.js',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0091_internal_collaboration.sql',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v117-team-collaboration.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8'),
  readFile(new URL('../src/internal-collaboration-schema.js',import.meta.url),'utf8')
]);

// Tenant + store + conversation membership must be enforced server-side.
must(backend.includes("resolveTenant(me,"),'Collaboration API must resolve tenant from the authenticated user.');
must(backend.includes('resolveStoreScope(env,me,clientId,storeId,{write})'),'Collaboration API must enforce store scope.');
must(backend.includes('c.id=? AND c.client_id=? AND c.store_id=? AND m.user_id=?'),'Conversation reads must require tenant, store and membership.');
must(backend.includes('FROM orders WHERE id=? AND client_id=? AND store_id=?'),'Order references must be scoped to the selected store.');
must(backend.includes('ASSIGNEE_NOT_IN_CONVERSATION'),'Chat-linked assignments must reject non-participants.');
must(backend.includes('await conversationFor(env,clientId,storeId,conversationId,actorId(me))'),'Direct order assignment must validate conversation membership.');
must(backend.includes('conversationIds.has(target)'),'Direct order assignment must validate the assignee is in the linked conversation.');
must(backend.includes('um.sender_user_id<>?'),'A user\'s own sent messages must not increase their unread counter.');

// Tasks attached to private/group conversations must inherit conversation privacy.
must(backend.includes('t.conversation_id IS NULL OR EXISTS (SELECT 1 FROM collab_members tm WHERE tm.conversation_id=t.conversation_id AND tm.user_id=?)'),'Conversation-linked tasks must only be listed to conversation members.');
must(backend.includes('if(current.conversation_id){await conversationFor'),'Editing a conversation-linked task must require conversation membership.');
must(backend.includes('mentions=mentions.filter(id=>conversationIds.has(id))'),'Conversation-linked task mentions must be limited to participants.');
must(backend.includes("لا يمكن إسناد تاسك المحادثة لشخص خارجها"),'Conversation-linked task edits must reject outside assignees.');

// Closed-chat unread notifications must use a lightweight scoped count, not a full bootstrap refresh.
must(backend.includes("path==='/api/collaboration/notifications'"),'Collaboration API must expose a lightweight unread endpoint.');
must(backend.includes('JOIN collab_members mine ON mine.conversation_id=m.conversation_id AND mine.user_id=?'),'Unread counts must only include conversations the user belongs to.');
must(backend.includes('m.client_id=? AND m.store_id=? AND m.sender_user_id<>?'),'Unread counts must be tenant/store scoped and exclude the current user.');
must(frontend.includes("api('/api/collaboration/notifications')"),'Closed collaboration UI must use the lightweight unread endpoint.');
must(frontend.includes('state.open?8000:60000'),'Open chat can refresh frequently while closed chat polling stays lightweight and infrequent.');

// Order assignment is collaboration metadata only; it must not rewrite the order record.
must(backend.includes('collab_order_assignments'),'Order assignment history table must be used.');
must(!backend.includes('UPDATE orders SET assigned_user_id'),'Collaboration must not mutate assignment columns on orders.');

// Migration must remain additive/idempotent and the Worker bootstrap must mirror it.
for(const table of ['collab_conversations','collab_members','collab_messages','collab_message_mentions','collab_reads','collab_tasks','collab_order_assignments']){
  must(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`${table} must be created idempotently.`);
  must(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`${table} must be bootstrapped idempotently through the Worker binding.`);
}
for(const index of ['idx_collab_conversations_store','idx_collab_direct_unique','idx_collab_members_user','idx_collab_messages_conversation','idx_collab_messages_order','idx_collab_mentions_user','idx_collab_tasks_store','idx_collab_tasks_assignee','idx_collab_tasks_order','idx_collab_order_assignments_order','idx_collab_order_assignments_user']){
  must(migration.includes(index),`${index} must exist in migration 0091.`);
  must(schema.includes(index),`${index} must be verified by the Worker bootstrap.`);
}
must(!/\bDROP\s+TABLE\b/i.test(migration),'Collaboration migration must not drop tables.');
must(!/\bDELETE\s+FROM\b/i.test(migration),'Collaboration migration must not delete existing data.');
must(!/\bTRUNCATE\b/i.test(migration),'Collaboration migration must not truncate existing data.');
must(schema.includes('COLLAB_SCHEMA_STATEMENTS'),'Worker bootstrap must keep the additive DDL as explicit statements.');
must(schema.includes('for(const sql of COLLAB_SCHEMA_STATEMENTS)await db.prepare(sql).run()'),'Worker bootstrap must execute each DDL statement independently through the production D1 binding.');
must(!schema.includes('env.DB.exec('),'Worker bootstrap must not rely on multi-statement D1 exec for collaboration DDL.');
must(schema.includes('missingAfter.length'),'Worker bootstrap must verify every required schema object after creation.');

// UI/worker wiring contract.
must(entry.includes("import {handleInternalCollaboration} from './internal-collaboration.js'"),'Production worker must import collaboration handler.');
must(entry.includes("import {ensureInternalCollaborationSchema} from './internal-collaboration-schema.js'"),'Production worker must import collaboration schema bootstrap.');
must(entry.includes("pathname.startsWith('/api/collaboration')"),'Only collaboration API traffic should trigger schema bootstrap.');
must(entry.indexOf('await ensureInternalCollaborationSchema(env)')<entry.indexOf('await handleInternalCollaboration({request,env,ctx,delegate:app})'),'Schema bootstrap must complete before collaboration API handling.');
must(entry.includes('COLLAB_SCHEMA_BOOTSTRAP_FAILED'),'Production must fail closed if schema bootstrap cannot be verified.');
must(entry.includes('await handleInternalCollaboration({request,env,ctx,delegate:app})'),'Production worker must route collaboration API calls.');
must(entry.includes('/v2/modules-v117-team-collaboration.js'),'Production HTML must inject collaboration UI.');
must(frontend.includes("credentials:'include'"),'Collaboration UI must send authenticated requests.');
must(frontend.includes("clientId:state.clientId,storeId:state.storeId"),'Collaboration UI must include tenant/store context.');
must(frontend.includes("body.type==='direct'")||frontend.includes("type:'direct'"),'UI must support private conversations.');
must(frontend.includes('mentions'),'UI must support mentions.');
must(frontend.includes('/api/collaboration/tasks'),'UI must support tasks.');
must(frontend.includes('assignedToUserId'),'UI must support assigning work/orders to team members.');
must(frontend.includes("const allowed=(c.members||[]).filter"),'Chat assignment controls must derive from active conversation members.');

console.log('Internal collaboration isolation, sequential schema bootstrap and contract checks passed.');
