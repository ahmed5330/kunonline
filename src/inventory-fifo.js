const OUTBOUND_STATES=new Set(['shipped','signed','collected']);
const clean=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const stamp=()=>new Date().toISOString();
const rid=prefix=>`${prefix}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const actorName=actor=>clean(actor?.email||actor?.name||actor?.role||actor?.id||actor?.uid)||'system';
const fail=(message,status=400,code='ORDER_FIFO_STOCK_ERROR')=>{throw Object.assign(new Error(message),{status,code});};

async function refreshBatchStatus(env,batchId){const row=await env.DB.prepare('SELECT COALESCE(SUM(remaining_qty),0) remaining FROM inventory_batch_items WHERE batch_id=?').bind(batchId).first();await env.DB.prepare('UPDATE inventory_batches SET status=? WHERE id=?').bind(num(row?.remaining)>0?'active':'depleted',batchId).run();}
async function legacyAllocation(env,orderId,clientId){return env.DB.prepare('SELECT * FROM order_stock_allocations WHERE order_id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);}
async function activeAllocations(env,orderId,clientId){const {results=[]}=await env.DB.prepare("SELECT a.*,i.product_name,b.name batch_name FROM order_item_stock_allocations a LEFT JOIN inventory_batch_items i ON i.id=a.batch_item_id LEFT JOIN inventory_batches b ON b.id=a.batch_id WHERE a.order_id=? AND a.client_id=? AND a.status='allocated' ORDER BY a.created_at,a.id").bind(orderId,clientId).all().catch(()=>({results:[]}));return results;}

async function resolveLegacyOrderProduct(env,order){
  if(order.product_id)return {productId:order.product_id,variantId:order.variant_id||null};
  const name=clean(order.product);if(!name)fail('الأوردر غير مربوط بمنتج في المخزون',409,'ORDER_PRODUCT_NOT_LINKED');
  const {results=[]}=await env.DB.prepare('SELECT id FROM products WHERE client_id=? AND store_id=? AND trim(name)=trim(?) LIMIT 2').bind(order.client_id,order.store_id,name).all();
  if(results.length!==1)fail('تعذر تحديد منتج الأوردر داخل المخزون بدقة. اربطه بمنتج أولًا.',409,'ORDER_PRODUCT_MATCH_AMBIGUOUS');
  await env.DB.prepare('UPDATE orders SET product_id=? WHERE id=? AND client_id=?').bind(results[0].id,order.id,order.client_id).run();return {productId:results[0].id,variantId:null};
}
async function resolveLineProduct(env,order,line){
  if(line.product_id)return line;
  const sku=clean(line.sku),name=clean(line.product_name);
  if(sku){
    const {results:variants=[]}=await env.DB.prepare(`SELECT v.id variant_id,v.product_id FROM product_variants v WHERE v.client_id=? AND v.store_id=? AND trim(v.sku)=trim(?) LIMIT 2`).bind(order.client_id,order.store_id,sku).all();
    if(variants.length===1){await env.DB.prepare('UPDATE order_items SET product_id=?,variant_id=? WHERE id=? AND client_id=?').bind(variants[0].product_id,variants[0].variant_id,line.id,order.client_id).run();return {...line,product_id:variants[0].product_id,variant_id:variants[0].variant_id};}
    const {results:products=[]}=await env.DB.prepare('SELECT id FROM products WHERE client_id=? AND store_id=? AND trim(sku)=trim(?) LIMIT 2').bind(order.client_id,order.store_id,sku).all();
    if(products.length===1){await env.DB.prepare('UPDATE order_items SET product_id=? WHERE id=? AND client_id=?').bind(products[0].id,line.id,order.client_id).run();return {...line,product_id:products[0].id};}
  }
  if(name){const {results:products=[]}=await env.DB.prepare('SELECT id FROM products WHERE client_id=? AND store_id=? AND trim(name)=trim(?) LIMIT 2').bind(order.client_id,order.store_id,name).all();if(products.length===1){await env.DB.prepare('UPDATE order_items SET product_id=? WHERE id=? AND client_id=?').bind(products[0].id,line.id,order.client_id).run();return {...line,product_id:products[0].id};}}
  fail(`المنتج «${name||sku||'غير معروف'}» غير مربوط بمنتج/متغير في المخزون`,409,'ORDER_ITEM_PRODUCT_NOT_LINKED');
}
async function orderLines(env,order){
  const {results=[]}=await env.DB.prepare('SELECT * FROM order_items WHERE order_id=? AND client_id=? AND qty>0 ORDER BY created_at,id').bind(order.id,order.client_id).all().catch(()=>({results:[]}));
  if(results.length){const lines=[];for(const line of results)lines.push(await resolveLineProduct(env,order,line));return lines;}
  const resolved=await resolveLegacyOrderProduct(env,order);return [{id:`LEGACY-${order.id}`,product_id:resolved.productId,variant_id:resolved.variantId,product_name:clean(order.product)||'منتج',qty:Math.max(1,num(order.qty)||1)}];
}
async function fifoLots(env,{clientId,storeId,productId,variantId}){
  const variantSql=variantId?' AND i.variant_id=?':' AND i.variant_id IS NULL',binds=[clientId,storeId,productId];if(variantId)binds.push(variantId);
  const {results=[]}=await env.DB.prepare(`SELECT i.*,b.name batch_name,b.stock_date,b.created_at batch_created_at FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.client_id=? AND i.store_id=? AND i.product_id=?${variantSql} AND i.remaining_qty>0 ORDER BY b.stock_date ASC,b.created_at ASC,i.created_at ASC,i.id ASC`).bind(...binds).all();return results;
}
async function stockValue(env,{clientId,productId,variantId}){return variantId?env.DB.prepare('SELECT stock FROM product_variants WHERE id=? AND client_id=?').bind(variantId,clientId).first():env.DB.prepare('SELECT stock FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();}
async function setStock(env,{clientId,productId,variantId,stock}){return variantId?env.DB.prepare('UPDATE product_variants SET stock=? WHERE id=? AND client_id=?').bind(stock,variantId,clientId).run():env.DB.prepare('UPDATE products SET stock=? WHERE id=? AND client_id=?').bind(stock,productId,clientId).run();}
async function changeStock(env,args,delta){const current=await stockValue(env,args),next=Math.max(0,num(current?.stock)+delta);await setStock(env,{...args,stock:next});return next;}
async function stockLog(env,{clientId,storeId,productId,variantId,productName,qty,newStock,lot,orderId,actor}){const id=rid('STK'),at=stamp();await env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,batch_id,batch_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,clientId,storeId,productId,variantId||null,productName||'',-qty,newStock,`خصم أوردر ${orderId} تلقائيًا بنظام FIFO — ${lot.batch_name}`,null,null,at.slice(0,10),lot.batch_id,lot.batch_name,at,actorName(actor)).run();return id;}

async function rollbackSlices(env,token){
  for(const slice of [...(token?.slices||[])].reverse()){
    await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(slice.qty,slice.batchItemId).run().catch(()=>{});
    if(slice.generalAdjusted){if(slice.variantId)await env.DB.prepare('UPDATE product_variants SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?').bind(slice.qty,slice.variantId,token.clientId).run().catch(()=>{});else await env.DB.prepare('UPDATE products SET stock=COALESCE(stock,0)+? WHERE id=? AND client_id=?').bind(slice.qty,slice.productId,token.clientId).run().catch(()=>{});if(slice.logId)await env.DB.prepare('DELETE FROM stock_log WHERE id=?').bind(slice.logId).run().catch(()=>{});}
    await env.DB.prepare('DELETE FROM order_item_stock_allocations WHERE id=?').bind(slice.allocationId).run().catch(()=>{});await refreshBatchStatus(env,slice.batchId).catch(()=>{});
  }
}

export async function prepareOrderStockTransition(env,{clientId,storeId,orderId,fromState,toState,actor}={}){
  if(OUTBOUND_STATES.has(fromState)||!OUTBOUND_STATES.has(toState))return {kind:'none'};
  const order=await env.DB.prepare('SELECT id,client_id,store_id,product,product_id,variant_id,qty,date,created_at FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!order)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');storeId=clean(storeId||order.store_id);if(!storeId)fail('الأوردر غير مربوط بمتجر',409,'ORDER_STORE_REQUIRED');order.store_id=storeId;
  const [legacy,active]=await Promise.all([legacyAllocation(env,orderId,clientId),activeAllocations(env,orderId,clientId)]);if(legacy?.status==='allocated'||active.length)return {kind:'none',allocation:legacy||active[0]};
  const lines=await orderLines(env,order),groups=new Map();
  for(const line of lines){const productId=clean(line.product_id),variantId=clean(line.variant_id)||null,qty=Math.max(1,num(line.qty)||1),key=`${productId}::${variantId||''}`;if(!groups.has(key))groups.set(key,{productId,variantId,needed:0,lines:[]});const group=groups.get(key);group.needed+=qty;group.lines.push({...line,qty});}
  for(const group of groups.values()){group.lots=await fifoLots(env,{clientId,storeId,productId:group.productId,variantId:group.variantId});const available=group.lots.reduce((sum,lot)=>sum+num(lot.remaining_qty),0);if(available<group.needed)fail(`المخزون غير كافٍ للمنتج «${clean(group.lines[0]?.product_name)||group.productId}». المطلوب ${group.needed} والمتاح ${available}.`,409,'STOCK_FIFO_INSUFFICIENT');}
  const generalAdjusted=fromState!=='returned',token={kind:'allocated',fifo:true,orderId,clientId,storeId,qty:0,slices:[],batchIds:[],batchNames:[]};
  try{
    for(const group of groups.values()){
      const lots=group.lots.map(lot=>({...lot,virtualRemaining:num(lot.remaining_qty)}));
      for(const line of group.lines){let left=line.qty;for(const lot of lots){if(left<=0)break;if(lot.virtualRemaining<=0)continue;const take=Math.min(left,lot.virtualRemaining),changed=await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty-? WHERE id=? AND remaining_qty>=?').bind(take,lot.id,take).run();if(Number(changed?.meta?.changes||0)!==1)fail('المخزون اتغير أثناء الخصم التلقائي. أعد المحاولة.',409,'STOCK_FIFO_CONCURRENT_CHANGE');
        let newStock=null,logId=null;if(generalAdjusted){newStock=await changeStock(env,{clientId,productId:group.productId,variantId:group.variantId},-take);logId=await stockLog(env,{clientId,storeId,productId:group.productId,variantId:group.variantId,productName:lot.product_name||line.product_name,qty:take,newStock,lot,orderId,actor});}
        const allocationId=rid('OIA'),at=stamp();await env.DB.prepare(`INSERT INTO order_item_stock_allocations (id,order_id,order_item_id,client_id,store_id,batch_id,batch_item_id,product_id,variant_id,qty,status,stock_date,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,'allocated',?,?,?,?)`).bind(allocationId,orderId,line.id,clientId,storeId,lot.batch_id,lot.id,group.productId,group.variantId,take,lot.stock_date||at.slice(0,10),at,at,actorName(actor)).run();
        token.slices.push({allocationId,batchId:lot.batch_id,batchItemId:lot.id,batchName:lot.batch_name,productId:group.productId,variantId:group.variantId,qty:take,generalAdjusted,logId});token.qty+=take;if(!token.batchIds.includes(lot.batch_id)){token.batchIds.push(lot.batch_id);token.batchNames.push(lot.batch_name);}lot.virtualRemaining-=take;left-=take;await refreshBatchStatus(env,lot.batch_id);}
        if(left>0)fail('تعذر إكمال الخصم التلقائي من دفعات المخزون',409,'STOCK_FIFO_ALLOCATION_INCOMPLETE');
      }
    }
    token.batchId=token.batchIds[0]||null;token.batchName=token.batchNames[0]||'FIFO';return token;
  }catch(error){await rollbackSlices(env,token);throw error;}
}

export async function rollbackOrderStockTransition(env,token){if(!token||token.kind!=='allocated')return;if(token.fifo)return rollbackSlices(env,token);}

export async function finalizeOrderStockTransition(env,{clientId,orderId,fromState,toState}={}){
  if(toState!=='returned'||!OUTBOUND_STATES.has(fromState))return {kind:'none'};
  const active=await activeAllocations(env,orderId,clientId);if(active.length){let qty=0;const batchIds=[];for(const allocation of active){const amount=num(allocation.qty);if(amount<=0)continue;await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(amount,allocation.batch_item_id).run();await env.DB.prepare("UPDATE order_item_stock_allocations SET status='returned',updated_at=? WHERE id=?").bind(stamp(),allocation.id).run();await env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=?").bind(allocation.batch_id).run();qty+=amount;if(!batchIds.includes(allocation.batch_id))batchIds.push(allocation.batch_id);}return {kind:'returned',fifo:true,batchId:batchIds[0]||null,batchIds,qty};}
  const legacy=await legacyAllocation(env,orderId,clientId);if(!legacy||legacy.status!=='allocated')return {kind:'none'};await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=?').bind(num(legacy.qty),legacy.batch_item_id).run();await env.DB.prepare("UPDATE order_stock_allocations SET status='returned',updated_at=? WHERE order_id=? AND client_id=?").bind(stamp(),orderId,clientId).run();await env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=?").bind(legacy.batch_id).run();return {kind:'returned',batchId:legacy.batch_id,qty:num(legacy.qty)};
}
