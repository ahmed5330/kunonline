import {assertUnitStore,operationGuard} from './inventory-unit-safety.js';
import {requirePermission} from './access-control.js';
const time=()=>new Date().toISOString(),uid=()=>crypto.randomUUID();
const reject=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status});};
const sellable=new Set(['in_stock','returned_in_stock']);
export async function approveStocktake({env,clientId,storeId,me,actor,body}){
  requirePermission(me,'inventory.stocktake','approve');
  const q=(sql,...args)=>env.DB.prepare(sql).bind(...args);
  const s=assertUnitStore(await q('SELECT * FROM inventory_operation_sessions WHERE id=? AND client_id=?',body.sessionId,clientId).first(),storeId);
  if(s.kind!=='stocktake')reject('STOCKTAKE_REQUIRED','هذه العملية ليست جردًا');
  const prior=await q('SELECT * FROM inventory_count_approvals WHERE session_id=? AND client_id=?',s.id,clientId).first();
  if(prior)return {ok:true,idempotent:true,approval:prior};
  if(s.status!=='pending_approval')reject('STOCKTAKE_NOT_PENDING','الجرد ليس في انتظار الاعتماد');
  if(s.actor===actor)reject('STOCKTAKE_SEPARATE_APPROVER_REQUIRED','اعتماد التسوية يحتاج مستخدمًا آخر',403);
  const reason=String(body.reason||'').trim();if(!reason)reject('STOCKTAKE_REASON_REQUIRED','سبب اعتماد التسوية مطلوب',400);
  const adjust=body.adjustMissing===true,locations=body.correctLocations===true;
  const {results:rows=[]}=await q(`SELECT x.*,u.unit_code,u.client_id,u.store_id,u.product_id,u.variant_id,u.product_name,u.batch_item_id,u.batch_id,u.status,u.current_order_id,u.updated_at,b.status baseline_status,b.updated_at baseline_updated_at,b.warehouse baseline_warehouse,b.location baseline_location,COALESCE(l.warehouse,'Main') warehouse,COALESCE(l.location,'') location FROM inventory_operation_units x JOIN inventory_units u ON u.id=x.unit_id AND u.client_id=? LEFT JOIN inventory_count_baselines b ON b.session_id=x.session_id AND b.unit_id=x.unit_id LEFT JOIN inventory_unit_locations l ON l.unit_id=u.id AND l.client_id=u.client_id WHERE x.session_id=?`,clientId,s.id).all();
  const now=time(),steps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_operation_sessions WHERE id=? AND client_id=? AND status='pending_approval')",[s.id,clientId])];let missingAdjusted=0,locationsCorrected=0;
  for(const u of rows){
    const missing=adjust&&u.expected&&!u.scanned,move=locations&&u.scanned&&u.wrong_location;
    if(!missing&&!move)continue;
    if(!u.baseline_updated_at||u.current_order_id)reject('STOCKTAKE_UNIT_BUSY','قطعة تغيرت أو مرتبطة بطلب؛ راجعها قبل التسوية');
    if(u.status!==u.baseline_status||u.updated_at!==u.baseline_updated_at||u.warehouse!==u.baseline_warehouse||u.location!==u.baseline_location)reject('STOCKTAKE_STALE','حركة حدثت بعد لقطة الجرد؛ أعد جرد القطعة');
    steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units u LEFT JOIN inventory_unit_locations l ON l.unit_id=u.id AND l.client_id=u.client_id WHERE u.id=? AND u.client_id=? AND u.current_order_id IS NULL AND u.status=? AND u.updated_at=? AND COALESCE(l.warehouse,'Main')=? AND COALESCE(l.location,'')=?)",[u.unit_id,clientId,u.status,u.updated_at,u.warehouse,u.location]));
    const target=missing?'missing':u.status;
    if(missing){
      if(sellable.has(u.status)){
        const table=u.variant_id?'product_variants':'products',entity=u.variant_id||u.product_id;
        steps.push(operationGuard(env,`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND client_id=? AND stock>=1)`,[entity,clientId]),q(`UPDATE ${table} SET stock=stock-1 WHERE id=? AND client_id=?`,entity,clientId));
        if(u.batch_item_id)steps.push(operationGuard(env,'EXISTS(SELECT 1 FROM inventory_batch_items WHERE id=? AND client_id=? AND remaining_qty>=1)',[u.batch_item_id,clientId]),q('UPDATE inventory_batch_items SET remaining_qty=remaining_qty-1 WHERE id=? AND client_id=?',u.batch_item_id,clientId));
        steps.push(q(`INSERT INTO stock_log(id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,stock_date,batch_id,created_at,created_by) SELECT ?,?,?,?,?,?,-1,stock,?,?,?,?,? FROM ${table} WHERE id=? AND client_id=?`,uid(),clientId,u.store_id||null,u.product_id,u.variant_id||null,u.product_name||'',`تسوية جرد معتمدة ${s.id} — ${reason}`,now.slice(0,10),u.batch_id||null,now,actor,entity,clientId));
      }
      steps.push(q("UPDATE inventory_units SET status='missing',updated_at=? WHERE id=? AND client_id=?",now,u.unit_id,clientId));missingAdjusted++;
    }else{
      steps.push(q('INSERT INTO inventory_unit_locations(unit_id,client_id,store_id,warehouse,location) VALUES(?,?,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET warehouse=excluded.warehouse,location=excluded.location',u.unit_id,clientId,u.store_id||null,s.source_warehouse,s.source_location||''),q('UPDATE inventory_units SET updated_at=? WHERE id=? AND client_id=?',now,u.unit_id,clientId));locationsCorrected++;
    }
    steps.push(q('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,event_type,from_status,to_status,note,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.unit_id,u.unit_code,clientId,u.store_id||null,missing?'stocktake_missing_approved':'stocktake_location_corrected',u.status,target,reason,'stocktake_approval',actor,JSON.stringify({sessionId:s.id,warehouse:s.source_warehouse,location:s.source_location,baselineStatus:u.baseline_status}),now));
  }
  steps.push(q('INSERT INTO inventory_count_approvals(session_id,client_id,actor,reason,adjust_missing,correct_locations,created_at) VALUES(?,?,?,?,?,?,?)',s.id,clientId,actor,reason,adjust?1:0,locations?1:0,now),q("UPDATE inventory_operation_sessions SET status='approved',completed_at=? WHERE id=? AND client_id=?",now,s.id,clientId),env.DB.prepare('DELETE FROM inventory_operation_guards'));
  try{await env.DB.batch(steps);}catch(e){if(/CHECK constraint failed|UNIQUE constraint failed/.test(e.message))reject('STOCKTAKE_CONCURRENT_CHANGE','الجرد تغير أثناء الاعتماد؛ حدّث التقرير');throw e;}
  return {ok:true,status:'approved',missingAdjusted,locationsCorrected};
}
