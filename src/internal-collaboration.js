import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const now=()=>new Date().toISOString();
const rid=prefix=>`${prefix}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const uniq=arr=>[...new Set((arr||[]).map(x=>clean(x,200)).filter(Boolean))];
const TASK_STATUSES=new Set(['open','in_progress','done','cancelled']);
const TASK_PRIORITIES=new Set(['low','normal','high','urgent']);

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}
function actorId(me){return clean(me?.uid||me?.id||me?.email,200);}
function actorName(me){return clean(me?.name||me?.email||me?.role||'مستخدم',200);}
function requestedClient(me,url,body={}){return resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId||null);}
function requestedStore(url,body={}){return clean(body.storeId||body.store_id||url.searchParams.get('storeId'),180);}
function schemaError(error){return /no such table|no such column/i.test(String(error?.message||''));}
async function requireSchema(env){
  const row=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collab_conversations'").first();
  if(!row)throw Object.assign(new Error('ميزة تواصل الفريق جاهزة في الكود وتحتاج تفعيل مخطط قاعدة البيانات'),{status:503,code:'COLLAB_SCHEMA_REQUIRED'});
}
async function scopeFor(env,me,clientId,storeId,{write=false}={}){
  if(!storeId)throw Object.assign(new Error('اختار متجر/فرع قبل فتح تواصل الفريق'),{status:400,code:'STORE_SELECTION_REQUIRED'});
  return resolveStoreScope(env,me,clientId,storeId,{write});
}
async function visibleMembers(env,me,clientId,storeId){
  const {results=[]}=await env.DB.prepare(`
    SELECT DISTINCT u.id,u.name,u.email,u.role,u.status
    FROM users u
    LEFT JOIN user_store_access a ON a.user_id=u.id AND a.client_id=? AND a.store_id=?
    WHERE COALESCE(u.status,'active')='active' AND (
      (u.client_id=? AND (u.role='client' OR a.store_id=?))
      OR (u.client_id IS NULL AND a.client_id=? AND a.store_id=?)
    )
    ORDER BY CASE WHEN u.role='client' THEN 0 ELSE 1 END,COALESCE(u.name,u.email)
  `).bind(clientId,storeId,clientId,storeId,clientId,storeId).all();
  const result=results.map(row=>({id:String(row.id),name:row.name||row.email||row.id,email:row.email||'',role:row.role||'member'}));
  const mine=actorId(me);
  if(mine&&!result.some(x=>String(x.id)===mine)&&(me.role==='admin'||me.role==='client'))result.unshift({id:mine,name:actorName(me),email:me.email||'',role:me.role});
  return result;
}
async function memberMap(env,me,clientId,storeId){return new Map((await visibleMembers(env,me,clientId,storeId)).map(x=>[String(x.id),x]));}
async function orderForStore(env,clientId,storeId,orderId){
  const id=clean(orderId,180);if(!id)return null;
  const row=await env.DB.prepare('SELECT id,name,phone,state,total FROM orders WHERE id=? AND client_id=? AND store_id=?').bind(id,clientId,storeId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود داخل الفرع المحدد'),{status:404,code:'ORDER_NOT_FOUND'});
  return row;
}
async function conversationFor(env,clientId,storeId,conversationId,userId){
  const row=await env.DB.prepare(`SELECT c.* FROM collab_conversations c JOIN collab_members m ON m.conversation_id=c.id WHERE c.id=? AND c.client_id=? AND c.store_id=? AND m.user_id=?`).bind(conversationId,clientId,storeId,userId).first();
  if(!row)throw Object.assign(new Error('المحادثة غير موجودة أو غير مسموح لك بها'),{status:404,code:'CONVERSATION_NOT_FOUND'});
  return row;
}
async function conversationMembers(env,conversationId){
  const {results=[]}=await env.DB.prepare(`SELECT m.user_id,u.name,u.email,u.role FROM collab_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? ORDER BY COALESCE(u.name,u.email,m.user_id)`).bind(conversationId).all();
  return results.map(row=>({id:String(row.user_id),name:row.name||row.email||row.user_id,email:row.email||'',role:row.role||'member'}));
}
async function conversationMemberIds(env,conversationId){return new Set((await conversationMembers(env,conversationId)).map(x=>String(x.id)));}
async function listConversations(env,{clientId,storeId,userId}){
  const {results=[]}=await env.DB.prepare(`
    SELECT c.id,c.type,c.name,c.created_by,c.created_at,c.updated_at,
      (SELECT body FROM collab_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) last_body,
      (SELECT sender_name FROM collab_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) last_sender,
      (SELECT created_at FROM collab_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) last_message_at,
      (SELECT COUNT(*) FROM collab_messages um WHERE um.conversation_id=c.id AND um.sender_user_id<>? AND um.created_at>COALESCE((SELECT last_read_at FROM collab_reads r WHERE r.conversation_id=c.id AND r.user_id=?),'1970-01-01T00:00:00.000Z')) unread_count
    FROM collab_conversations c
    JOIN collab_members mine ON mine.conversation_id=c.id AND mine.user_id=?
    WHERE c.client_id=? AND c.store_id=?
    ORDER BY COALESCE(last_message_at,c.updated_at) DESC
  `).bind(userId,userId,userId,clientId,storeId).all();
  const membership=await env.DB.prepare(`SELECT m.conversation_id,m.user_id,u.name,u.email,u.role FROM collab_members m JOIN collab_conversations c ON c.id=m.conversation_id LEFT JOIN users u ON u.id=m.user_id WHERE c.client_id=? AND c.store_id=? ORDER BY COALESCE(u.name,u.email,m.user_id)`).bind(clientId,storeId).all();
  const byConversation=new Map();for(const row of membership.results||[]){if(!byConversation.has(row.conversation_id))byConversation.set(row.conversation_id,[]);byConversation.get(row.conversation_id).push({id:String(row.user_id),name:row.name||row.email||row.user_id,email:row.email||'',role:row.role||'member'});}
  return results.map(row=>({...row,unreadCount:Number(row.unread_count||0),members:byConversation.get(row.id)||[]}));
}
async function notificationSummary(env,{me,clientId,storeId}){
  await scopeFor(env,me,clientId,storeId,{write:false});await requireSchema(env);const userId=actorId(me);
  const row=await env.DB.prepare(`
    SELECT COUNT(*) count
    FROM collab_messages m
    JOIN collab_members mine ON mine.conversation_id=m.conversation_id AND mine.user_id=?
    LEFT JOIN collab_reads r ON r.conversation_id=m.conversation_id AND r.user_id=?
    WHERE m.client_id=? AND m.store_id=? AND m.sender_user_id<>?
      AND m.created_at>COALESCE(r.last_read_at,'1970-01-01T00:00:00.000Z')
  `).bind(userId,userId,clientId,storeId,userId).first();
  return {ok:true,unreadMessages:Number(row?.count||0)};
}
async function listTasks(env,{clientId,storeId,userId,status=''}){
  const binds=[clientId,storeId,userId];let where='t.client_id=? AND t.store_id=? AND (t.conversation_id IS NULL OR EXISTS (SELECT 1 FROM collab_members tm WHERE tm.conversation_id=t.conversation_id AND tm.user_id=?))';
  if(status&&TASK_STATUSES.has(status)){where+=' AND t.status=?';binds.push(status);}
  const {results=[]}=await env.DB.prepare(`SELECT t.* FROM collab_tasks t WHERE ${where} ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,COALESCE(t.due_at,'9999-12-31'),t.created_at DESC LIMIT 250`).bind(...binds).all();
  return results.map(row=>({...row,mentions:JSON.parse(row.mentions_json||'[]')}));
}
async function bootstrap(env,{me,clientId,storeId}){
  await scopeFor(env,me,clientId,storeId,{write:false});await requireSchema(env);
  const userId=actorId(me),members=await visibleMembers(env,me,clientId,storeId),conversations=await listConversations(env,{clientId,storeId,userId}),tasks=await listTasks(env,{clientId,storeId,userId});
  const mentionRow=await env.DB.prepare('SELECT COUNT(*) count FROM collab_message_mentions mm JOIN collab_messages m ON m.id=mm.message_id WHERE mm.user_id=? AND mm.read_at IS NULL AND m.client_id=? AND m.store_id=?').bind(userId,clientId,storeId).first();
  return {ok:true,me:{id:userId,name:actorName(me),role:me.role},clientId,storeId,members,conversations,tasks,unreadMentions:Number(mentionRow?.count||0),serverTime:now()};
}
async function createConversation(env,{me,clientId,storeId,body}){
  await scopeFor(env,me,clientId,storeId,{write:true});await requireSchema(env);
  const mine=actorId(me),type=body.type==='direct'?'direct':'group',members=await memberMap(env,me,clientId,storeId),ts=now();
  if(type==='direct'){
    const target=clean(body.targetUserId,200);if(!target||target===mine)throw Object.assign(new Error('اختار عضوًا آخر للمحادثة الخاصة'),{status:400,code:'DIRECT_TARGET_REQUIRED'});
    if(!members.has(target))throw Object.assign(new Error('عضو الفريق غير متاح في هذا الفرع'),{status:400,code:'TEAM_MEMBER_INVALID'});
    const directKey=[mine,target].sort().join(':');
    const existing=await env.DB.prepare("SELECT id FROM collab_conversations WHERE client_id=? AND store_id=? AND type='direct' AND direct_key=?").bind(clientId,storeId,directKey).first();
    if(existing)return {ok:true,id:existing.id,reused:true};
    const id=rid('CONV');await env.DB.batch([
      env.DB.prepare("INSERT INTO collab_conversations (id,client_id,store_id,type,name,created_by,created_at,updated_at,direct_key) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,clientId,storeId,'direct',null,mine,ts,ts,directKey),
      env.DB.prepare('INSERT INTO collab_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(id,mine,'member',ts),
      env.DB.prepare('INSERT INTO collab_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(id,target,'member',ts)
    ]);return {ok:true,id,reused:false};
  }
  const name=clean(body.name,120);if(!name)throw Object.assign(new Error('اسم المجموعة مطلوب'),{status:400,code:'GROUP_NAME_REQUIRED'});
  const requested=uniq(body.memberIds);requested.push(mine);const ids=uniq(requested);
  for(const id of ids)if(!members.has(id)&&id!==mine)throw Object.assign(new Error('أحد أعضاء المجموعة غير متاح في هذا الفرع'),{status:400,code:'TEAM_MEMBER_INVALID'});
  const id=rid('CONV'),statements=[env.DB.prepare("INSERT INTO collab_conversations (id,client_id,store_id,type,name,created_by,created_at,updated_at,direct_key) VALUES (?,?,?,?,?,?,?,?,NULL)").bind(id,clientId,storeId,'group',name,mine,ts,ts)];
  for(const memberId of ids)statements.push(env.DB.prepare('INSERT INTO collab_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(id,memberId,memberId===mine?'owner':'member',ts));
  await env.DB.batch(statements);return {ok:true,id};
}
async function getMessages(env,{me,clientId,storeId,conversationId}){
  await scopeFor(env,me,clientId,storeId,{write:false});await requireSchema(env);const mine=actorId(me);await conversationFor(env,clientId,storeId,conversationId,mine);
  const {results=[]}=await env.DB.prepare(`SELECT id,conversation_id,sender_user_id,sender_name,body,order_id,assigned_to_user_id,assigned_to_name,task_id,mentions_json,created_at FROM collab_messages WHERE conversation_id=? AND client_id=? AND store_id=? ORDER BY created_at DESC LIMIT 150`).bind(conversationId,clientId,storeId).all();
  const ts=now();await env.DB.batch([
    env.DB.prepare(`INSERT INTO collab_reads (conversation_id,user_id,last_read_at) VALUES (?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_at=excluded.last_read_at`).bind(conversationId,mine,ts),
    env.DB.prepare('UPDATE collab_message_mentions SET read_at=? WHERE conversation_id=? AND user_id=? AND read_at IS NULL').bind(ts,conversationId,mine)
  ]);
  return {ok:true,messages:results.reverse().map(row=>({...row,mentions:JSON.parse(row.mentions_json||'[]')}))};
}
async function assignOrder(env,{clientId,storeId,orderId,target,targetName,me,conversationId,messageId,note}){
  const ts=now(),mine=actorId(me),mineName=actorName(me);await orderForStore(env,clientId,storeId,orderId);
  await env.DB.batch([
    env.DB.prepare("UPDATE collab_order_assignments SET status='reassigned',updated_at=? WHERE client_id=? AND store_id=? AND order_id=? AND status='active'").bind(ts,clientId,storeId,orderId),
    env.DB.prepare('INSERT INTO collab_order_assignments (id,client_id,store_id,order_id,assigned_to_user_id,assigned_to_name,assigned_by_user_id,assigned_by_name,conversation_id,message_id,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(rid('ASN'),clientId,storeId,orderId,target,targetName,mine,mineName,conversationId||null,messageId||null,clean(note,1000)||null,'active',ts,ts)
  ]);
  try{await env.DB.prepare(`INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('OEV'),clientId,storeId,orderId,'assigned',me?.uid||me?.id||null,me?.email||me?.role||null,'internal-collaboration',JSON.stringify({assignedToUserId:target,assignedToName:targetName,conversationId,messageId}),ts).run();}catch{}
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,storeId,me?.uid||me?.id||null,me?.email||me?.role||null,'order.assign','order',orderId,JSON.stringify({assignedToUserId:target,assignedToName:targetName,conversationId,messageId}),ts).run();}catch{}
}
async function sendMessage(env,{me,clientId,storeId,conversationId,body}){
  await scopeFor(env,me,clientId,storeId,{write:true});await requireSchema(env);const mine=actorId(me),mineName=actorName(me);await conversationFor(env,clientId,storeId,conversationId,mine);
  const text=clean(body.body,4000),orderId=clean(body.orderId,180),assignedTo=clean(body.assignedToUserId,200),memberIds=await conversationMemberIds(env,conversationId),mentions=uniq(body.mentions).filter(id=>memberIds.has(id));
  if(orderId)await orderForStore(env,clientId,storeId,orderId);
  const storeMembers=await memberMap(env,me,clientId,storeId);if(assignedTo&&!storeMembers.has(assignedTo))throw Object.assign(new Error('الشخص المسند إليه غير متاح في هذا الفرع'),{status:400,code:'ASSIGNEE_INVALID'});
  if(assignedTo&&!memberIds.has(assignedTo))throw Object.assign(new Error('أضف الشخص للمحادثة قبل إسناد الأوردر إليه'),{status:400,code:'ASSIGNEE_NOT_IN_CONVERSATION'});
  if(assignedTo&&!orderId)throw Object.assign(new Error('اختار رقم الأوردر قبل تعيينه لشخص'),{status:400,code:'ORDER_REQUIRED_FOR_ASSIGNMENT'});
  const taskData=body.createTask&&typeof body.createTask==='object'?body.createTask:null;
  if(!text&&!orderId&&!taskData)throw Object.assign(new Error('اكتب رسالة أو اربط أوردر أو أنشئ تاسك'),{status:400,code:'MESSAGE_EMPTY'});
  const ts=now(),messageId=rid('MSG'),taskId=taskData?rid('TSK'):null,targetName=assignedTo?(storeMembers.get(assignedTo)?.name||assignedTo):'';
  const statements=[env.DB.prepare('INSERT INTO collab_messages (id,conversation_id,client_id,store_id,sender_user_id,sender_name,body,order_id,assigned_to_user_id,assigned_to_name,task_id,mentions_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(messageId,conversationId,clientId,storeId,mine,mineName,text,orderId||null,assignedTo||null,targetName||null,taskId,JSON.stringify(mentions),ts),env.DB.prepare('UPDATE collab_conversations SET updated_at=? WHERE id=?').bind(ts,conversationId)];
  for(const userId of mentions)statements.push(env.DB.prepare('INSERT OR IGNORE INTO collab_message_mentions (id,message_id,conversation_id,user_id,created_at,read_at) VALUES (?,?,?,?,?,NULL)').bind(rid('MEN'),messageId,conversationId,userId,ts));
  if(taskData){
    const title=clean(taskData.title||text,240);if(!title)throw Object.assign(new Error('عنوان التاسك مطلوب'),{status:400,code:'TASK_TITLE_REQUIRED'});
    const taskAssignee=clean(taskData.assignedToUserId||assignedTo,200),priority=TASK_PRIORITIES.has(taskData.priority)?taskData.priority:'normal',dueAt=clean(taskData.dueAt,60)||null;
    if(taskAssignee&&!storeMembers.has(taskAssignee))throw Object.assign(new Error('المسند إليه في التاسك غير متاح'),{status:400,code:'ASSIGNEE_INVALID'});
    if(taskAssignee&&!memberIds.has(taskAssignee))throw Object.assign(new Error('أضف الشخص للمحادثة قبل إسناد التاسك إليه'),{status:400,code:'ASSIGNEE_NOT_IN_CONVERSATION'});
    statements.push(env.DB.prepare('INSERT INTO collab_tasks (id,client_id,store_id,conversation_id,title,description,status,priority,due_at,order_id,assigned_to_user_id,assigned_to_name,created_by,created_by_name,mentions_json,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)').bind(taskId,clientId,storeId,conversationId,title,clean(taskData.description,2000)||null,'open',priority,dueAt,orderId||null,taskAssignee||null,taskAssignee?(storeMembers.get(taskAssignee)?.name||taskAssignee):null,mine,mineName,JSON.stringify(mentions),ts,ts));
  }
  await env.DB.batch(statements);if(assignedTo)await assignOrder(env,{clientId,storeId,orderId,target:assignedTo,targetName,me,conversationId,messageId,note:text});
  return {ok:true,id:messageId,taskId};
}
async function createTask(env,{me,clientId,storeId,body}){
  await scopeFor(env,me,clientId,storeId,{write:true});await requireSchema(env);const mine=actorId(me),mineName=actorName(me),title=clean(body.title,240);if(!title)throw Object.assign(new Error('عنوان التاسك مطلوب'),{status:400,code:'TASK_TITLE_REQUIRED'});
  const members=await memberMap(env,me,clientId,storeId),assignedTo=clean(body.assignedToUserId,200),orderId=clean(body.orderId,180),conversationId=clean(body.conversationId,200);let mentions=uniq(body.mentions).filter(x=>members.has(x));
  if(assignedTo&&!members.has(assignedTo))throw Object.assign(new Error('المسند إليه غير متاح في هذا الفرع'),{status:400,code:'ASSIGNEE_INVALID'});if(orderId)await orderForStore(env,clientId,storeId,orderId);
  if(conversationId){
    await conversationFor(env,clientId,storeId,conversationId,mine);const conversationIds=await conversationMemberIds(env,conversationId);
    if(assignedTo&&!conversationIds.has(assignedTo))throw Object.assign(new Error('أضف الشخص للمحادثة قبل إسناد التاسك إليه'),{status:400,code:'ASSIGNEE_NOT_IN_CONVERSATION'});
    mentions=mentions.filter(id=>conversationIds.has(id));
  }
  const priority=TASK_PRIORITIES.has(body.priority)?body.priority:'normal',status=TASK_STATUSES.has(body.status)?body.status:'open',ts=now(),id=rid('TSK');
  await env.DB.prepare('INSERT INTO collab_tasks (id,client_id,store_id,conversation_id,title,description,status,priority,due_at,order_id,assigned_to_user_id,assigned_to_name,created_by,created_by_name,mentions_json,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,clientId,storeId,conversationId||null,title,clean(body.description,2000)||null,status,priority,clean(body.dueAt,60)||null,orderId||null,assignedTo||null,assignedTo?(members.get(assignedTo)?.name||assignedTo):null,mine,mineName,JSON.stringify(mentions),ts,ts,status==='done'?ts:null).run();
  return {ok:true,id};
}
async function updateTask(env,{me,clientId,storeId,taskId,body}){
  await scopeFor(env,me,clientId,storeId,{write:true});await requireSchema(env);const mine=actorId(me),current=await env.DB.prepare('SELECT * FROM collab_tasks WHERE id=? AND client_id=? AND store_id=?').bind(taskId,clientId,storeId).first();if(!current)throw Object.assign(new Error('التاسك غير موجود'),{status:404,code:'TASK_NOT_FOUND'});
  let conversationIds=null;if(current.conversation_id){await conversationFor(env,clientId,storeId,current.conversation_id,mine);conversationIds=await conversationMemberIds(env,current.conversation_id);}
  const members=await memberMap(env,me,clientId,storeId),status=body.status!==undefined?String(body.status):current.status,priority=body.priority!==undefined?String(body.priority):current.priority,assignedTo=body.assignedToUserId!==undefined?clean(body.assignedToUserId,200):clean(current.assigned_to_user_id,200);
  if(!TASK_STATUSES.has(status))throw Object.assign(new Error('حالة التاسك غير صحيحة'),{status:400,code:'TASK_STATUS_INVALID'});if(!TASK_PRIORITIES.has(priority))throw Object.assign(new Error('أولوية التاسك غير صحيحة'),{status:400,code:'TASK_PRIORITY_INVALID'});if(assignedTo&&!members.has(assignedTo))throw Object.assign(new Error('المسند إليه غير متاح'),{status:400,code:'ASSIGNEE_INVALID'});if(assignedTo&&conversationIds&&!conversationIds.has(assignedTo))throw Object.assign(new Error('لا يمكن إسناد تاسك المحادثة لشخص خارجها'),{status:400,code:'ASSIGNEE_NOT_IN_CONVERSATION'});
  const orderId=body.orderId!==undefined?clean(body.orderId,180):clean(current.order_id,180);if(orderId)await orderForStore(env,clientId,storeId,orderId);const ts=now();
  await env.DB.prepare('UPDATE collab_tasks SET title=?,description=?,status=?,priority=?,due_at=?,order_id=?,assigned_to_user_id=?,assigned_to_name=?,updated_at=?,completed_at=? WHERE id=? AND client_id=? AND store_id=?').bind(body.title!==undefined?clean(body.title,240):current.title,body.description!==undefined?clean(body.description,2000):current.description,status,priority,body.dueAt!==undefined?(clean(body.dueAt,60)||null):current.due_at,orderId||null,assignedTo||null,assignedTo?(members.get(assignedTo)?.name||assignedTo):null,ts,status==='done'?(current.completed_at||ts):null,taskId,clientId,storeId).run();
  return {ok:true,id:taskId};
}
async function directAssign(env,{me,clientId,storeId,orderId,body}){
  await scopeFor(env,me,clientId,storeId,{write:true});await requireSchema(env);const members=await memberMap(env,me,clientId,storeId),target=clean(body.assignedToUserId,200);if(!target||!members.has(target))throw Object.assign(new Error('اختار عضو فريق متاح'),{status:400,code:'ASSIGNEE_INVALID'});
  const conversationId=clean(body.conversationId,200)||null;
  if(conversationId){
    await conversationFor(env,clientId,storeId,conversationId,actorId(me));
    const conversationIds=await conversationMemberIds(env,conversationId);
    if(!conversationIds.has(target))throw Object.assign(new Error('لا يمكن ربط التعيين بمحادثة لا تضم الشخص المسند إليه'),{status:400,code:'ASSIGNEE_NOT_IN_CONVERSATION'});
  }
  const targetName=members.get(target)?.name||target;await assignOrder(env,{clientId,storeId,orderId,target,targetName,me,conversationId,messageId:null,note:clean(body.note,1000)});return {ok:true,orderId,assignedTo:{id:target,name:targetName}};
}

export async function handleInternalCollaboration({request,env,ctx={},delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();if(!path.startsWith('/api/collaboration'))return null;
  try{
    const me=await currentUser(request,env,ctx,delegate),body=['POST','PUT','PATCH'].includes(method)?await request.clone().json().catch(()=>({})):{};
    const clientId=requestedClient(me,url,body),storeId=requestedStore(url,body);
    if(path==='/api/collaboration/bootstrap'&&method==='GET')return json(await bootstrap(env,{me,clientId,storeId}));
    if(path==='/api/collaboration/notifications'&&method==='GET')return json(await notificationSummary(env,{me,clientId,storeId}));
    if(path==='/api/collaboration/conversations'&&method==='GET'){await scopeFor(env,me,clientId,storeId);await requireSchema(env);return json({ok:true,conversations:await listConversations(env,{clientId,storeId,userId:actorId(me)})});}
    if(path==='/api/collaboration/conversations'&&method==='POST')return json(await createConversation(env,{me,clientId,storeId,body}),201);
    const messagesMatch=path.match(/^\/api\/collaboration\/conversations\/([^/]+)\/messages$/);
    if(messagesMatch&&method==='GET')return json(await getMessages(env,{me,clientId,storeId,conversationId:decodeURIComponent(messagesMatch[1])}));
    if(messagesMatch&&method==='POST')return json(await sendMessage(env,{me,clientId,storeId,conversationId:decodeURIComponent(messagesMatch[1]),body}),201);
    if(path==='/api/collaboration/tasks'&&method==='GET'){await scopeFor(env,me,clientId,storeId);await requireSchema(env);return json({ok:true,tasks:await listTasks(env,{clientId,storeId,userId:actorId(me),status:url.searchParams.get('status')||''})});}
    if(path==='/api/collaboration/tasks'&&method==='POST')return json(await createTask(env,{me,clientId,storeId,body}),201);
    const taskMatch=path.match(/^\/api\/collaboration\/tasks\/([^/]+)$/);if(taskMatch&&method==='PATCH')return json(await updateTask(env,{me,clientId,storeId,taskId:decodeURIComponent(taskMatch[1]),body}));
    const assignMatch=path.match(/^\/api\/collaboration\/orders\/([^/]+)\/assign$/);if(assignMatch&&method==='POST')return json(await directAssign(env,{me,clientId,storeId,orderId:decodeURIComponent(assignMatch[1]),body}));
    return json({error:'مسار تعاون غير معروف'},404);
  }catch(error){if(schemaError(error))return json({error:'ميزة تواصل الفريق تحتاج تفعيل مخطط قاعدة البيانات',code:'COLLAB_SCHEMA_REQUIRED'},503);return json({error:error?.message||'تعذر تنفيذ طلب تواصل الفريق',code:error?.code||'COLLAB_ERROR'},error?.status||500);}
}
