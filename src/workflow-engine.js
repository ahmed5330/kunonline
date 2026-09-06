// kun online — Workflow Engine foundation
const SAFE=new Set(['add_tag','assign_agent','add_note','notify_team']);
const EXTERNAL=new Set(['send_whatsapp','send_email','webhook']);
const SENSITIVE=new Set(['refund','financial_write','delete_entity','stock_adjustment']);

export const classifyAction=t=>SAFE.has(t)?'safe':EXTERNAL.has(t)?'external':SENSITIVE.has(t)?'sensitive':'unknown';

export function validateWorkflowDefinition(def={}) {
  const conditions=Array.isArray(def.conditions)?def.conditions:[];
  const actions=Array.isArray(def.actions)?def.actions:[];
  const errors=[];
  if(!actions.length) errors.push('Workflow must contain at least one action.');
  conditions.forEach((c,i)=>{if(!c?.field||!c?.operator) errors.push(`Condition ${i+1} is incomplete.`)});
  actions.forEach((a,i)=>{if(!a?.type) errors.push(`Action ${i+1} is missing type.`); else if(classifyAction(a.type)==='unknown') errors.push(`Unsupported action: ${a.type}`)});
  return {ok:!errors.length,errors};
}

const at=(ctx,path)=>String(path||'').split('.').filter(Boolean).reduce((v,k)=>v==null?undefined:v[k],ctx);
const cmp=(a,op,b)=>({eq:a===b,neq:a!==b,gt:Number(a)>Number(b),gte:Number(a)>=Number(b),lt:Number(a)<Number(b),lte:Number(a)<=Number(b),contains:Array.isArray(a)?a.includes(b):String(a??'').includes(String(b??'')),in:Array.isArray(b)&&b.includes(a),exists:a!==undefined&&a!==null&&a!==''})[op]||false;

export function evaluateConditions(conditions=[],context={}) {
  const details=conditions.map(c=>({...c,actual:at(context,c.field),passed:cmp(at(context,c.field),c.operator,c.value)}));
  return {passed:details.every(x=>x.passed),details};
}

export function planWorkflowRun(workflow,context,actor={}) {
  const def=workflow?.definition||{};
  const v=validateWorkflowDefinition(def);
  if(!v.ok) return {ok:false,status:'invalid',errors:v.errors,steps:[]};
  const c=evaluateConditions(def.conditions,context);
  if(!c.passed) return {ok:true,status:'skipped',reason:'conditions_not_met',conditions:c.details,steps:[]};
  const perms=new Set(actor.permissions||actor.perms||[]);
  const steps=def.actions.map((a,index)=>{
    const risk=classifyAction(a.type);
    const required=a.permission||'sensitive_actions';
    const requiresConfirmation=risk==='sensitive';
    const allowed=!requiresConfirmation||perms.has(required)||perms.has('settings');
    return {index,type:a.type,risk,allowed,requiresConfirmation,reason:allowed?null:`missing_permission:${required}`,payload:a.payload||{}};
  });
  return {ok:true,status:steps.some(s=>!s.allowed)?'blocked':steps.some(s=>s.requiresConfirmation)?'awaiting_confirmation':'ready',conditions:c.details,steps};
}
