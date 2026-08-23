import commerceV5 from './index-commerce-v5.js';
import {requirePermission} from './access-control.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
const now=()=>new Date().toISOString();
const id=p=>`${p}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
async function meFromBase(request,env,ctx){const u=new URL(request.url);u.pathname='/api/me';u.search='';const r=await commerceV5.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);const me=await r.json().catch(()=>({}));if(!r.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:r.status||401});return me;}
function targetClient(me,requested){if(me.role==='client'){if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح'),{status:403});return me.clientId;}if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400});return requested;}
async function audit(env,me,clientId,action,entityType,entityId,metadata={}){await env.DB.prepare(`INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id('AUD'),clientId,me.uid||null,me.email||null,action,entityType,entityId,JSON.stringify(metadata),now()).run();}
async function notify(env,clientId,type,title,body,severity='info',entityType=null,entityId=null,userId=null){await env.DB.prepare(`INSERT INTO notifications (id,client_id,user_id,type,title,body,severity,entity_type,entity_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id('NTF'),clientId,userId,type,title,body||'',severity,entityType,entityId,now()).run();}

async function queueApproved(request,env,ctx,approvalId){
  const me=await meFromBase(request,env,ctx);requirePermission(me,'automation','approve');const b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null));
  const approval=await env.DB.prepare('SELECT * FROM approval_requests WHERE id=? AND client_id=?').bind(approvalId,clientId).first();if(!approval)return json({error:'طلب الموافقة غير موجود'},404);if(approval.status!=='approved')return json({error:'لا يمكن التنفيذ قبل الموافقة',status:approval.status},409);
  const key=`approval:${approvalId}`;const existing=await env.DB.prepare('SELECT id,status FROM execution_jobs WHERE client_id=? AND idempotency_key=?').bind(clientId,key).first();if(existing)return json({ok:true,jobId:existing.id,status:existing.status,deduplicated:true});
  const jobId=id('JOB'),ts=now();await env.DB.prepare(`INSERT INTO execution_jobs (id,client_id,source,source_id,action_type,payload_json,status,attempts,max_attempts,idempotency_key,available_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(jobId,clientId,approval.source||'approval',approvalId,approval.action_type,approval.payload_json||'{}','queued',0,3,key,ts,me.email||me.uid||'',ts,ts).run();
  await audit(env,me,clientId,'execution.queued','execution_job',jobId,{approvalId,actionType:approval.action_type});await notify(env,clientId,'execution','تمت إضافة إجراء للتنفيذ',`الإجراء ${approval.action_type} جاهز في طابور التنفيذ`,'info','execution_job',jobId);
  return json({ok:true,jobId,status:'queued'},201);
}
async function listJobs(env,clientId,status){let sql='SELECT * FROM execution_jobs WHERE client_id=?';const binds=[clientId];if(status){sql+=' AND status=?';binds.push(status)}sql+=' ORDER BY created_at DESC LIMIT 200';const {results}=await env.DB.prepare(sql).bind(...binds).all();return (results||[]).map(x=>({...x,payload:JSON.parse(x.payload_json||'{}')}));}
async function retryJob(request,env,ctx,jobId){const me=await meFromBase(request,env,ctx);requirePermission(me,'automation','approve');const b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null));const row=await env.DB.prepare('SELECT * FROM execution_jobs WHERE id=? AND client_id=?').bind(jobId,clientId).first();if(!row)return json({error:'المهمة غير موجودة'},404);if(!['failed','dead_letter'].includes(row.status))return json({error:'المهمة ليست في حالة تسمح بإعادة المحاولة',status:row.status},409);await env.DB.prepare("UPDATE execution_jobs SET status='queued',last_error=NULL,available_at=?,updated_at=? WHERE id=? AND client_id=?").bind(now(),now(),jobId,clientId).run();await audit(env,me,clientId,'execution.retry','execution_job',jobId,{previousStatus:row.status});return json({ok:true,id:jobId,status:'queued'});}
async function listNotifications(env,clientId){const {results}=await env.DB.prepare('SELECT * FROM notifications WHERE client_id=? ORDER BY created_at DESC LIMIT 200').bind(clientId).all();return results||[];}
async function markRead(request,env,ctx,nid){const me=await meFromBase(request,env,ctx);const b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null));await env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND client_id=?').bind(now(),nid,clientId).run();return json({ok:true});}
async function systemStatus(env,clientId){
  const jobs=await env.DB.prepare(`SELECT SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN status='dead_letter' THEN 1 ELSE 0 END) dead_letter FROM execution_jobs WHERE client_id=?`).bind(clientId).first();
  const approvals=await env.DB.prepare("SELECT COUNT(*) n FROM approval_requests WHERE client_id=? AND status='pending'").bind(clientId).first();
  const unread=await env.DB.prepare('SELECT COUNT(*) n FROM notifications WHERE client_id=? AND read_at IS NULL').bind(clientId).first();
  const {results}=await env.DB.prepare('SELECT provider,status,last_success_at,last_failure_at,last_error,latency_ms,updated_at FROM integration_health WHERE client_id=? ORDER BY provider').bind(clientId).all();
  return {ok:true,environment:'preview',database:'reachable',queue:{queued:Number(jobs?.queued||0),failed:Number(jobs?.failed||0),deadLetter:Number(jobs?.dead_letter||0)},pendingApprovals:Number(approvals?.n||0),unreadNotifications:Number(unread?.n||0),integrations:results||[],checkedAt:now()};
}

async function fetchV6(request,env,ctx){const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();try{
  let m=path.match(/^\/api\/approvals\/([^/]+)\/queue$/);if(m&&method==='POST')return queueApproved(request,env,ctx,decodeURIComponent(m[1]));
  if(path==='/api/execution-jobs'&&method==='GET'){const me=await meFromBase(request,env,ctx);requirePermission(me,'automation','read');const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await listJobs(env,clientId,url.searchParams.get('status')));}
  m=path.match(/^\/api\/execution-jobs\/([^/]+)\/retry$/);if(m&&method==='POST')return retryJob(request,env,ctx,decodeURIComponent(m[1]));
  if(path==='/api/notifications'&&method==='GET'){const me=await meFromBase(request,env,ctx);const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await listNotifications(env,clientId));}
  m=path.match(/^\/api\/notifications\/([^/]+)\/read$/);if(m&&method==='POST')return markRead(request,env,ctx,decodeURIComponent(m[1]));
  if(path==='/api/system-status'&&method==='GET'){const me=await meFromBase(request,env,ctx);requirePermission(me,'audit','read');const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await systemStatus(env,clientId));}
  return commerceV5.fetch(request,env,ctx);
}catch(e){return json({error:e.message||'حدث خطأ',code:e.code||null},e.status||500);}}
export default {fetch:fetchV6,scheduled(controller,env,ctx){return commerceV5.scheduled?.(controller,env,ctx);}};
