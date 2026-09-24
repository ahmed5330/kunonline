import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,12).toUpperCase()}`;
const TASK_STATUS=new Set(['open','in_progress','done','cancelled']);
const TASK_PRIORITY=new Set(['low','normal','high','urgent']);

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}
const actorId=me=>clean(me?.uid||me?.id||me?.email||`${me?.role||'user'}:${me?.clientId||''}`,200);
const actorName=me=>clean(me?.name||me?.email||me?.role||'مستخدم',200);

async function scopeFor({request,env,me,url,body={},write=false}){
  const requestedClient=body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId||null;
  const clientId=resolveTenant(me,requestedClient);
  const requestedStore=clean(body.storeId||body.store_id||url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||'',180)||null;
  const scope=await resolveStoreScope(env,me,clientId,requestedStore,{write});
  if(!scope.storeId)throw Object.assign(new Error('اختار فرعًا/متجرًا من أعلى قبل فتح تواصل الفريق'),{status:400,code:'COLLAB_STORE_REQUIRED'});
  return {clientId:String(clientId),storeId:String(scope.storeId),scope};
}

async function storeMembers(env,clientId,storeId,me=null){
  const {results=[]}=await env.DB.prepare(`
    SELECT u.id,u.name,u.email,u.role,u.status,
      CASE WHEN u.role='client' THEN 'owner' ELSE COALESCE((SELECT a.role FROM user_store_access a WHERE a.user_id=u.id AND a.client_id=? AND a.store_id=? LIMIT 1),'member') END store_role
    FROM users u
    WHERE u.client_id=? AND COALESCE(u.status,'active')!='inactive'
      AND (u.role='client' OR EXISTS(SELECT 1 FROM user_store_access a2 WHERE a2.user_id=u.id AND a2.client_id=? AND a2.store_id=?))
    ORDER BY CASE WHEN u.role='client' THEN 0 ELSE 1 END,COALESCE(u.name,u.email)
  `).bind(clientId,storeId,clientId,clientId,storeId).all();
  const members=results.map(r=>({id:String(r.id),name:clean(r.name||r.email,200),email:clean(r.email,250),role:r.role,storeRole:r.store_role||'member'}));
  if(me){const id=actorId(me);if(id&&!members.some(x=>x.id===id))members.unshift({id,name:actorName(me),email:clean(me.email,250),role:me.role,storeRole:me.role==='admin'?'platform-admin':'member',synthetic:true});}
  return members;
}
async function memberById(env,clientId,storeId,userId,me=null){
  const id=clean(userId,200);if(!id)return null;
  const members=await storeMembers(env,clientId,storeId,me);return members.find(m=>m.id===id)||null;
}
async function orderInStore(env,clientId,storeId,orderId){
  const id=clean(orderId,180);if(!id)return null;
  const row=await env.DB.prepare('SELECT id,name,phone,state,total,store_id FROM orders WHERE id=? AND client_id=? AND store_id=?').bind(id,clientId,storeId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود داخل الفرع الحالي'),{status:404,code:'COLLAB_ORDER_NOT_FOUND'});
  return {id:String(row.id),name:clean(row.name,200),phone:clean(row.phone,80),state:clean(row.state,80),total:Number(row.total||0),storeId:row.store_id};
}
async function channelForUser(env,{clientId,storeId,channelId,userId}){
  const row=await env.DB.prepare(`SELECT c.*,m.role member_role FROM collab_channels c JOIN collab_channel_members m ON m.channel_id=c.id AND m.user_id=? WHERE c.id=? AND c.client_id=? AND c.store_id=? AND c.archived=0`).bind(userId,channelId,clientId,storeId).first();
  if(!row)throw Object.assign(new Error('المحادثة غير موجودة أو غير مسموحة لهذا المستخدم'),{status:403,code:'COLLAB_CHANNEL_DENIED'});
  return row;
}
async function channelMemberIds(env,clientId,storeId,channelId){
  const {results=[]}=await env.DB.prepare('SELECT user_id FROM collab_channel_members WHERE client_id=? AND store_id=? AND channel_id=?').bind(clientId,storeId,channelId).all();
  return results.map(r=>String(r.user_id));
}

async function listChannels(env,{clientId,storeId,me}){
  const uid=actorId(me);
  const {results=[]}=await env.DB.prepare(`
    SELECT c.id,c.name,c.type,c.created_by,c.created_at,c.updated_at,m.role member_role,
      (SELECT body FROM collab_messages x WHERE x.channel_id=c.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) last_message,
      (SELECT created_at FROM collab_messages x WHERE x.channel_id=c.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) last_message_at,
      (SELECT COUNT(*) FROM collab_message_mentions mm WHERE mm.channel_id=c.id AND mm.mentioned_user_id=? AND mm.read_at IS NULL) mention_count
    FROM collab_channels c JOIN collab_channel_members m ON m.channel_id=c.id AND m.user_id=?
    WHERE c.client_id=? AND c.store_id=? AND c.archived=0
    ORDER BY COALESCE(last_message_at,c.updated_at) DESC
  `).bind(uid,uid,clientId,storeId).all();
  const {results:allMembers=[]}=await env.DB.prepare(`SELECT cm.channel_id,cm.user_id,cm.role,u.name,u.email FROM collab_channel_members cm LEFT JOIN users u ON u.id=cm.user_id WHERE cm.client_id=? AND cm.store_id=?`).bind(clientId,storeId).all();
  const byChannel=new Map();for(const m of allMembers){if(!byChannel.has(m.channel_id))byChannel.set(m.channel_id,[]);byChannel.get(m.channel_id).push({id:String(m.user_id),name:clean(m.name||m.email||m.user_id,200),role:m.role||'member'});}
  return results.map(r=>({id:r.id,name:r.name||'',type:r.type,createdBy:r.created_by,createdAt:r.created_at,updatedAt:r.updated_at,lastMessage:r.last_message||'',lastMessageAt:r.last_message_at||null,mentionCount:Number(r.mention_count||0),members:byChannel.get(r.id)||[]}));
}

async function createChannel(env,{clientId,storeId,me,body}){
  const uid=actorId(me),type=body.type==='direct'?'direct':'group',members=await storeMembers(env,clientId,storeId,me);
  let requested=[...new Set((Array.isArray(body.memberIds)?body.memberIds:[]).map(x=>clean(x,200)).filter(Boolean))];
  if(type==='direct'){
    const target=clean(body.targetUserId||requested.find(x=>x!==uid),200);
    if(!target||target===uid)throw Object.assign(new Error('اختار عضو الفريق للمحادثة الخاصة'),{status:400,code:'COLLAB_DIRECT_TARGET_REQUIRED'});
    if(!members.some(m=>m.id===target))throw Object.assign(new Error('العضو غير موجود داخل الفرع الحالي'),{status:400,code:'COLLAB_MEMBER_INVALID'});
    const key=[uid,target].sort().join('::');
    const existing=await env.DB.prepare('SELECT id FROM collab_channels WHERE client_id=? AND store_id=? AND direct_key=? AND archived=0').bind(clientId,storeId,key).first();
    if(existing)return {ok:true,reused:true,channelId:existing.id};
    requested=[target];body={...body,directKey:key};
  }else{
    const name=clean(body.name,160);if(!name)throw Object.assign(new Error('اكتب اسم المجموعة'),{status:400,code:'COLLAB_GROUP_NAME_REQUIRED'});
    for(const id of requested)if(id!==uid&&!members.some(m=>m.id===id))throw Object.assign(new Error('أحد أعضاء المجموعة غير موجود داخل الفرع'),{status:400,code:'COLLAB_MEMBER_INVALID'});
  }
  const id=rid('CH'),ts=now(),name=type==='group'?clean(body.name,160):'',directKey=type==='direct'?body.directKey:null;
  const memberIds=[...new Set([uid,...requested])];
  const stmts=[env.DB.prepare('INSERT INTO collab_channels (id,client_id,store_id,name,type,direct_key,created_by,created_at,updated_at,archived) VALUES (?,?,?,?,?,?,?,?,?,0)').bind(id,clientId,storeId,name,type,directKey,uid,ts,ts)];
  for(const userId of memberIds)stmts.push(env.DB.prepare('INSERT INTO collab_channel_members (id,client_id,store_id,channel_id,user_id,role,joined_at) VALUES (?,?,?,?,?,?,?)').bind(rid('CM'),clientId,storeId,id,userId,userId===uid?'admin':'member',ts));
  await env.DB.batch(stmts);
  return {ok:true,channelId:id,reused:false};
}

async function listMessages(env,{clientId,storeId,me,channelId}){
  const uid=actorId(me);await channelForUser(env,{clientId,storeId,channelId,userId:uid});
  const {results=[]}=await env.DB.prepare(`SELECT id,channel_id,sender_user_id,sender_name,body,message_type,order_id,assigned_user_id,assigned_user_name,reply_to_message_id,created_at,edited_at FROM collab_messages WHERE client_id=? AND store_id=? AND channel_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 120`).bind(clientId,storeId,channelId).all();
  const ts=now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO collab_channel_reads (id,client_id,store_id,channel_id,user_id,last_read_at) VALUES (?,?,?,?,?,?) ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read_at=excluded.last_read_at`).bind(rid('CR'),clientId,storeId,channelId,uid,ts),
    env.DB.prepare('UPDATE collab_message_mentions SET read_at=COALESCE(read_at,?) WHERE client_id=? AND store_id=? AND channel_id=? AND mentioned_user_id=?').bind(ts,clientId,storeId,channelId,uid)
  ]);
  return {ok:true,messages:results.reverse().map(r=>({id:r.id,channelId:r.channel_id,senderUserId:r.sender_user_id,senderName:r.sender_name,body:r.body||'',type:r.message_type||'text',orderId:r.order_id||null,assignedUserId:r.assigned_user_id||null,assignedUserName:r.assigned_user_name||'',replyToMessageId:r.reply_to_message_id||null,createdAt:r.created_at,editedAt:r.edited_at||null,mine:String(r.sender_user_id)===uid}))};
}

