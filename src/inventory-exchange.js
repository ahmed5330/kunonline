import {assertUnitStore,operationGuard} from './inventory-unit-safety.js';
import {requirePermission} from './access-control.js';
const reject=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status});};
export async function openExchange({env,clientId,storeId,me,actor,body}){
  requirePermission(me,'inventory','exchange');requirePermission(me,'orders','update');const q=(sql,...args)=>env.DB.prepare(sql).bind(...args);
  const r=assertUnitStore(await q('SELECT * FROM inventory_return_cases WHERE id=? AND client_id=?',body.returnCaseId,clientId).first(),storeId);
  const prior=await q('SELECT * FROM inventory_exchange_cases WHERE return_case_id=? AND client_id=?',r.id,clientId).first();if(prior){if(prior.replacement_order_id!==String(body.replacementOrderId))reject('EXCHANGE_ALREADY_EXISTS','المرتجع مرتبط باستبدال آخر');return {ok:true,idempotent:true,exchange:prior};}
  const u=assertUnitStore(await q('SELECT * FROM inventory_units WHERE id=? AND client_id=?',r.unit_id,clientId).first(),storeId);
  const o=assertUnitStore(await q('SELECT * FROM orders WHERE (id=? OR ref=?) AND client_id=?',body.replacementOrderId,body.replacementOrderId,clientId).first(),storeId);
  if(r.order_id===o.id||!['confirmed','preparing','shipped'].includes(o.state))reject('EXCHANGE_REPLACEMENT_ORDER_INVALID','حدد طلب استبدال منفصلًا مؤكدًا ولم يُسلّم للمندوب');
  if(u.current_order_id===o.id)reject('EXCHANGE_REPLACEMENT_SAME_UNIT','القطعة الأصلية لا تصلح كقطعة الاستبدال');
  let productId=String(body.replacementProductId||u.product_id),variantId=Object.hasOwn(body,'replacementVariantId')?(body.replacementVariantId||null):(u.variant_id||null);
  if(!body.replacementProductId&&!Object.hasOwn(body,'replacementVariantId')){
    const {results:options=[]}=await q("SELECT v.product_id,v.variant_id FROM order_unit_allocations a JOIN inventory_units v ON v.id=a.unit_id AND v.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? AND v.current_order_id=? AND v.status IN ('reserved','packed') GROUP BY v.product_id,v.variant_id",clientId,o.id,o.id).all();
    if(options.length===1){productId=options[0].product_id;variantId=options[0].variant_id||null;}
    else if(options.length>1)reject('EXCHANGE_LINE_SELECTION_REQUIRED','طلب الاستبدال يحتوي أكثر من بند؛ حدد منتج وVariant الاستبدال');
  }
  const slots=await q("SELECT COUNT(*) n FROM order_unit_allocations a JOIN inventory_units v ON v.id=a.unit_id AND v.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? AND v.current_order_id=? AND v.product_id=? AND COALESCE(v.variant_id,'')=COALESCE(?,'') AND v.status IN ('reserved','packed')",clientId,o.id,o.id,productId,variantId).first();if(!slots?.n)reject('EXCHANGE_REPLACEMENT_SKU_INVALID','منتج أو Variant الاستبدال غير موجود في قطع الطلب المحجوزة');
  const reason=String(body.reason||'').trim().slice(0,600);if(!reason)reject('EXCHANGE_REASON_REQUIRED','سبب الاستبدال مطلوب',400);
  const id=crypto.randomUUID(),now=new Date().toISOString(),steps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND status IN ('returned_pending_inspection','quarantined','damaged','returned_in_stock','scrapped')) AND (SELECT COUNT(*) FROM inventory_exchange_cases WHERE client_id=? AND replacement_order_id=? AND replacement_product_id=? AND COALESCE(replacement_variant_id,'')=COALESCE(?,'') AND status<>'cancelled')<?",[u.id,clientId,clientId,o.id,productId,variantId,slots.n]),q('INSERT INTO inventory_exchange_cases(id,client_id,store_id,return_case_id,original_unit_id,original_order_id,replacement_order_id,replacement_product_id,replacement_variant_id,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,clientId,u.store_id||null,r.id,u.id,r.order_id,o.id,productId,variantId,reason,actor,now),q('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,note,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),u.id,u.unit_code,clientId,u.store_id||null,r.order_id,'exchange_opened',u.status,u.status,reason,'exchange',actor,JSON.stringify({exchangeId:id,replacementOrderId:o.id}),now),env.DB.prepare('DELETE FROM inventory_operation_guards')];
  try{await env.DB.batch(steps);}catch(e){if(/CHECK constraint failed|UNIQUE constraint failed/.test(e.message))reject('EXCHANGE_CONCURRENT_CHANGE','الاستبدال تغير أو سجل بالفعل');throw e;}
  return {ok:true,exchangeId:id,status:'awaiting_replacement'};
}
export async function exchangeHandoverStatements(env,clientId,units,actor){
  const q=(sql,...args)=>env.DB.prepare(sql).bind(...args),orders=[...new Set(units.map(u=>u.order_id))],steps=[],used=new Set();
  for(const orderId of orders){const {results:cases=[]}=await q("SELECT * FROM inventory_exchange_cases WHERE client_id=? AND replacement_order_id=? AND status='awaiting_replacement' ORDER BY created_at,id",clientId,orderId).all();
    for(const c of cases){const u=units.find(u=>u.order_id===orderId&&u.product_id===c.replacement_product_id&&String(u.variant_id||'')===String(c.replacement_variant_id||'')&&u.id!==c.original_unit_id&&!used.has(u.id));if(!u)continue;used.add(u.id);const now=new Date().toISOString();steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_exchange_cases WHERE id=? AND client_id=? AND status='awaiting_replacement')",[c.id,clientId]),q("UPDATE inventory_exchange_cases SET status='completed',replacement_unit_id=?,completed_at=? WHERE id=? AND client_id=?",u.id,now,c.id,clientId),q('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),u.id,u.unit_code,clientId,u.store_id||null,orderId,'exchange_replacement_handed_over','packed','shipped','exchange',actor,JSON.stringify({exchangeId:c.id,originalOrderId:c.original_order_id,originalUnitId:c.original_unit_id,awb:u.awb}),now));}
  }
  return steps;
}
