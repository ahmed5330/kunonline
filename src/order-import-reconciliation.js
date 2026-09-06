const OUTBOUND_STATES=new Set(['shipped','signed','collected']);
const clean=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const actorName=actor=>clean(actor?.email||actor?.name||actor?.role||actor?.id||actor?.uid)||'sheet-import';
const num=v=>Number(v)||0;
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;

async function refreshBatchStatus(env,batchId){
  const row=await env.DB.prepare('SELECT COALESCE(SUM(remaining_qty),0) remaining FROM inventory_batch_items WHERE batch_id=?').bind(batchId).first();
  await env.DB.prepare('UPDATE inventory_batches SET status=? WHERE id=?').bind(Number(row?.remaining||0)>0?'active':'depleted',batchId).run();
}
async function productStock(env,{clientId,productId,variantId}){
  if(variantId)return env.DB.prepare('SELECT stock FROM product_variants WHERE id=? AND client_id=?').bind(variantId,clientId).first();
  return env.DB.prepare('SELECT stock FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();
}
async function setProductStock(env,{clientId,productId,variantId,stock}){
  if(variantId)return env.DB.prepare('UPDATE product_variants SET stock=? WHERE id=? AND client_id=?').bind(stock,variantId,clientId).run();
  return env.DB.prepare('UPDATE products SET stock=? WHERE id=? AND client_id=?').bind(stock,productId,clientId).run();
}
async function logStock(env,{clientId,storeId,productId,variantId,productName,delta,newStock,stockDate,batchId,batchName,actor,note}){
  await env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,batch_id,batch_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(rid('STK'),clientId,storeId,productId,variantId||null,productName||'',delta,newStock,note||'',null,null,stockDate,batchId,batchName,now(),actorName(actor)).run();
}
async function changeGeneralStock(env,{clientId,productId,variantId,delta}){
  const row=await productStock(env,{clientId,productId,variantId}),current=num(row?.stock),next=Math.max(0,current+delta);
  await setProductStock(env,{clientId,productId,variantId,stock:next});return next;
}

export async function syncImportedOrderItems(env,{orderId,clientId,storeId,items=[]}={}){
  const ts=now(),keys=[];
  for(const raw of Array.isArray(items)?items:[]){
    const lineKey=clean(raw.lineKey),productName=clean(raw.productName||raw.product),qty=Math.max(0,num(raw.qty));if(!lineKey||!productName||qty<=0)continue;
    keys.push(lineKey);
    await env.DB.prepare(`INSERT INTO order_items (id,order_id,client_id,store_id,line_key,product_id,variant_id,sku,product_name,variant_label,qty,unit_price,line_total,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(order_id,line_key) DO UPDATE SET product_id=excluded.product_id,variant_id=excluded.variant_id,sku=excluded.sku,product_name=excluded.product_name,variant_label=excluded.variant_label,qty=excluded.qty,unit_price=excluded.unit_price,line_total=excluded.line_total,updated_at=excluded.updated_at`)
      .bind(rid('OIT'),orderId,clientId,storeId,lineKey,raw.productId||null,raw.variantId||null,clean(raw.sku)||null,productName,clean(raw.variantLabel)||null,qty,num(raw.unitPrice),num(raw.lineTotal),ts,ts).run();
  }
  if(keys.length){const marks=keys.map(()=>'?').join(',');await env.DB.prepare(`UPDATE order_items SET qty=0,updated_at=? WHERE order_id=? AND client_id=? AND line_key NOT IN (${marks})`).bind(ts,orderId,clientId,...keys).run();}
  else await env.DB.prepare('UPDATE order_items SET qty=0,updated_at=? WHERE order_id=? AND client_id=?').bind(ts,orderId,clientId).run();
  const {results=[]}=await env.DB.prepare('SELECT * FROM order_items WHERE order_id=? AND client_id=? ORDER BY created_at,id').bind(orderId,clientId).all();
  return results;
}

async function activeAllocations(env,{orderId,clientId}){
  const {results=[]}=await env.DB.prepare("SELECT a.*,i.product_name,b.name batch_name FROM order_item_stock_allocations a LEFT JOIN inventory_batch_items i ON i.id=a.batch_item_id LEFT JOIN inventory_batches b ON b.id=a.batch_id WHERE a.order_id=? AND a.client_id=? AND a.status='allocated' ORDER BY a.created_at DESC").bind(orderId,clientId).all();return results;
}
async function restoreAllocation(env,allocation,qty,{stockDate,actor,note}){
  qty=Math.min(num(qty),num(allocation.qty));if(qty<=0)return 0;
  await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(qty,allocation.batch_item_id).run();
  const remaining=num(allocation.qty)-qty;
  if(remaining>0)await env.DB.prepare('UPDATE order_item_stock_allocations SET qty=?,updated_at=? WHERE id=?').bind(remaining,now(),allocation.id).run();
  else await env.DB.prepare("UPDATE order_item_stock_allocations SET status='returned',updated_at=? WHERE id=?").bind(now(),allocation.id).run();
  const newStock=await changeGeneralStock(env,{clientId:allocation.client_id,productId:allocation.product_id,variantId:allocation.variant_id,delta:qty});
  await logStock(env,{clientId:allocation.client_id,storeId:allocation.store_id,productId:allocation.product_id,variantId:allocation.variant_id,productName:allocation.product_name,delta:qty,newStock,stockDate,batchId:allocation.batch_id,batchName:allocation.batch_name,actor,note});
  await env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=?").bind(allocation.batch_id).run();return qty;
}
async function restoreOrderAllocations(env,{orderId,clientId,stockDate,actor,note}){
  const rows=await activeAllocations(env,{orderId,clientId});let restored=0;for(const row of rows)restored+=await restoreAllocation(env,row,row.qty,{stockDate,actor,note});return restored;
}
async function allocateLine(env,{order,item,qty,actor,source}){
  qty=num(qty);if(qty<=0)return {allocated:0};
  if(!item.product_id)return {allocated:0,shortage:{orderId:order.id,item:item.product_name,reason:'المنتج غير مربوط بمنتج في كتالوج Kun'}};
  const variantClause=item.variant_id?' AND i.variant_id=?':' AND i.variant_id IS NULL',binds=[order.client_id,order.store_id,item.product_id];if(item.variant_id)binds.push(item.variant_id);binds.push(order.date);
  const {results=[]}=await env.DB.prepare(`SELECT i.*,b.name batch_name,b.stock_date,b.created_at batch_created_at FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.client_id=? AND i.store_id=? AND i.product_id=?${variantClause} AND i.remaining_qty>0 AND date(b.stock_date)<=date(?) ORDER BY b.stock_date ASC,b.created_at ASC,i.id ASC`).bind(...binds).all();
  const available=results.reduce((s,x)=>s+num(x.remaining_qty),0);if(available<qty)return {allocated:0,shortage:{orderId:order.id,item:item.product_name,needed:qty,available,reason:'المخزون المتاح في الاستوكات المؤرخة قبل الأوردر غير كافٍ'}};
  let left=qty,allocated=0;
  for(const batchItem of results){if(left<=0)break;const take=Math.min(left,num(batchItem.remaining_qty));if(take<=0)continue;
    const changed=await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty-? WHERE id=? AND remaining_qty>=?').bind(take,batchItem.id,take).run();if(Number(changed?.meta?.changes||0)!==1)throw Object.assign(new Error('المخزون اتغير أثناء استيراد الشيت، أعد المحاولة'),{status:409,code:'IMPORT_STOCK_CONCURRENT_CHANGE'});
    const newStock=await changeGeneralStock(env,{clientId:order.client_id,productId:item.product_id,variantId:item.variant_id,delta:-take});
    await env.DB.prepare(`INSERT INTO order_item_stock_allocations (id,order_id,order_item_id,client_id,store_id,batch_id,batch_item_id,product_id,variant_id,qty,status,stock_date,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,'allocated',?,?,?,?)`)
      .bind(rid('OIA'),order.id,item.id,order.client_id,order.store_id,batchItem.batch_id,batchItem.id,item.product_id,item.variant_id||null,take,order.date,now(),now(),actorName(actor)).run();
    await logStock(env,{clientId:order.client_id,storeId:order.store_id,productId:item.product_id,variantId:item.variant_id,productName:item.product_name,delta:-take,newStock,stockDate:order.date,batchId:batchItem.batch_id,batchName:batchItem.batch_name,actor,note:`خصم أوردر ${order.id} المستورد من ${source} — ${batchItem.batch_name}`});
    await refreshBatchStatus(env,batchItem.batch_id);allocated+=take;left-=take;
  }
  return {allocated};
}

export async function reconcileImportedOrderInventory(env,{orderId,clientId,source='sheet',actor=null}={}){
  const order=await env.DB.prepare('SELECT id,client_id,store_id,date,created_at,state FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!order)return {ok:false,skipped:'order_not_found',allocated:0,restored:0,shortages:[]};
  order.date=clean(order.date||order.created_at).slice(0,10)||now().slice(0,10);
  if(!OUTBOUND_STATES.has(order.state)){
    const restored=await restoreOrderAllocations(env,{orderId,clientId,stockDate:order.date,actor,note:`عكس خصم أوردر ${orderId} بعد استيراد حالة ${order.state}`});return {ok:true,allocated:0,restored,shortages:[]};
  }
  const {results:items=[]}=await env.DB.prepare('SELECT * FROM order_items WHERE order_id=? AND client_id=? AND qty>0 ORDER BY created_at,id').bind(orderId,clientId).all();
  const current=await activeAllocations(env,{orderId,clientId}),byItem=new Map();for(const a of current){if(!byItem.has(a.order_item_id))byItem.set(a.order_item_id,[]);byItem.get(a.order_item_id).push(a);}
  const desiredIds=new Set(items.map(x=>x.id)),out={ok:true,allocated:0,restored:0,shortages:[]};
  for(const a of current){if(desiredIds.has(a.order_item_id))continue;out.restored+=await restoreAllocation(env,a,a.qty,{stockDate:order.date,actor,note:`تصحيح منتج محذوف من أوردر ${orderId} المستورد`});}
  for(const item of items){const allocations=byItem.get(item.id)||[],currentQty=allocations.reduce((s,x)=>s+num(x.qty),0),desired=num(item.qty);
    if(currentQty>desired){let extra=currentQty-desired;for(const a of allocations){if(extra<=0)break;const take=Math.min(extra,num(a.qty));out.restored+=await restoreAllocation(env,a,take,{stockDate:order.date,actor,note:`تصحيح كمية أوردر ${orderId} المستورد`});extra-=take;}}
    if(currentQty<desired){const r=await allocateLine(env,{order,item,qty:desired-currentQty,actor,source});out.allocated+=num(r.allocated);if(r.shortage)out.shortages.push(r.shortage);}
  }
  return out;
}
