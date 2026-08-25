import commerceWorker from './index-commerce.js';
import { planWorkflowRun } from './workflow-engine.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
const now=()=>new Date().toISOString();
const id=p=>`${p}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;

async function meFromBase(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceWorker.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data?.role) throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});
  return data;
}

function targetClient(me,requested){
  if(me.role==='client'){
    if(requested&&String(requested)!==String(me.clientId)) throw Object.assign(new Error('مش مسموح'),{status:403});
    return me.clientId;
  }
  if(!requested) throw Object.assign(new Error('محتاج clientId'),{status:400});
  return requested;
}

async function workflowById(env,workflowId,clientId,storeId){
  const row=await env.DB.prepare('SELECT * FROM workflows WHERE id=? AND client_id=? AND (? IS NULL OR store_id=?)').bind(workflowId,clientId,storeId,storeId).first();
  if(!row)return null;
  return {...row,definition:JSON.parse(row.definition_json||'{}')};
}

async function listRuns(env,workflowId,clientId,storeId){
  const {results}=await env.DB.prepare('SELECT id,workflow_id,store_id,trigger_entity_type,trigger_entity_id,status,started_at,finished_at,log_json,error FROM workflow_runs WHERE workflow_id=? AND client_id=? AND (? IS NULL OR store_id=?) ORDER BY started_at DESC LIMIT 100').bind(workflowId,clientId,storeId,storeId).all();
  return (results||[]).map(x=>({...x,log:JSON.parse(x.log_json||'[]')}));
}

async function planRun(request,env,ctx,workflowId){
  const me=await meFromBase(request,env,ctx);
  const body=await request.json().catch(()=>({}));
  const clientId=targetClient(me,body.clientId||body.client_id||(me.role==='client'?me.clientId:null));
  const storeId=body.storeId||body.store_id||request.headers.get('X-Kun-Store-Id')||null;
  const workflow=await workflowById(env,workflowId,clientId,storeId);
  if(!workflow)return json({error:'Workflow غير موجود'},404);
  const plan=planWorkflowRun(workflow,body.context||{},me);
  return json({workflow:{id:workflow.id,name:workflow.name,triggerType:workflow.trigger_type},plan});
}

async function dryRun(request,env,ctx,workflowId){
  const me=await meFromBase(request,env,ctx);
  const body=await request.json().catch(()=>({}));
  const clientId=targetClient(me,body.clientId||body.client_id||(me.role==='client'?me.clientId:null));
  const storeId=body.storeId||body.store_id||request.headers.get('X-Kun-Store-Id')||null;
  const workflow=await workflowById(env,workflowId,clientId,storeId);
  if(!workflow)return json({error:'Workflow غير موجود'},404);
  const plan=planWorkflowRun(workflow,body.context||{},me);
  const runId=id('WFR'),ts=now();
  await env.DB.prepare('INSERT INTO workflow_runs (id,workflow_id,client_id,store_id,trigger_entity_type,trigger_entity_id,status,started_at,finished_at,log_json,error) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(runId,workflowId,clientId,storeId||workflow.store_id||null,body.entityType||null,body.entityId||null,`dry_run:${plan.status}`,ts,ts,JSON.stringify(plan.steps||[]),plan.ok?null:(plan.errors||[]).join('; ')).run();
  return json({ok:true,runId,mode:'dry-run',plan},201);
}

async function fetchV2(request,env,ctx){
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/healthz'&&request.method==='GET'){
      await env.DB.prepare('SELECT 1').first();
      return json({ok:true,service:'kunonline-preview',environment:env.APP_ENV||'unknown',database:'reachable'});
    }
    let m=path.match(/^\/api\/workflows\/([^/]+)\/plan$/);
    if(m&&request.method==='POST')return planRun(request,env,ctx,decodeURIComponent(m[1]));
    m=path.match(/^\/api\/workflows\/([^/]+)\/dry-run$/);
    if(m&&request.method==='POST')return dryRun(request,env,ctx,decodeURIComponent(m[1]));
    m=path.match(/^\/api\/workflows\/([^/]+)\/runs$/);
    if(m&&request.method==='GET'){
      const me=await meFromBase(request,env,ctx);
      const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));
      const storeId=url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||null;
      return json(await listRuns(env,decodeURIComponent(m[1]),clientId,storeId));
    }
    return commerceWorker.fetch(request,env,ctx);
  }catch(e){return json({error:e.message||'حدث خطأ'},e.status||500);}
}

export default {
  fetch:fetchV2,
  scheduled(controller,env,ctx){return commerceWorker.scheduled?.(controller,env,ctx);}
};
