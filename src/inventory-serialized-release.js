import {isSerializedProduct} from './inventory-tracking-mode.js';
import {operationGuard} from './inventory-unit-safety.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{status:409,code});};
export async function releaseSerializedAllocations(env,{clientId,orderId,allocations,legacy=false,actor='system'}){
 const modes=await Promise.all(allocations.map(a=>isSerializedProduct(env,clientId,a.product_id,a.variant_id||null)));if(!modes.some(Boolean))return null;
 const q=(sql,...b)=>env.DB.prepare(sql).bind(...b),steps=[],ts=new Date().toISOString(),who=String(actor?.email||actor?.uid||actor?.role||actor),batches=new Set();let total=0;
 if(await q("SELECT 1 n FROM inventory_shipments WHERE client_id=? AND order_id=? AND status IN ('waybill_pending','waybill_created','printed','packing','packed','cancel_pending') LIMIT 1",clientId,orderId).first())fail('CARRIER_CANCELLATION_REQUIRED','ألغِ بوليصة الشحنة لدى J&T قبل فك الحجز');
 for(let i=0;i<allocations.length;i++){
  const a=allocations[i],allocationKey=legacy?orderId:a.id,table=legacy?'order_stock_allocations':'order_item_stock_allocations',key=legacy?'order_id':'id';let amount=Number(a.qty)||0;
  steps.push(operationGuard(env,`EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND client_id=? AND status='allocated' AND qty=?)`,[allocationKey,clientId,a.qty]));
  if(modes[i]){
   const {results:units=[]}=await q('SELECT u.*,x.id unit_allocation_id,x.status allocation_status FROM order_unit_allocations x JOIN inventory_units u ON u.id=x.unit_id AND u.client_id=x.client_id WHERE x.client_id=? AND x.order_id=? AND x.stock_allocation_id=?',clientId,orderId,allocationKey).all();
   if(units.length!==amount)fail('SERIALIZED_RELEASE_COVERAGE','تتبّع قطع الحجز غير مكتمل؛ راجع الطلب قبل فك الحجز');
   if(units.some(u=>['shipped','delivered'].includes(u.allocation_status)))fail('SHIPPED_UNIT_CANCEL_BLOCKED','توجد قطع خرجت للمندوب؛ سجّل استلام المرتجع أولًا');
   const releasable=units.filter(u=>['reserved','packed'].includes(u.allocation_status));amount=releasable.length;
   for(const u of releasable){
    steps.push(operationGuard(env,'EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id=? AND status=? AND updated_at=?) AND EXISTS(SELECT 1 FROM order_unit_allocations WHERE id=? AND status=?)',[u.id,clientId,orderId,u.status,u.updated_at,u.unit_allocation_id,u.allocation_status]));
    steps.push(q("UPDATE inventory_units SET status='in_stock',current_order_id=NULL,last_order_id=?,updated_at=? WHERE id=? AND client_id=?",orderId,ts,u.id,clientId),q("UPDATE order_unit_allocations SET status='released',released_at=?,updated_at=? WHERE id=? AND client_id=?",ts,ts,u.unit_allocation_id,clientId));
    steps.push(q('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),u.id,u.unit_code,clientId,u.store_id||null,orderId,'reservation_released',u.status,'in_stock','fifo_release',who,JSON.stringify({stockAllocationId:allocationKey}),ts));
   }
  }
  if(amount){
   const entity=a.variant_id||a.product_id,productTable=a.variant_id?'product_variants':'products';
   steps.push(operationGuard(env,'EXISTS(SELECT 1 FROM inventory_batch_items WHERE id=? AND client_id=? AND remaining_qty+?<=initial_qty)',[a.batch_item_id,clientId,amount]));
   steps.push(q('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=? AND client_id=?',amount,a.batch_item_id,clientId),q(`UPDATE ${productTable} SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?`,amount,entity,clientId));
   steps.push(q(`INSERT INTO stock_log(id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,stock_date,batch_id,created_at,created_by) SELECT ?,?,?,?,?,?,?,stock,?,?,?,?,? FROM ${productTable} WHERE id=? AND client_id=?`,crypto.randomUUID(),clientId,a.store_id||null,a.product_id,a.variant_id||null,a.product_name||'',amount,'فك حجز قطع لم تخرج '+orderId,ts.slice(0,10),a.batch_id,ts,who,entity,clientId));
  }
  steps.push(q(`UPDATE ${table} SET status='released',updated_at=? WHERE ${key}=? AND client_id=?`,ts,allocationKey,clientId));batches.add(a.batch_id);total+=amount;
 }
 steps.push(q("UPDATE inventory_shipment_units SET cancelled_at=? WHERE client_id=? AND shipment_id IN (SELECT id FROM inventory_shipments WHERE client_id=? AND order_id=? AND status='planned')",ts,clientId,clientId,orderId),q("UPDATE inventory_shipments SET status='cancelled',updated_at=? WHERE client_id=? AND order_id=? AND status='planned'",ts,clientId,orderId));
 steps.push(q("UPDATE order_stock_allocations SET status='released',updated_at=? WHERE client_id=? AND order_id=?",ts,clientId,orderId));
 for(const batchId of batches)steps.push(q("UPDATE inventory_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM inventory_batch_items WHERE batch_id=? AND remaining_qty>0) THEN 'active' ELSE 'depleted' END WHERE id=? AND client_id=?",batchId,batchId,clientId));
 steps.push(env.DB.prepare('DELETE FROM inventory_operation_guards'));
 try{await env.DB.batch(steps);}catch(e){if(/CHECK constraint failed/.test(e.message))fail('SERIALIZED_RELEASE_CONFLICT','الحجز تغير أثناء التنفيذ؛ حدّث الطلب');throw e;}
 return {kind:'released',fifo:!legacy,qty:total,batchIds:[...batches],unitAware:true};
}
