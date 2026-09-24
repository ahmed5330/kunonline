import {readFile} from 'node:fs/promises';

const must=(value,message)=>{if(!value)throw new Error(message);};

const [backend,migration,frontend,entry]=await Promise.all([
  readFile(new URL('../src/internal-collaboration.js',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0091_internal_collaboration.sql',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v117-team-collaboration.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8')
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

// Order assignment is collaboration metadata only; it must not rewrite the order record.
must(backend.includes('collab_order_assignments'),'Order assignment history table must be used.');
must(!backend.includes('UPDATE orders SET assigned_user_id'),'Collaboration must not mutate assignment columns on orders.');

// Migration must remain additive/idempotent.
for(const table of ['collab_conversations','collab_members','collab_messages','collab_message_mentions','collab_reads','collab_tasks','collab_order_assignments']){
  must(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`${table} must be created idempotently.`);
}
must(!/\bDROP\s+TABLE\b/i.test(migration),'Collaboration migration must not drop tables.');
must(!/\bDELETE\s+FROM\b/i.test(migration),'Collaboration migration must not delete existing data.');
must(!/\bTRUNCATE\b/i.test(migration),'Collaboration migration must not truncate existing data.');

// UI/worker wiring contract.
must(entry.includes("import {handleInternalCollaboration} from './internal-collaboration.js'"),'Production worker must import collaboration handler.');
must(entry.includes('await handleInternalCollaboration({request,env,ctx,delegate:app})'),'Production worker must route collaboration API calls.');
must(entry.includes('/v2/modules-v117-team-collaboration.js'),'Production HTML must inject collaboration UI.');
must(frontend.includes("credentials:'include'"),'Collaboration UI must send authenticated requests.');
must(frontend.includes("clientId:state.clientId,storeId:state.storeId"),'Collaboration UI must include tenant/store context.');
must(frontend.includes("body.type==='direct'")||frontend.includes("type:'direct'"),'UI must support private conversations.');
must(frontend.includes('mentions'),'UI must support mentions.');
must(frontend.includes('/api/collaboration/tasks'),'UI must support tasks.');
must(frontend.includes('assignedToUserId'),'UI must support assigning work/orders to team members.');
must(frontend.includes("const allowed=(c.members||[]).filter"),'Chat assignment controls must derive from active conversation members.');

console.log('Internal collaboration isolation and contract checks passed.');
