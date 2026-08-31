const OUTBOUND_STATES=new Set(['shipped','signed','collected']);
const clean=v=>String(v??'').trim();
const num=v=>Number(v)||0;
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const fail=(message,status=400,code='INVENTORY_BATCH_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const actorName=actor=>clean(actor?.email||actor?.name||actor?.role||actor?.id||actor?.uid)||'system';
function validDate(value){const v=clean(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(`${v}T00:00:00Z`)))fail('تاريخ إضافة المخزون غير صحيح',400,'STOCK_BATCH_DATE_INVALID');return v;}
async function refreshBatchStatus(env,batchId){
  const row=await env.DB.prepare('SELECT COALESCE(SUM(remaining_qty),0) remaining FROM inventory_batch_items WHERE batch_id=?').bind(batchId).first();
  const status=Number(row?.remaining||0)>0?'active':'depleted';
  await env.DB.prepare('UPDATE inventory_batches SET status=? WHERE id=?').bind(status,batchId).run();
  return status;
}
export async function listInventoryBatches(env,{clientId,storeId=null,activeOnly=false}={}){
  if(!clientId)fail('محتاج clientId',400,'CLIENT_ID_REQUIRED');
  const where=['b.client_id=?'],binds=[clientId];if(storeId){where.push('b.store_id=?');binds.push(storeId);}
  let sql=`SELECT b.id,b.client_id,b.store_id,b.name,b.stock_date,b.note,b.status,b.created_at,b.created_by,
    COALESCE(SUM(i.initial_qty),0) total_initial,COALESCE(SUM(i.remaining_qty),0) total_remaining
    FROM inventory_batches b LEFT JOIN inventory_batch_items i ON i.batch_id=b.id
    WHERE ${where.join(' AND ')} GROUP BY b.id`;
  if(activeOnly)sql+=' HAVING COALESCE(SUM(i.remaining_qty),0)>0';
  sql+=' ORDER BY b.stock_date DESC,b.created_at DESC';
  const {results=[]}=await env.DB.prepare(sql).bind(...binds).all();
  if(!results.length)return {ok:true,batches:[]};
  const ids=results.map(x=>x.id),{results:items=[]}=await env.DB.prepare(`SELECT id,batch_id,product_id,variant_id,product_name,initial_qty,remaining_qty,created_at FROM inventory_batch_items WHERE batch_id IN (${ids.map(()=>'?').join(',')}) ORDER BY product_name`).bind(...ids).all(),byBatch=new Map();
  for(const item of items){if(!byBatch.has(item.batch_id))byBatch.set(item.batch_id,[]);byBatch.get(item.batch_id).push({id:item.id,productId:item.product_id,variantId:item.variant_id||null,productName:item.product_name,initialQty:Number(item.initial_qty||0),remainingQty:Number(item.remaining_qty||0)});}
  return {ok:true,batches:results.map(b=>({id:b.id,clientId:b.client_id,storeId:b.store_id||null,name:b.name,stockDate:b.stock_date,note:b.note||'',status:Number(b.total_remaining||0)>0?'active':'depleted',totalInitial:Number(b.total_initial||0),totalRemaining:Number(b.total_remaining||0),createdAt:b.created_at,createdBy:b.created_by||'',items:byBatch.get(b.id)||[]}))};
}
export async function createInventoryBatch(env,{clientId,storeId,name,stockDate,note='',items=[],actor}={}){
  clientId=clean(clientId);storeId=clean(storeId);name=clean(name);stockDate=validDate(stockDate);
  if(!clientId)fail('محتاج clientId',400,'CLIENT_ID_REQUIRED');if(!storeId)fail('اختار المتجر قبل إضافة استوك جديد',400,'STOCK_BATCH_STORE_REQUIRED');if(!name)fail('اكتب اسم/تسمية الاستوك',400,'STOCK_BATCH_NAME_REQUIRED');if(name.length>120)fail('اسم الاستوك طويل جدًا',400,'STOCK_BATCH_NAME_TOO_LONG');
  if(!Array.isArray(items)||!items.length)fail('أضف كمية لمنتج واحد على الأقل',400,'STOCK_BATCH_ITEMS_REQUIRED');if(items.length>500)fail('عدد المنتجات في الاستوك أكبر من المسموح',400,'STOCK_BATCH_TOO_MANY_ITEMS');
  const duplicate=await env.DB.prepare('SELECT id FROM inventory_batches WHERE client_id=? AND store_id=? AND lower(name)=lower(?)').bind(clientId,storeId,name).first();if(duplicate)fail('في استوك بنفس الاسم موجود بالفعل في هذا المتجر',409,'STOCK_BATCH_NAME_EXISTS');
  const merged=new Map();for(const raw of items){const productId=clean(raw?.productId||raw?.product_id),variantId=clean(raw?.variantId||raw?.variant_id)||null,qty=Number(raw?.qty);if(!productId||!Number.isFinite(qty)||qty<=0)continue;const key=`${productId}::${variantId||''}`;const old=merged.get(key);merged.set(key,{productId,variantId,qty:(old?.qty||0)+qty});}
  if(!merged.size)fail('اكتب كميات أكبر من صفر',400,'STOCK_BATCH_QUANTITY_REQUIRED');
  const verified=[];for(const item of merged.values()){
    if(item.variantId){const row=await env.DB.prepare(`SELECT v.id,v.product_id,v.name,v.stock,p.name product_name FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.id=? AND v.product_id=? AND v.client_id=? AND v.store_id=?`).bind(item.variantId,item.productId,clientId,storeId).first();if(!row)fail('أحد متغيرات المنتجات غير موجود في المتجر الحالي',404,'STOCK_BATCH_VARIANT_NOT_FOUND');verified.push({...item,productName:`${row.product_name} — ${row.name}`,oldStock:Number(row.stock||0)});
    }else{const row=await env.DB.prepare('SELECT id,name,stock FROM products WHERE id=? AND client_id=? AND store_id=?').bind(item.productId,clientId,storeId).first();if(!row)fail('أحد المنتجات غير موجود في المتجر الحالي',404,'STOCK_BATCH_PRODUCT_NOT_FOUND');verified.push({...item,productName:row.name,oldStock:Number(row.stock||0)});}
  }
  const id=`BAT-${crypto.randomUUID().slice(0,10).toUpperCase()}`,ts=now(),createdBy=actorName(actor),statements=[env.DB.prepare('INSERT INTO inventory_batches (id,client_id,store_id,name,stock_date,note,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,clientId,storeId,name,stockDate,clean(note),'active',ts,createdBy)];
  for(const item of verified){const itemId=`BTI-${crypto.randomUUID().slice(0,10).toUpperCase()}`,newStock=item.oldStock+item.qty;statements.push(env.DB.prepare('INSERT INTO inventory_batch_items (id,batch_id,client_id,store_id,product_id,variant_id,product_name,initial_qty,remaining_qty,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(itemId,id,clientId,storeId,item.productId,item.variantId,item.productName,item.qty,item.qty,ts));if(item.variantId)statements.push(env.DB.prepare('UPDATE product_variants SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?').bind(item.qty,item.variantId,clientId));else statements.push(env.DB.prepare('UPDATE products SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?').bind(item.qty,item.productId,clientId));statements.push(env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,batch_id,batch_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(`STK-${crypto.randomUUID().slice(0,8).toUpperCase()}`,clientId,storeId,item.productId,item.variantId,item.productName,item.qty,newStock,clean(note)||`إضافة مخزون — ${name}`,null,null,stockDate,id,name,ts,createdBy));}
  await env.DB.batch(statements);return {ok:true,id,name,stockDate,itemCount:verified.length,totalQty:verified.reduce((s,x)=>s+x.qty,0)};
}
export async function assertProductCanDelete(env,{clientId,storeId=null,productId}={}){
  const where=['client_id=?','product_id=?'],binds=[clientId,productId];if(storeId){where.push('store_id=?');binds.push(storeId);}const row=await env.DB.prepare(`SELECT COALESCE(SUM(remaining_qty),0) remaining FROM inventory_batch_items WHERE ${where.join(' AND ')}`).bind(...binds).first(),remaining=Number(row?.remaining||0);if(remaining>0)fail(`المنتج موجود داخل استوك مسمى ولسه فيه ${remaining} قطعة. استهلك أو صفّر الكمية قبل حذف المنتج.`,409,'PRODUCT_HAS_BATCH_STOCK');return true;
}

async function resolveOrderProduct(env,row){
  if(row.product_id)return {productId:row.product_id,variantId:row.variant_id||null};
  const name=clean(row.product);if(!name)fail('الأوردر غير مربوط بمنتج، اربطه بمنتج قبل الشحن',409,'ORDER_PRODUCT_NOT_LINKED');
  const matches=(await env.DB.prepare('SELECT id FROM products WHERE client_id=? AND store_id=? AND trim(name)=trim(?) LIMIT 2').bind(row.client_id,row.store_id,name).all()).results||[];if(matches.length!==1)fail('تعذر تحديد منتج الأوردر داخل المخزون بدقة. اربط الأوردر بمنتج أولًا.',409,'ORDER_PRODUCT_MATCH_AMBIGUOUS');
  await env.DB.prepare('UPDATE orders SET product_id=? WHERE id=? AND client_id=?').bind(matches[0].id,row.id,row.client_id).run();return {productId:matches[0].id,variantId:null};
}
async function resolveOrderItemProduct(env,order,item){
  if(item.product_id)return item;
  const sku=clean(item.sku);if(sku){
    const variants=(await env.DB.prepare(`SELECT v.id variant_id,v.product_id FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.client_id=? AND v.store_id=? AND trim(v.sku)=trim(?) LIMIT 2`).bind(order.client_id,order.store_id,sku).all()).results||[];
    if(variants.length===1){await env.DB.prepare('UPDATE order_items SET product_id=?,variant_id=? WHERE id=? AND client_id=?').bind(variants[0].product_id,variants[0].variant_id,item.id,order.client_id).run();return {...item,product_id:variants[0].product_id,variant_id:variants[0].variant_id};}
    const products=(await env.DB.prepare('SELECT id FROM products WHERE client_id=? AND store_id=? AND trim(sku)=trim(?) LIMIT 2').bind(order.client_id,order.store_id,sku).all()).results||[];
    if(products.length===1){await env.DB.prepare('UPDATE order_items SET product_id=? WHERE id=? AND client_id=?').bind(products[0].id,item.id,order.client_id).run();return {...item,product_id:products[0].id};}
  }
  const name=clean(item.product_name);if(name){const products=(await env.DB.prepare('SELECT id FROM products WHERE client_id=? AND store_id=? AND trim(name)=trim(?) LIMIT 2').bind(order.client_id,order.store_id,name).all()).results||[];if(products.length===1){await env.DB.prepare('UPDATE order_items SET product_id=? WHERE id=? AND client_id=?').bind(products[0].id,item.id,order.client_id).run();return {...item,product_id:products[0].id};}}
  fail(`المنتج «${name||sku||'غير معروف'}» غير مربوط بمنتج في المخزون. اربطه بالمنتج/المتغير الصحيح قبل الشحن.`,409,'ORDER_ITEM_PRODUCT_NOT_LINKED');
}
async function orderItemsForAllocation(env,order){
  let {results=[]}=await env.DB.prepare('SELECT * FROM order_items WHERE order_id=? AND client_id=? AND qty>0 ORDER BY created_at,id').bind(order.id,order.client_id).all().catch(()=>({results:[]}));
  if(results.length){const out=[];for(const raw of results)out.push(await resolveOrderItemProduct(env,order,raw));return out;}
  const {productId,variantId}=await resolveOrderProduct(env,order);return [{id:`LEGACY-${order.id}`,order_id:order.id,client_id:order.client_id,store_id:order.store_id,product_id:productId,variant_id:variantId,product_name:clean(order.product)||'منتج',qty:Math.max(1,num(order.qty)||1)}];
}
async function legacyAllocation(env,orderId,clientId){return env.DB.prepare('SELECT * FROM order_stock_allocations WHERE order_id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);}
async function activeItemAllocations(env,orderId,clientId){const {results=[]}=await env.DB.prepare("SELECT a.*,i.product_name,b.name batch_name FROM order_item_stock_allocations a LEFT JOIN inventory_batch_items i ON i.id=a.batch_item_id LEFT JOIN inventory_batches b ON b.id=a.batch_id WHERE a.order_id=? AND a.client_id=? AND a.status='allocated' ORDER BY a.created_at,a.id").bind(orderId,clientId).all().catch(()=>({results:[]}));return results;}
async function fifoCandidates(env,{clientId,storeId,productId,variantId}){
  const variantClause=variantId?' AND i.variant_id=?':' AND i.variant_id IS NULL',binds=[clientId,storeId,productId];if(variantId)binds.push(variantId);
  const {results=[]}=await env.DB.prepare(`SELECT i.*,b.name batch_name,b.stock_date,b.created_at batch_created_at FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.client_id=? AND i.store_id=? AND i.product_id=?${variantClause} AND i.remaining_qty>0 ORDER BY b.stock_date ASC,b.created_at ASC,i.created_at ASC,i.id ASC`).bind(...binds).all();return results;
}
async function productStock(env,{clientId,productId,variantId}){if(variantId)return env.DB.prepare('SELECT stock FROM product_variants WHERE id=? AND client_id=?').bind(variantId,clientId).first();return env.DB.prepare('SELECT stock FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();}
async function setProductStock(env,{clientId,productId,variantId,stock}){if(variantId)return env.DB.prepare('UPDATE product_variants SET stock=? WHERE id=? AND client_id=?').bind(stock,variantId,clientId).run();return env.DB.prepare('UPDATE products SET stock=? WHERE id=? AND client_id=?').bind(stock,productId,clientId).run();}
async function changeGeneralStock(env,{clientId,productId,variantId,delta}){const row=await productStock(env,{clientId,productId,variantId}),next=Math.max(0,num(row?.stock)+delta);await setProductStock(env,{clientId,productId,variantId,stock:next});return next;}
async function writeStockLog(env,{clientId,storeId,productId,variantId,productName,delta,newStock,batch,orderId,actor}){const id=rid('STK');await env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,batch_id,batch_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,clientId,storeId,productId,variantId||null,productName||'',delta,newStock,`خصم أوردر ${orderId} تلقائيًا بنظام FIFO — ${batch.batch_name}`,null,null,now().slice(0,10),batch.batch_id,batch.batch_name,now(),actorName(actor)).run();return id;}

async function rollbackFifoSlices(env,token){
  for(const slice of [...(token?.slices||[])].reverse()){
    await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(slice.qty,slice.batchItemId).run().catch(()=>{});
    if(slice.generalAdjusted){if(slice.variantId)await env.DB.prepare('UPDATE product_variants SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?').bind(slice.qty,slice.variantId,token.clientId).run().catch(()=>{});else await env.DB.prepare('UPDATE products SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?').bind(slice.qty,slice.productId,token.clientId).run().catch(()=>{});if(slice.logId)await env.DB.prepare('DELETE FROM stock_log WHERE id=?').bind(slice.logId).run().catch(()=>{});}
    if(slice.allocationId)await env.DB.prepare('DELETE FROM order_item_stock_allocations WHERE id=?').bind(slice.allocationId).run().catch(()=>{});
    await refreshBatchStatus(env,slice.batchId).catch(()=>{});
  }
}

export async function prepareOrderStockTransition(env,{clientId,storeId,orderId,fromState,toState,stockBatchId,actor}={}){
  void stockBatchId;
  if(OUTBOUND_STATES.has(fromState)||!OUTBOUND_STATES.has(toState))return {kind:'none'};
  const order=await env.DB.prepare('SELECT id,client_id,store_id,product,product_id,variant_id,qty,date,created_at FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!order)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');storeId=clean(storeId||order.store_id);if(!storeId)fail('الأوردر غير مربوط بمتجر',409,'ORDER_STORE_REQUIRED');order.store_id=storeId;
  const [legacy,active]=await Promise.all([legacyAllocation(env,orderId,clientId),activeItemAllocations(env,orderId,clientId)]);if(legacy?.status==='allocated'||active.length)return {kind:'none',allocation:legacy||active[0]};
  const items=await orderItemsForAllocation(env,order),groups=new Map();
  for(const item of items){const productId=clean(item.product_id),variantId=clean(item.variant_id)||null,qty=Math.max(1,num(item.qty)||1),key=`${productId}::${variantId||''}`;if(!productId)fail(`المنتج «${clean(item.product_name)||'غير معروف'}» غير مربوط بالمخزون`,409,'ORDER_ITEM_PRODUCT_NOT_LINKED');if(!groups.has(key))groups.set(key,{productId,variantId,qty:0,items:[]});const group=groups.get(key);group.qty+=qty;group.items.push({...item,qty});}
  for(const group of groups.values()){
    group.candidates=await fifoCandidates(env,{clientId,storeId,productId:group.productId,variantId:group.variantId});const available=group.candidates.reduce((sum,row)=>sum+num(row.remaining_qty),0);
    if(available<group.qty)fail(`المخزون غير كافٍ للمنتج «${clean(group.items[0]?.product_name)||group.productId}». المطلوب ${group.qty} والمتاح ${available}.`,409,'STOCK_FIFO_INSUFFICIENT');
  }
  const generalAdjusted=fromState!=='returned',token={kind:'allocated',fifo:true,orderId,clientId,storeId,qty:0,slices:[],batchIds:[],batchNames:[]};
  try{
    for(const group of groups.values()){
      const virtual=group.candidates.map(row=>({...row,virtualRemaining:num(row.remaining_qty)}));
      for(const item of group.items){let left=item.qty;
        for(const batch of virtual){if(left<=0)break;if(batch.virtualRemaining<=0)continue;const take=Math.min(left,batch.virtualRemaining),changed=await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty-? WHERE id=? AND remaining_qty>=?').bind(take,batch.id,take).run();if(Number(changed?.meta?.changes||0)!==1)fail('المخزون اتغير أثناء الخصم التلقائي. أعد المحاولة.',409,'STOCK_FIFO_CONCURRENT_CHANGE');
          let newStock=null,logId=null;if(generalAdjusted){newStock=await changeGeneralStock(env,{clientId,productId:group.productId,variantId:group.variantId,delta:-take});logId=await writeStockLog(env,{clientId,storeId,productId:group.productId,variantId:group.variantId,productName:batch.product_name||item.product_name,delta:-take,newStock,batch,orderId,actor});}
          const allocationId=rid('OIA'),ts=now();await env.DB.prepare(`INSERT INTO order_item_stock_allocations (id,order_id,order_item_id,client_id,store_id,batch_id,batch_item_id,product_id,variant_id,qty,status,stock_date,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,'allocated',?,?,?,?,?)`).bind(allocationId,orderId,item.id,clientId,storeId,batch.batch_id,batch.id,group.productId,group.variantId,take,batch.stock_date||now().slice(0,10),ts,ts,actorName(actor)).run();
          const slice={allocationId,batchId:batch.batch_id,batchItemId:batch.id,batchName:batch.batch_name,productId:group.productId,variantId:group.variantId,qty:take,generalAdjusted,logId};token.slices.push(slice);token.qty+=take;if(!token.batchIds.includes(batch.batch_id)){token.batchIds.push(batch.batch_id);token.batchNames.push(batch.batch_name);}batch.virtualRemaining-=take;left-=take;await refreshBatchStatus(env,batch.batch_id);
        }
        if(left>0)fail('تعذر إكمال الخصم التلقائي من دفعات المخزون',409,'STOCK_FIFO_ALLOCATION_INCOMPLETE');
      }
    }
    token.batchId=token.batchIds[0]||null;token.batchName=token.batchNames[0]||'FIFO';return token;
  }catch(error){await rollbackFifoSlices(env,token);throw error;}
}

export async function rollbackOrderStockTransition(env,token){
  if(!token||token.kind!=='allocated')return;if(token.fifo)return rollbackFifoSlices(env,token);
  await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(token.qty,token.batchItemId).run().catch(()=>{});if(token.generalAdjusted){if(token.variantId)await env.DB.prepare('UPDATE product_variants SET stock=COALESCE(stock,0)+? WHERE id=?').bind(token.qty,token.variantId).run().catch(()=>{});else await env.DB.prepare('UPDATE products SET stock=COALESCE(stock,0)+? WHERE id=?').bind(token.qty,token.productId).run().catch(()=>{});if(token.logId)await env.DB.prepare('DELETE FROM stock_log WHERE id=?').bind(token.logId).run().catch(()=>{});}if(token.previous){const p=token.previous;await env.DB.prepare('UPDATE order_stock_allocations SET store_id=?,batch_id=?,batch_item_id=?,product_id=?,variant_id=?,qty=?,status=?,updated_at=?,created_by=? WHERE order_id=? AND client_id=?').bind(p.store_id,p.batch_id,p.batch_item_id,p.product_id,p.variant_id,p.qty,p.status,p.updated_at,p.created_by,p.order_id,p.client_id).run().catch(()=>{});}else await env.DB.prepare('DELETE FROM order_stock_allocations WHERE order_id=? AND client_id=?').bind(token.orderId,token.clientId).run().catch(()=>{});await refreshBatchStatus(env,token.batchId).catch(()=>{});
}

export async function finalizeOrderStockTransition(env,{clientId,orderId,fromState,toState}={}){
  if(toState!=='returned'||!OUTBOUND_STATES.has(fromState))return {kind:'none'};
  const active=await activeItemAllocations(env,orderId,clientId);if(active.length){let qty=0;const batchIds=[];for(const a of active){const amount=num(a.qty);if(amount<=0)continue;await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(amount,a.batch_item_id).run();await env.DB.prepare("UPDATE order_item_stock_allocations SET status='returned',updated_at=? WHERE id=?").bind(now(),a.id).run();await env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=?").bind(a.batch_id).run();qty+=amount;if(!batchIds.includes(a.batch_id))batchIds.push(a.batch_id);}return {kind:'returned',fifo:true,batchId:batchIds[0]||null,batchIds,qty};}
  const a=await legacyAllocation(env,orderId,clientId);if(!a||a.status!=='allocated')return {kind:'none'};await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(Number(a.qty)||0,a.batch_item_id).run();await env.DB.prepare("UPDATE order_stock_allocations SET status='returned',updated_at=? WHERE order_id=? AND client_id=?").bind(now(),orderId,clientId).run();await env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=?").bind(a.batch_id).run();return {kind:'returned',batchId:a.batch_id,qty:Number(a.qty)||0};
}
