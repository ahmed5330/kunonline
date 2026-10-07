import {assertUnitStore,operationGuard,decodeUnitCode} from './inventory-unit-safety.js';
import {requirePermission} from './access-control.js';
const reject=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status});};
export async function receivePartialReturn({env,clientId,storeId,me,actor,body}){
  requirePermission(me,'inventory','return_receive');const q=(sql,...args)=>env.DB.prepare(sql).bind(...args);
  const u=assertUnitStore(await q('SELECT * FROM inventory_units WHERE client_id=? AND unit_code=?',clientId,decodeUnitCode(body.code)).first(),storeId);
  const orderId=u.current_order_id||u.last_order_id;
  const o=assertUnitStore(await q('SELECT id,client_id,store_id,ref,awb,state FROM orders WHERE id=? AND client_id=?',orderId||'',clientId).first(),storeId);
  if(body.orderId&&String(body.orderId)!==String(o.id))reject('RETURN_WRONG_ORDER','القطعة لا تخص الطلب المحدد');
  const prior=await q('SELECT * FROM inventory_return_cases WHERE client_id=? AND unit_id=? AND order_id=? ORDER BY created_at DESC LIMIT 1',clientId,u.id,o.id).first();
  if(prior&&!['shipped','delivered'].includes(u.status))return {ok:true,idempotent:true,returnCase:prior,originalOrder:o};
  if(!['shipped','delivered'].includes(u.status)||!u.shipped_at)reject('RETURN_NOT_SHIPPED','القطعة لم تخرج فعليًا أو ليس لها سجل تسليم');
  const reason=String(body.reason||'').trim().slice(0,600);if(!reason)reject('RETURN_REASON_REQUIRED','سبب المرتجع مطلوب',400);
  const a=await q("SELECT * FROM order_unit_allocations WHERE client_id=? AND order_id=? AND unit_id=? AND status IN ('shipped','delivered') ORDER BY updated_at DESC LIMIT 1",clientId,o.id,u.id).first();if(!a)reject('RETURN_ALLOCATION_REQUIRED','سجل خروج القطعة غير موجود');
  const now=new Date().toISOString(),caseId=crypto.randomUUID(),cycle=u.shipped_at;
  const steps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND status=? AND shipped_at=? AND updated_at=?) AND EXISTS(SELECT 1 FROM order_unit_allocations WHERE id=? AND client_id=? AND status IN ('shipped','delivered'))",[u.id,clientId,u.status,cycle,u.updated_at,a.id,clientId]),q('INSERT INTO inventory_return_cases(id,client_id,store_id,unit_id,order_id,awb,allocation_id,cycle_token,commercial_reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',caseId,clientId,u.store_id||null,u.id,o.id,o.awb||null,a.id,cycle,reason,actor,now),q("UPDATE inventory_units SET status='returned_pending_inspection',current_order_id=NULL,last_order_id=?,returned_at=?,updated_at=? WHERE id=? AND client_id=?",o.id,now,now,u.id,clientId),q("UPDATE order_unit_allocations SET status='return_pending',updated_at=? WHERE id=? AND client_id=?",now,a.id,clientId),q('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,note,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),u.id,u.unit_code,clientId,u.store_id||null,o.id,'partial_return_received',u.status,'returned_pending_inspection',reason,'return_receive',actor,JSON.stringify({returnCaseId:caseId,awb:o.awb||null,cycle}),now),env.DB.prepare('DELETE FROM inventory_operation_guards')];
  try{await env.DB.batch(steps);}catch(e){if(/CHECK constraint failed|UNIQUE constraint failed/.test(e.message))reject('RETURN_ALREADY_PROCESSED','القطعة استُلمت أو تغيرت بالفعل');throw e;}
  return {ok:true,returnCaseId:caseId,originalOrder:o,unitCode:u.unit_code,status:'returned_pending_inspection',stockChanged:false};
}
