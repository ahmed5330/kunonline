const clean=value=>String(value??'').trim();
const now=()=>new Date().toISOString();
const actorName=actor=>clean(actor?.email||actor?.name||actor?.role||actor?.id||actor?.uid)||'system';
const fail=(message,status=400,code='INVENTORY_CLEAR_ERROR')=>{throw Object.assign(new Error(message),{status,code});};

async function loadProductInventory(env,{clientId,storeId=null,productId}={}){
  clientId=clean(clientId);productId=clean(productId);storeId=clean(storeId)||null;
  if(!clientId)fail('محتاج clientId',400,'CLIENT_ID_REQUIRED');
  if(!productId)fail('محتاج productId',400,'PRODUCT_ID_REQUIRED');
  const where=['id=?','client_id=?'],binds=[productId,clientId];
  if(storeId){where.push('store_id=?');binds.push(storeId);}
  const product=await env.DB.prepare(`SELECT id,client_id,store_id,name,stock FROM products WHERE ${where.join(' AND ')} LIMIT 1`).bind(...binds).first();
  if(!product)fail('المنتج غير موجود في المتجر الحالي',404,'PRODUCT_NOT_FOUND');
  const effectiveStore=clean(product.store_id)||storeId||null;
  const variantWhere=['product_id=?','client_id=?'],variantBinds=[productId,clientId];
  if(effectiveStore){variantWhere.push('store_id=?');variantBinds.push(effectiveStore);}
  const {results:variants=[]}=await env.DB.prepare(`SELECT id,name,stock FROM product_variants WHERE ${variantWhere.join(' AND ')}`).bind(...variantBinds).all();
  const currentStock=variants.length?variants.reduce((sum,row)=>sum+Math.max(0,Number(row.stock)||0),0):Math.max(0,Number(product.stock)||0);
  return {product,variants,currentStock,storeId:effectiveStore};
}

async function remainingNamedStock(env,{clientId,storeId=null,productId}={}){
  const where=['client_id=?','product_id=?','remaining_qty>0'],binds=[clientId,productId];
  if(storeId){where.push('store_id=?');binds.push(storeId);}
  const {results=[]}=await env.DB.prepare(`SELECT id,batch_id,variant_id,product_name,remaining_qty FROM inventory_batch_items WHERE ${where.join(' AND ')}`).bind(...binds).all();
  return results;
}

export async function clearProductInventory(env,{clientId,storeId=null,productId,actor,reason='تصفير كامل للمخزون'}={}){
  const loaded=await loadProductInventory(env,{clientId,storeId,productId});
  clientId=clean(clientId);productId=clean(productId);storeId=loaded.storeId;
  const items=await remainingNamedStock(env,{clientId,storeId,productId});
  const batchQty=items.reduce((sum,row)=>sum+Math.max(0,Number(row.remaining_qty)||0),0);
  const batchIds=[...new Set(items.map(row=>clean(row.batch_id)).filter(Boolean))];
  const removedQty=Math.max(batchQty,loaded.currentStock);
  const statements=[];
  const itemWhere=['client_id=?','product_id=?','remaining_qty>0'],itemBinds=[clientId,productId];
  if(storeId){itemWhere.push('store_id=?');itemBinds.push(storeId);}
  if(items.length)statements.push(env.DB.prepare(`UPDATE inventory_batch_items SET remaining_qty=0 WHERE ${itemWhere.join(' AND ')}`).bind(...itemBinds));
  const productWhere=['id=?','client_id=?'],productBinds=[productId,clientId];
  if(storeId){productWhere.push('store_id=?');productBinds.push(storeId);}
  statements.push(env.DB.prepare(`UPDATE products SET stock=0 WHERE ${productWhere.join(' AND ')}`).bind(...productBinds));
  const variantWhere=['product_id=?','client_id=?'],variantBinds=[productId,clientId];
  if(storeId){variantWhere.push('store_id=?');variantBinds.push(storeId);}
  statements.push(env.DB.prepare(`UPDATE product_variants SET stock=0 WHERE ${variantWhere.join(' AND ')}`).bind(...variantBinds));
  for(const batchId of batchIds)statements.push(env.DB.prepare(`UPDATE inventory_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM inventory_batch_items WHERE batch_id=? AND remaining_qty>0) THEN 'active' ELSE 'depleted' END WHERE id=? AND client_id=?`).bind(batchId,batchId,clientId));
  if(removedQty>0){
    const ts=now(),note=`${clean(reason)||'تصفير كامل للمخزون'} — تم تصفير ${removedQty} قطعة${batchQty!==loaded.currentStock?` (رصيد الدفعات ${batchQty} / الرصيد الحالي ${loaded.currentStock})`:''}`;
    statements.push(env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,batch_id,batch_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(`STK-${crypto.randomUUID().slice(0,8).toUpperCase()}`,clientId,storeId,productId,null,loaded.product.name,-removedQty,0,note,null,null,ts.slice(0,10),null,'تصفير كامل',ts,actorName(actor)));
  }
  await env.DB.batch(statements);
  return {ok:true,productId,productName:loaded.product.name,clearedBatchQty:batchQty,clearedCurrentStock:loaded.currentStock,clearedQty:removedQty,affectedBatches:batchIds.length,variantCount:loaded.variants.length};
}

export async function clearStaleBatchStockIfProductZero(env,{clientId,storeId=null,productId,actor}={}){
  const loaded=await loadProductInventory(env,{clientId,storeId,productId});
  if(loaded.currentStock>0)return {ok:true,cleared:false,currentStock:loaded.currentStock};
  const items=await remainingNamedStock(env,{clientId:clean(clientId),storeId:loaded.storeId,productId:clean(productId)}),remaining=items.reduce((sum,row)=>sum+Math.max(0,Number(row.remaining_qty)||0),0);
  if(remaining<=0)return {ok:true,cleared:false,currentStock:0,remainingBatchQty:0};
  return {...await clearProductInventory(env,{clientId,storeId:loaded.storeId,productId,actor,reason:'تسوية تلقائية قبل حذف المنتج لأن المخزون الفعلي صفر'}),cleared:true};
}
