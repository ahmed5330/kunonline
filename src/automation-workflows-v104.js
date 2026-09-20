import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope,requestedStoreId} from './store-scope.js';
import {validateWorkflowDefinition} from './workflow-engine.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const isWrite=method=>['POST','PUT','PATCH','DELETE'].includes(String(method||'').toUpperCase());

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}
function parseDefinition(value){try{const parsed=JSON.parse(value||'{}');return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}}
function publicRow(row){return row?{...row,definition:parseDefinition(row.definition_json)}:null;}
async function audit(env,me,clientId,storeId,action,workflowId,before=null,after=null,metadata=null){
  try{
    await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(rid('AUD'),clientId||null,storeId||null,me?.uid||null,me?.email||me?.role||'system',action,'workflow',workflowId,before?JSON.stringify(before):null,after?JSON.stringify(after):null,metadata?JSON.stringify(metadata):null,now()).run();
  }catch{}
}
function requestedClient(me,url,body={}){return body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId||null;}
async function contextFor(request,env,me,url,body={}){
  const clientId=resolveTenant(me,requestedClient(me,url,body));
  const scope=await resolveStoreScope(env,me,clientId,requestedStoreId(request,body),{write:isWrite(request.method)});
  return {clientId,scope};
}
async function rowById(env,clientId,scope,workflowId){
  const args=[workflowId,clientId],where=['id=?','client_id=?'];
  if(scope?.storeId){where.push('store_id=?');args.push(scope.storeId);}
  return env.DB.prepare(`SELECT id,client_id,store_id,name,trigger_type,definition_json,active,created_by,created_at,updated_at FROM workflows WHERE ${where.join(' AND ')} LIMIT 1`).bind(...args).first();
}
function validatedDefinition(body,existing=null){
  const previous=existing?parseDefinition(existing.definition_json):{conditions:[],actions:[]};
  const definition={
    conditions:Array.isArray(body.conditions)?body.conditions:(Array.isArray(body.definition?.conditions)?body.definition.conditions:(previous.conditions||[])),
    actions:Array.isArray(body.actions)?body.actions:(Array.isArray(body.definition?.actions)?body.definition.actions:(previous.actions||[]))
  };
  const validation=validateWorkflowDefinition(definition);
  if(!validation.ok)throw Object.assign(new Error(validation.errors.join(' | ')),{status:400,code:'WORKFLOW_INVALID',errors:validation.errors});
  return definition;
}
async function assertUniqueName(env,{clientId,storeId,name,excludeId=null}){
  const params=[clientId,storeId||null,name],suffix=excludeId?' AND id<>?':'';
  if(excludeId)params.push(excludeId);
  const duplicate=await env.DB.prepare(`SELECT id FROM workflows WHERE client_id=? AND store_id IS ? AND lower(name)=lower(?)${suffix} LIMIT 1`).bind(...params).first();
  if(duplicate)throw Object.assign(new Error('يوجد Workflow بنفس الاسم في هذا الفرع'),{status:409,code:'DUPLICATE_WORKFLOW',id:duplicate.id});
}
async function listWorkflows(request,env,me,url){
  requirePermission(me,'automation','read');
  const {clientId,scope}=await contextFor(request,env,me,url,{});
  const params=[clientId],storeClause=scope.storeId?' AND store_id=?':'';if(scope.storeId)params.push(scope.storeId);
  const {results=[]}=await env.DB.prepare(`SELECT id,store_id,name,trigger_type,definition_json,active,created_by,created_at,updated_at FROM workflows WHERE client_id=?${storeClause} ORDER BY active DESC,updated_at DESC,created_at DESC`).bind(...params).all();
  return json(results.map(publicRow));
}
async function getWorkflow(request,env,me,url,workflowId){
  requirePermission(me,'automation','read');
  const {clientId,scope}=await contextFor(request,env,me,url,{}),row=await rowById(env,clientId,scope,workflowId);
  return row?json(publicRow(row)):json({error:'الـWorkflow غير موجود',code:'WORKFLOW_NOT_FOUND'},404);
}
async function createWorkflow(request,env,me,url){
  requirePermission(me,'automation','write');
  const body=await request.clone().json().catch(()=>({})),{clientId,scope}=await contextFor(request,env,me,url,body),storeId=scope.storeId||null;
  const name=clean(body.name,120),triggerType=clean(body.triggerType||body.trigger_type,100);
  if(!name||!triggerType)return json({error:'الاسم والـTrigger مطلوبان',code:'WORKFLOW_FIELDS_REQUIRED'},400);
  const definition=validatedDefinition(body);await assertUniqueName(env,{clientId,storeId,name});
  const workflowId=rid('WF'),ts=now(),active=body.active?1:0;
  await env.DB.prepare(`INSERT INTO workflows (id,client_id,store_id,name,trigger_type,definition_json,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(workflowId,clientId,storeId,name,triggerType,JSON.stringify(definition),active,me.email||me.uid||'',ts,ts).run();
  const created=await rowById(env,clientId,scope,workflowId);await audit(env,me,clientId,storeId,'workflow.create',workflowId,null,publicRow(created),{triggerType});
  return json({ok:true,workflow:publicRow(created)},201);
}
async function updateWorkflow(request,env,me,url,workflowId){
  requirePermission(me,'automation','write');
  const body=await request.clone().json().catch(()=>({})),{clientId,scope}=await contextFor(request,env,me,url,body),existing=await rowById(env,clientId,scope,workflowId);
  if(!existing)return json({error:'الـWorkflow غير موجود',code:'WORKFLOW_NOT_FOUND'},404);
  const before=publicRow(existing),name=body.name===undefined?existing.name:clean(body.name,120),triggerType=body.triggerType===undefined&&body.trigger_type===undefined?existing.trigger_type:clean(body.triggerType||body.trigger_type,100),active=body.active===undefined?Number(existing.active||0):(body.active?1:0);
  if(!name||!triggerType)return json({error:'الاسم والـTrigger مطلوبان',code:'WORKFLOW_FIELDS_REQUIRED'},400);
  const definition=validatedDefinition(body,existing);await assertUniqueName(env,{clientId,storeId:existing.store_id||null,name,excludeId:workflowId});
  const ts=now();await env.DB.prepare('UPDATE workflows SET name=?,trigger_type=?,definition_json=?,active=?,updated_at=? WHERE id=? AND client_id=?').bind(name,triggerType,JSON.stringify(definition),active,ts,workflowId,clientId).run();
  const updated=await rowById(env,clientId,scope,workflowId);await audit(env,me,clientId,existing.store_id||null,'workflow.update',workflowId,before,publicRow(updated),{active});
  return json({ok:true,workflow:publicRow(updated)});
}
async function deleteWorkflow(request,env,me,url,workflowId){
  requirePermission(me,'automation','write');
  const body=await request.clone().json().catch(()=>({})),{clientId,scope}=await contextFor(request,env,me,url,body),existing=await rowById(env,clientId,scope,workflowId);
  if(!existing)return json({error:'الـWorkflow غير موجود',code:'WORKFLOW_NOT_FOUND'},404);
  const runCount=await env.DB.prepare('SELECT COUNT(*) count FROM workflow_runs WHERE workflow_id=? AND client_id=?').bind(workflowId,clientId).first();
  if(Number(runCount?.count||0)>0)return json({error:'لا يمكن حذف Workflow له سجل تشغيل. أوقفه بدل الحذف للحفاظ على السجل.',code:'WORKFLOW_HAS_RUNS',runs:Number(runCount.count)},409);
  const before=publicRow(existing);await env.DB.prepare('DELETE FROM workflows WHERE id=? AND client_id=?').bind(workflowId,clientId).run();
  await audit(env,me,clientId,existing.store_id||null,'workflow.delete',workflowId,before,null,{reason:'no_run_history'});
  return json({ok:true,deleted:true,id:workflowId});
}

export async function handleAutomationWorkflowsV104({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname;
  if(!(path==='/api/workflows'||path.startsWith('/api/workflows/')))return null;
  try{
    const me=await currentUser(request,env,ctx,delegate),method=request.method.toUpperCase();
    if(path==='/api/workflows'){
      if(method==='GET')return listWorkflows(request,env,me,url);
      if(method==='POST')return createWorkflow(request,env,me,url);
      return json({error:'المسار غير مدعوم'},405);
    }
    const match=path.match(/^\/api\/workflows\/([^/]+)$/);if(!match)return json({error:'المسار غير مدعوم'},405);
    const workflowId=decodeURIComponent(match[1]);
    if(method==='GET')return getWorkflow(request,env,me,url,workflowId);
    if(method==='PATCH'||method==='PUT')return updateWorkflow(request,env,me,url,workflowId);
    if(method==='DELETE')return deleteWorkflow(request,env,me,url,workflowId);
    return json({error:'المسار غير مدعوم'},405);
  }catch(error){return json({error:error?.message||'حدث خطأ في الأتمتة',code:error?.code||'AUTOMATION_ERROR',errors:error?.errors},error?.status||500);}
}
