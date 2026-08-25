import commerceV4 from './index-commerce-v4.js';
import {requirePermission} from './access-control.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
const now=()=>new Date().toISOString();
const id=p=>`${p}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;

async function meFromBase(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceV4.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const me=await r.json().catch(()=>({}));
  if(!r.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});
  return me;
}
function targetClient(me,requested){
  if(me.role==='client'){
    if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح'),{status:403});
    return me.clientId;
  }
  if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400});
  return requested;
}
async function audit(env,me,clientId,storeId,action,entityType,entityId,metadata={}){
  await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id('AUD'),clientId,storeId||null,me.uid||null,me.email||null,action,entityType,entityId,JSON.stringify(metadata),now()).run();
}
async function listApprovals(env,clientId,storeId,status){
  let sql='SELECT * FROM approval_requests WHERE client_id=?';const binds=[clientId];
  if(storeId){sql+=' AND store_id=?';binds.push(storeId)}
  if(status){sql+=' AND status=?';binds.push(status)}
  sql+=' ORDER BY requested_at DESC LIMIT 200';
  const {results}=await env.DB.prepare(sql).bind(...binds).all();
  return (results||[]).map(x=>({...x,payload:JSON.parse(x.payload_json||'{}')}));
}
async function createApproval(env,me,clientId,storeId,b){
  requirePermission(me,'automation','write');
  if(!b.actionType)return json({error:'actionType مطلوب'},400);
  const key=b.idempotencyKey||null;
  if(key){const existing=await env.DB.prepare('SELECT id,status FROM approval_requests WHERE client_id=? AND store_id IS ? AND idempotency_key=?').bind(clientId,storeId||null,key).first();if(existing)return json({ok:true,id:existing.id,status:existing.status,deduplicated:true});}
  const aid=id('APR'),ts=now();
  await env.DB.prepare(`INSERT INTO approval_requests (id,client_id,store_id,source,source_id,action_type,risk,payload_json,status,requested_by,requested_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(aid,clientId,storeId||null,b.source||'workflow',b.sourceId||null,b.actionType,b.risk||'sensitive',JSON.stringify(b.payload||{}),'pending',me.email||me.uid||'',ts,key).run();
  await audit(env,me,clientId,storeId,'approval.request','approval_request',aid,{actionType:b.actionType,source:b.source||'workflow'});
  return json({ok:true,id:aid,status:'pending'},201);
}
async function decideApproval(env,me,clientId,storeId,approvalId,decision,b){
  requirePermission(me,'automation','approve');
  const row=await env.DB.prepare(`SELECT * FROM approval_requests WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''}`).bind(...(storeId?[approvalId,clientId,storeId]:[approvalId,clientId])).first();
  if(!row)return json({error:'طلب الموافقة غير موجود'},404);
  if(row.status!=='pending')return json({error:'تم اتخاذ قرار في هذا الطلب مسبقًا',status:row.status},409);
  const status=decision==='approve'?'approved':'rejected',ts=now();
  await env.DB.prepare('UPDATE approval_requests SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=? AND client_id=?').bind(status,me.email||me.uid||'',ts,b.note||'',approvalId,clientId).run();
  await audit(env,me,clientId,row.store_id||storeId,`approval.${status}`,'approval_request',approvalId,{actionType:row.action_type,note:b.note||''});
  return json({ok:true,id:approvalId,status});
}
async function aiSuggest(env,me,clientId,storeId,b){
  requirePermission(me,'ai','write');
  if(!b.title||!b.actionType)return json({error:'title و actionType مطلوبان'},400);
  const risk=b.risk||'safe',ts=now(),aiId=id('AI');let approvalId=null,status='proposed';
  if(risk==='sensitive'){
    const response=await createApproval(env,me,clientId,storeId,{source:'ai',sourceId:aiId,actionType:b.actionType,risk,payload:b.payload||{},idempotencyKey:b.idempotencyKey||`ai:${aiId}`});
    const data=await response.clone().json();approvalId=data.id;status='awaiting_approval';
  }
  await env.DB.prepare(`INSERT INTO ai_action_requests (id,client_id,store_id,suggestion_type,title,rationale,action_type,payload_json,risk,status,approval_request_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(aiId,clientId,storeId||null,b.suggestionType||'operational',b.title,b.rationale||'',b.actionType,JSON.stringify(b.payload||{}),risk,status,approvalId,me.email||me.uid||'',ts,ts).run();
  await audit(env,me,clientId,storeId,'ai.action.proposed','ai_action',aiId,{risk,actionType:b.actionType,approvalId});
  return json({ok:true,id:aiId,status,approvalId},201);
}
async function listAi(env,clientId,storeId){const {results}=await env.DB.prepare(`SELECT * FROM ai_action_requests WHERE client_id=? ${storeId?'AND store_id=?':''} ORDER BY created_at DESC LIMIT 200`).bind(...(storeId?[clientId,storeId]:[clientId])).all();return (results||[]).map(x=>({...x,payload:JSON.parse(x.payload_json||'{}')}));}

async function fetchV5(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/approvals'&&method==='GET'){
      const me=await meFromBase(request,env,ctx);requirePermission(me,'automation','read');const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null)),storeId=url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||null;return json(await listApprovals(env,clientId,storeId,url.searchParams.get('status')));
    }
    if(path==='/api/approvals'&&method==='POST'){
      const me=await meFromBase(request,env,ctx),b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null)),storeId=b.storeId||b.store_id||request.headers.get('X-Kun-Store-Id')||null;return createApproval(env,me,clientId,storeId,b);
    }
    let m=path.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
    if(m&&method==='POST'){
      const me=await meFromBase(request,env,ctx),b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null)),storeId=b.storeId||b.store_id||request.headers.get('X-Kun-Store-Id')||null;return decideApproval(env,me,clientId,storeId,decodeURIComponent(m[1]),m[2],b);
    }
    if(path==='/api/ai-actions'&&method==='GET'){
      const me=await meFromBase(request,env,ctx);requirePermission(me,'ai','read');const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null)),storeId=url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||null;return json(await listAi(env,clientId,storeId));
    }
    if(path==='/api/ai-actions/propose'&&method==='POST'){
      const me=await meFromBase(request,env,ctx),b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null)),storeId=b.storeId||b.store_id||request.headers.get('X-Kun-Store-Id')||null;return aiSuggest(env,me,clientId,storeId,b);
    }
    return commerceV4.fetch(request,env,ctx);
  }catch(e){return json({error:e.message||'حدث خطأ',code:e.code||null},e.status||500);}
}
export default {fetch:fetchV5,scheduled(controller,env,ctx){return commerceV4.scheduled?.(controller,env,ctx);}};