async function sendMessage(env,{clientId,storeId,me,channelId,body}){
  const uid=actorId(me),name=actorName(me);await channelForUser(env,{clientId,storeId,channelId,userId:uid});
  const text=clean(body.body,4000),orderId=clean(body.orderId,180),assignId=clean(body.assignOrderToUserId,200),reply=clean(body.replyToMessageId,180)||null;
  if(!text&&!orderId&&!assignId)throw Object.assign(new Error('اكتب رسالة أو اربط أوردر'),{status:400,code:'COLLAB_EMPTY_MESSAGE'});
  const channelMembers=await channelMemberIds(env,clientId,storeId,channelId);
  let order=null,assignee=null;
  if(orderId)order=await orderInStore(env,clientId,storeId,orderId);
  if(assignId){
    if(!order)throw Object.assign(new Error('اربط أوردر قبل تعيينه لعضو الفريق'),{status:400,code:'COLLAB_ASSIGN_ORDER_REQUIRED'});
    if(!channelMembers.includes(assignId))throw Object.assign(new Error('التعيين من الشات متاح لأعضاء المحادثة فقط'),{status:400,code:'COLLAB_ASSIGN_MEMBER_REQUIRED'});
    assignee=await memberById(env,clientId,storeId,assignId,me);if(!assignee)throw Object.assign(new Error('عضو الفريق غير موجود'),{status:400,code:'COLLAB_MEMBER_INVALID'});
  }
  const requestedMentions=[...new Set((Array.isArray(body.mentionUserIds)?body.mentionUserIds:[]).map(x=>clean(x,200)).filter(Boolean))];
  if(assignee&&assignee.id!==uid)requestedMentions.push(assignee.id);
  const mentions=[...new Set(requestedMentions)].filter(id=>id!==uid&&channelMembers.includes(id));
  const id=rid('MSG'),ts=now(),type=assignee?'assignment':order?'order':'text';
  const stmts=[env.DB.prepare(`INSERT INTO collab_messages (id,client_id,store_id,channel_id,sender_user_id,sender_name,body,message_type,order_id,assigned_user_id,assigned_user_name,reply_to_message_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,storeId,channelId,uid,name,text,type,order?.id||null,assignee?.id||null,assignee?.name||null,reply,ts),env.DB.prepare('UPDATE collab_channels SET updated_at=? WHERE id=? AND client_id=? AND store_id=?').bind(ts,channelId,clientId,storeId)];
  for(const userId of mentions)stmts.push(env.DB.prepare('INSERT OR IGNORE INTO collab_message_mentions (id,client_id,store_id,message_id,channel_id,mentioned_user_id,created_at) VALUES (?,?,?,?,?,?,?)').bind(rid('MN'),clientId,storeId,id,channelId,userId,ts));
  if(assignee)stmts.push(env.DB.prepare(`INSERT INTO collab_order_assignments (client_id,store_id,order_id,assigned_to_user_id,assigned_to_name,assigned_by_user_id,assigned_by_name,channel_id,message_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,order_id) DO UPDATE SET store_id=excluded.store_id,assigned_to_user_id=excluded.assigned_to_user_id,assigned_to_name=excluded.assigned_to_name,assigned_by_user_id=excluded.assigned_by_user_id,assigned_by_name=excluded.assigned_by_name,channel_id=excluded.channel_id,message_id=excluded.message_id,updated_at=excluded.updated_at`).bind(clientId,storeId,order.id,assignee.id,assignee.name,uid,name,channelId,id,ts,ts));
  await env.DB.batch(stmts);
  try{if(assignee)await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,storeId,uid,me.email||me.role||null,'order.internal_assign','order',order.id,JSON.stringify({assignedTo:assignee.id,assignedToName:assignee.name,channelId}),ts).run();}catch{}
  return {ok:true,message:{id,channelId,senderUserId:uid,senderName:name,body:text,type,orderId:order?.id||null,order,assignedUserId:assignee?.id||null,assignedUserName:assignee?.name||'',createdAt:ts,mine:true}};
}

async function listMentions(env,{clientId,storeId,me}){
  const uid=actorId(me);
  const {results=[]}=await env.DB.prepare(`SELECT mm.id mention_id,mm.read_at,mm.created_at mention_created,m.id message_id,m.channel_id,m.sender_name,m.body,m.message_type,m.order_id,m.assigned_user_name,m.created_at,c.name channel_name,c.type channel_type FROM collab_message_mentions mm JOIN collab_messages m ON m.id=mm.message_id JOIN collab_channels c ON c.id=mm.channel_id JOIN collab_channel_members cm ON cm.channel_id=c.id AND cm.user_id=? WHERE mm.client_id=? AND mm.store_id=? AND mm.mentioned_user_id=? AND m.deleted_at IS NULL ORDER BY mm.created_at DESC LIMIT 100`).bind(uid,clientId,storeId,uid).all();
  return {ok:true,unread:results.filter(r=>!r.read_at).length,mentions:results.map(r=>({id:r.mention_id,readAt:r.read_at||null,createdAt:r.mention_created,message:{id:r.message_id,channelId:r.channel_id,channelName:r.channel_name||'',channelType:r.channel_type,senderName:r.sender_name,body:r.body||'',type:r.message_type,orderId:r.order_id||null,assignedUserName:r.assigned_user_name||'',createdAt:r.created_at}}))};
}
async function markMention(env,{clientId,storeId,me,mentionId}){
  const result=await env.DB.prepare('UPDATE collab_message_mentions SET read_at=COALESCE(read_at,?) WHERE id=? AND client_id=? AND store_id=? AND mentioned_user_id=?').bind(now(),mentionId,clientId,storeId,actorId(me)).run();
  if(Number(result?.meta?.changes||0)===0)throw Object.assign(new Error('المنشن غير موجود'),{status:404,code:'COLLAB_MENTION_NOT_FOUND'});return {ok:true};
}

async function listTasks(env,{clientId,storeId,me,url}){
  const mine=url.searchParams.get('mine')==='1',status=clean(url.searchParams.get('status'),40),binds=[clientId,storeId];let where='client_id=? AND store_id=?';
  if(mine){where+=' AND assigned_to=?';binds.push(actorId(me));}if(status&&TASK_STATUS.has(status)){where+=' AND status=?';binds.push(status);}
  const {results=[]}=await env.DB.prepare(`SELECT * FROM collab_tasks WHERE ${where} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,COALESCE(due_at,'9999-12-31'),updated_at DESC LIMIT 300`).bind(...binds).all();
  return {ok:true,tasks:results.map(taskOut)};
}
const taskOut=r=>({id:r.id,channelId:r.channel_id||null,title:r.title,description:r.description||'',status:r.status,priority:r.priority,createdBy:r.created_by,createdByName:r.created_by_name,assignedTo:r.assigned_to||null,assignedToName:r.assigned_to_name||'',orderId:r.order_id||null,dueAt:r.due_at||null,createdAt:r.created_at,updatedAt:r.updated_at,completedAt:r.completed_at||null});

async function createTask(env,{clientId,storeId,me,body}){
  const title=clean(body.title,240);if(!title)throw Object.assign(new Error('عنوان التاسك مطلوب'),{status:400,code:'COLLAB_TASK_TITLE_REQUIRED'});
  const assignedTo=clean(body.assignedTo,200),channelId=clean(body.channelId,180),orderId=clean(body.orderId,180),priority=TASK_PRIORITY.has(body.priority)?body.priority:'normal',dueAt=clean(body.dueAt,60)||null;
  let assignee=null;if(assignedTo){assignee=await memberById(env,clientId,storeId,assignedTo,me);if(!assignee)throw Object.assign(new Error('الشخص المعيّن غير موجود داخل الفرع'),{status:400,code:'COLLAB_MEMBER_INVALID'});}
  if(orderId)await orderInStore(env,clientId,storeId,orderId);
  if(channelId)await channelForUser(env,{clientId,storeId,channelId,userId:actorId(me)});
  const id=rid('TSK'),ts=now(),uid=actorId(me),name=actorName(me),description=clean(body.description,4000);
  const stmts=[env.DB.prepare(`INSERT INTO collab_tasks (id,client_id,store_id,channel_id,title,description,status,priority,created_by,created_by_name,assigned_to,assigned_to_name,order_id,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,storeId,channelId||null,title,description,'open',priority,uid,name,assignee?.id||null,assignee?.name||null,orderId||null,dueAt,ts,ts)];
  if(channelId){const mid=rid('MSG'),msg=`تاسك جديد: ${title}${assignee?` — إلى ${assignee.name}`:''}${orderId?` — أوردر #${orderId}`:''}`;stmts.push(env.DB.prepare(`INSERT INTO collab_messages (id,client_id,store_id,channel_id,sender_user_id,sender_name,body,message_type,order_id,assigned_user_id,assigned_user_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(mid,clientId,storeId,channelId,uid,name,msg,'system',orderId||null,assignee?.id||null,assignee?.name||null,ts));stmts.push(env.DB.prepare('UPDATE collab_channels SET updated_at=? WHERE id=?').bind(ts,channelId));if(assignee&&assignee.id!==uid)stmts.push(env.DB.prepare('INSERT OR IGNORE INTO collab_message_mentions (id,client_id,store_id,message_id,channel_id,mentioned_user_id,created_at) VALUES (?,?,?,?,?,?,?)').bind(rid('MN'),clientId,storeId,mid,channelId,assignee.id,ts));}
  await env.DB.batch(stmts);const row=await env.DB.prepare('SELECT * FROM collab_tasks WHERE id=?').bind(id).first();return {ok:true,task:taskOut(row)};
}

async function updateTask(env,{clientId,storeId,me,taskId,body}){
  const current=await env.DB.prepare('SELECT * FROM collab_tasks WHERE id=? AND client_id=? AND store_id=?').bind(taskId,clientId,storeId).first();if(!current)throw Object.assign(new Error('التاسك غير موجود'),{status:404,code:'COLLAB_TASK_NOT_FOUND'});
  let title=body.title!==undefined?clean(body.title,240):current.title,description=body.description!==undefined?clean(body.description,4000):current.description,status=body.status!==undefined&&TASK_STATUS.has(body.status)?body.status:current.status,priority=body.priority!==undefined&&TASK_PRIORITY.has(body.priority)?body.priority:current.priority,dueAt=body.dueAt!==undefined?(clean(body.dueAt,60)||null):current.due_at,assignedTo=body.assignedTo!==undefined?clean(body.assignedTo,200):current.assigned_to,assignedName=current.assigned_to_name,orderId=body.orderId!==undefined?clean(body.orderId,180):current.order_id;
  if(!title)throw Object.assign(new Error('عنوان التاسك مطلوب'),{status:400,code:'COLLAB_TASK_TITLE_REQUIRED'});
  if(assignedTo!==current.assigned_to){if(assignedTo){const m=await memberById(env,clientId,storeId,assignedTo,me);if(!m)throw Object.assign(new Error('الشخص المعيّن غير موجود داخل الفرع'),{status:400,code:'COLLAB_MEMBER_INVALID'});assignedName=m.name;}else assignedName=null;}
  if(orderId&&orderId!==current.order_id)await orderInStore(env,clientId,storeId,orderId);
  const ts=now(),completedAt=status==='done'?(current.completed_at||ts):(status==='cancelled'?current.completed_at:null);
  await env.DB.prepare(`UPDATE collab_tasks SET title=?,description=?,status=?,priority=?,assigned_to=?,assigned_to_name=?,order_id=?,due_at=?,updated_at=?,completed_at=? WHERE id=? AND client_id=? AND store_id=?`).bind(title,description,status,priority,assignedTo||null,assignedName||null,orderId||null,dueAt,ts,completedAt,taskId,clientId,storeId).run();
  const row=await env.DB.prepare('SELECT * FROM collab_tasks WHERE id=?').bind(taskId).first();return {ok:true,task:taskOut(row)};
}

async function assignment(env,{clientId,storeId,orderId}){await orderInStore(env,clientId,storeId,orderId);const row=await env.DB.prepare('SELECT * FROM collab_order_assignments WHERE client_id=? AND store_id=? AND order_id=?').bind(clientId,storeId,orderId).first();return {ok:true,assignment:row?{orderId:row.order_id,assignedToUserId:row.assigned_to_user_id,assignedToName:row.assigned_to_name,assignedByUserId:row.assigned_by_user_id,assignedByName:row.assigned_by_name,channelId:row.channel_id||null,messageId:row.message_id||null,updatedAt:row.updated_at}:null};}

async function context(env,{clientId,storeId,me}){
  const [members,channels,mentions,tasks]=await Promise.all([storeMembers(env,clientId,storeId,me),listChannels(env,{clientId,storeId,me}),listMentions(env,{clientId,storeId,me}),listTasks(env,{clientId,storeId,me,url:new URL(`https://local/api/collaboration/tasks?mine=1`)})]);
  return {ok:true,me:{id:actorId(me),name:actorName(me),role:me.role},clientId,storeId,members,channels,unreadMentions:mentions.unread,myTasks:tasks.tasks.filter(t=>t.status!=='done'&&t.status!=='cancelled').slice(0,20)};
}

export async function handleInternalCollaborationV117({request,env,ctx={},delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  if(!path.startsWith('/api/collaboration'))return null;
  try{
    const me=await currentUser(request,env,ctx,delegate),body=(method==='POST'||method==='PATCH'||method==='PUT')?await request.clone().json().catch(()=>({})):{};
    const write=method!=='GET',sc=await scopeFor({request,env,me,url,body,write});
    if(path==='/api/collaboration/context'&&method==='GET')return json(await context(env,{...sc,me}));
    if(path==='/api/collaboration/channels'&&method==='GET')return json({ok:true,channels:await listChannels(env,{...sc,me})});
    if(path==='/api/collaboration/channels'&&method==='POST')return json(await createChannel(env,{...sc,me,body}),201);
    const messages=path.match(/^\/api\/collaboration\/channels\/([^/]+)\/messages$/);
    if(messages&&method==='GET')return json(await listMessages(env,{...sc,me,channelId:decodeURIComponent(messages[1])}));
    if(messages&&method==='POST')return json(await sendMessage(env,{...sc,me,channelId:decodeURIComponent(messages[1]),body}),201);
    if(path==='/api/collaboration/mentions'&&method==='GET')return json(await listMentions(env,{...sc,me}));
    const mention=path.match(/^\/api\/collaboration\/mentions\/([^/]+)\/read$/);if(mention&&method==='POST')return json(await markMention(env,{...sc,me,mentionId:decodeURIComponent(mention[1])}));
    if(path==='/api/collaboration/tasks'&&method==='GET')return json(await listTasks(env,{...sc,me,url}));
    if(path==='/api/collaboration/tasks'&&method==='POST')return json(await createTask(env,{...sc,me,body}),201);
    const task=path.match(/^\/api\/collaboration\/tasks\/([^/]+)$/);if(task&&method==='PATCH')return json(await updateTask(env,{...sc,me,taskId:decodeURIComponent(task[1]),body}));
    const order=path.match(/^\/api\/collaboration\/orders\/([^/]+)\/assignment$/);if(order&&method==='GET')return json(await assignment(env,{...sc,orderId:decodeURIComponent(order[1])}));
    return json({ok:false,error:'مسار تواصل داخلي غير معروف',code:'COLLAB_ROUTE_NOT_FOUND'},404);
  }catch(error){return json({ok:false,error:error?.message||'تعذر تنفيذ طلب التواصل الداخلي',code:error?.code||'COLLAB_ERROR'},Number(error?.status)||500);}
}
