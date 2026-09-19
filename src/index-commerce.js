import baseWorker from './index.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
const now=()=>new Date().toISOString();
const id=p=>`${p}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
const num=v=>Number.isFinite(Number(v))?Number(v):0;

async function meFromBase(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await baseWorker.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
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
function canWriteOps(me){return me.role==='client'||['admin','ops'].includes(me.role)||(me.perms||[]).some(p=>['settings','entries'].includes(p));}
function canReadFinance(me){return me.role==='client'||['admin','ops','accountant'].includes(me.role);}
async function audit(env,me,clientId,storeId,action,entityType,entityId,before=null,after=null,metadata=null){
  await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id('AUD'),clientId||null,storeId||null,me.uid||null,me.email||null,action,entityType||null,entityId||null,before?JSON.stringify(before):null,after?JSON.stringify(after):null,metadata?JSON.stringify(metadata):null,now()).run();
}
async function poList(env,clientId,storeId){
  const {results}=await env.DB.prepare(`SELECT p.*,s.name supplier_name,(SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id=p.id) item_count FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.client_id=? ${storeId?'AND p.store_id=?':''} ORDER BY p.created_at DESC LIMIT 250`).bind(...(storeId?[clientId,storeId]:[clientId])).all();
  return results||[];
}
async function poDetail(env,poId,clientId,storeId){
  const po=await env.DB.prepare(`SELECT p.*,s.name supplier_name FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=? AND p.client_id=? ${storeId?'AND p.store_id=?':''}`).bind(...(storeId?[poId,clientId,storeId]:[poId,clientId])).first();
  if(!po)return null;
  const {results}=await env.DB.prepare(`SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY rowid`).bind(poId).all();
  po.items=results||[];return po;
}
async function createPO(request,env,me){
  if(!canWriteOps(me))return json({error:'مش مسموح'},403);
  const b=await request.json().catch(()=>({}));
  const clientId=targetClient(me,b.clientId||b.client_id);
  const storeId=b.storeId||b.store_id||request.headers.get('X-Kun-Store-Id')||null;
  if(!b.supplierId||!Array.isArray(b.items)||!b.items.length)return json({error:'حدد المورد وأضف منتج واحد على الأقل'},400);
  const supplier=await env.DB.prepare(`SELECT id,name FROM suppliers WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''} AND active=1`).bind(...(storeId?[b.supplierId,clientId,storeId]:[b.supplierId,clientId])).first();
  if(!supplier)return json({error:'المورد غير موجود أو غير نشط'},400);
  const poId=id('PO');const created=now();let subtotal=0;const items=[];
  for(const raw of b.items){
    const qty=Math.max(1,Math.floor(num(raw.qty||raw.qtyOrdered)));const unitCost=Math.max(0,num(raw.unitCost));
    let prod=null;
    if(raw.productId) prod=await env.DB.prepare(`SELECT id,name,sku,client_id,store_id FROM products WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''}`).bind(...(storeId?[raw.productId,clientId,storeId]:[raw.productId,clientId])).first();
    if(!prod)return json({error:'أحد المنتجات غير موجود في المتجر'},400);
    let variant=null;if(raw.variantId){variant=await env.DB.prepare(`SELECT id,name,sku,product_id FROM product_variants WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''}`).bind(...(storeId?[raw.variantId,clientId,storeId]:[raw.variantId,clientId])).first();if(!variant||variant.product_id!==prod.id)return json({error:'المتغير لا يتبع المنتج المحدد'},400);}
    const line=qty*unitCost;subtotal+=line;items.push({id:id('POI'),productId:prod.id,variantId:variant?.id||null,name:variant?`${prod.name} — ${variant.name}`:prod.name,sku:variant?.sku||prod.sku||'',qty,unitCost,line});
  }
  const shipping=Math.max(0,num(b.shippingCost)),discount=Math.max(0,num(b.discount)),tax=Math.max(0,num(b.tax)),total=Math.max(0,subtotal+shipping+tax-discount);
  const statements=[env.DB.prepare(`INSERT INTO purchase_orders (id,client_id,store_id,supplier_id,status,order_date,expected_date,currency,subtotal,shipping_cost,discount,tax,total,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(poId,clientId,storeId||null,supplier.id,'draft',String(b.orderDate||created.slice(0,10)),b.expectedDate||null,b.currency||'EGP',subtotal,shipping,discount,tax,total,b.note||'',me.email||me.uid||'',created,created)];
  items.forEach(x=>statements.push(env.DB.prepare(`INSERT INTO purchase_order_items (id,purchase_order_id,product_id,variant_id,product_name,sku,qty_ordered,qty_received,unit_cost,line_total) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(x.id,poId,x.productId,x.variantId,x.name,x.sku,x.qty,0,x.unitCost,x.line)));
  await env.DB.batch(statements);await audit(env,me,clientId,storeId,'purchase_order.create','purchase_order',poId,null,{supplierId:supplier.id,total,itemCount:items.length});
  return json({ok:true,purchaseOrder:await poDetail(env,poId,clientId,storeId)},201);
}
async function receivePO(request,env,me,poId){
  if(!canWriteOps(me))return json({error:'مش مسموح'},403);
  const b=await request.json().catch(()=>({}));
  const requested=b.clientId||b.client_id||(me.role==='client'?me.clientId:null);const clientId=targetClient(me,requested);
  const storeId=b.storeId||b.store_id||request.headers.get('X-Kun-Store-Id')||null;
  const po=await poDetail(env,poId,clientId,storeId);if(!po)return json({error:'أمر الشراء غير موجود'},404);
  if(['cancelled','received'].includes(po.status))return json({error:'أمر الشراء لا يقبل استلام جديد'},400);
  const wanted=new Map((Array.isArray(b.items)?b.items:[]).map(x=>[String(x.itemId||x.id),Math.max(0,Math.floor(num(x.qty||x.qtyReceived)))]));
  const incoming=po.items.map(x=>({row:x,qty:wanted.has(String(x.id))?wanted.get(String(x.id)):Math.max(0,num(x.qty_ordered)-num(x.qty_received))})).filter(x=>x.qty>0);
  if(!incoming.length)return json({error:'لا توجد كميات للاستلام'},400);
  for(const x of incoming){const remaining=num(x.row.qty_ordered)-num(x.row.qty_received);if(x.qty>remaining)return json({error:`الكمية المستلمة أكبر من المتبقي للمنتج ${x.row.product_name}`},400);}
  const receiptId=id('GRN'),ts=now();const stmts=[env.DB.prepare(`INSERT INTO goods_receipts (id,client_id,store_id,purchase_order_id,supplier_id,received_at,received_by,note) VALUES (?,?,?,?,?,?,?,?)`).bind(receiptId,clientId,po.store_id||storeId||null,poId,po.supplier_id,ts,me.email||me.uid||'',b.note||'')];
  for(const x of incoming){
    const r=x.row;stmts.push(env.DB.prepare(`INSERT INTO goods_receipt_items (id,receipt_id,purchase_order_item_id,product_id,variant_id,qty_received,unit_cost) VALUES (?,?,?,?,?,?,?)`).bind(id('GRI'),receiptId,r.id,r.product_id,r.variant_id,x.qty,r.unit_cost));
    stmts.push(env.DB.prepare('UPDATE purchase_order_items SET qty_received=qty_received+? WHERE id=?').bind(x.qty,r.id));
    if(r.variant_id) stmts.push(env.DB.prepare('UPDATE product_variants SET stock=stock+? WHERE id=? AND client_id=?').bind(x.qty,r.variant_id,clientId));
    else stmts.push(env.DB.prepare('UPDATE products SET stock=stock+? WHERE id=? AND client_id=?').bind(x.qty,r.product_id,clientId));
  }
  await env.DB.batch(stmts);
  for(const x of incoming){const r=x.row;const stockRow=r.variant_id?await env.DB.prepare('SELECT stock FROM product_variants WHERE id=?').bind(r.variant_id).first():await env.DB.prepare('SELECT stock FROM products WHERE id=?').bind(r.product_id).first();await env.DB.prepare(`INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id('STK'),clientId,po.store_id||storeId||null,r.product_id,r.variant_id||null,r.product_name,x.qty,num(stockRow?.stock),`استلام أمر شراء ${poId}`,po.supplier_id,po.supplier_name||null,ts,me.email||me.uid||'').run();}
  const remaining=await env.DB.prepare(`SELECT SUM(qty_ordered-qty_received) remaining FROM purchase_order_items WHERE purchase_order_id=?`).bind(poId).first();const status=num(remaining?.remaining)<=0?'received':'partial';await env.DB.prepare('UPDATE purchase_orders SET status=?,updated_at=? WHERE id=?').bind(status,ts,poId).run();
  await audit(env,me,clientId,po.store_id||storeId,'purchase_order.receive','purchase_order',poId,{status:po.status},{status,receiptId,items:incoming.map(x=>({itemId:x.row.id,qty:x.qty}))});
  return json({ok:true,receiptId,status,purchaseOrder:await poDetail(env,poId,clientId,storeId)});
}
async function workflows(request,env,me,url){
  const selectedStore=url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||null;
  if(request.method==='GET'){const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));const {results}=await env.DB.prepare(`SELECT id,store_id,name,trigger_type,definition_json,active,created_by,created_at,updated_at FROM workflows WHERE client_id=? ${selectedStore?'AND store_id=?':''} ORDER BY created_at DESC`).bind(...(selectedStore?[clientId,selectedStore]:[clientId])).all();return json((results||[]).map(x=>({...x,definition:JSON.parse(x.definition_json||'{}')})));}
  if(!canWriteOps(me))return json({error:'مش مسموح'},403);
  const b=await request.json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null)),storeId=b.storeId||b.store_id||selectedStore;if(!b.name||!b.triggerType)return json({error:'الاسم والـTrigger مطلوبان'},400);const name=String(b.name).trim();const duplicate=await env.DB.prepare('SELECT id FROM workflows WHERE client_id=? AND store_id IS ? AND lower(name)=lower(?)').bind(clientId,storeId||null,name).first();if(duplicate)return json({error:'يوجد Workflow بنفس الاسم في هذا الفرع',code:'DUPLICATE_WORKFLOW',id:duplicate.id},409);const wid=id('WF'),ts=now();
  const definition={conditions:Array.isArray(b.conditions)?b.conditions:[],actions:Array.isArray(b.actions)?b.actions:[]};await env.DB.prepare(`INSERT INTO workflows (id,client_id,store_id,name,trigger_type,definition_json,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(wid,clientId,storeId||null,name,String(b.triggerType),JSON.stringify(definition),b.active?1:0,me.email||me.uid||'',ts,ts).run();await audit(env,me,clientId,storeId,'workflow.create','workflow',wid,null,{name,triggerType:b.triggerType});return json({ok:true,id:wid,storeId:storeId||null},201);
}
async function auditList(env,me,url){
  if(!canReadFinance(me))return json({error:'مش مسموح'},403);const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null)),storeId=url.searchParams.get('storeId')||null,limit=Math.min(200,Math.max(1,num(url.searchParams.get('limit'))||100));const {results}=await env.DB.prepare(`SELECT id,store_id,actor_email,action,entity_type,entity_id,metadata_json,created_at FROM audit_log WHERE client_id=? ${storeId?'AND store_id=?':''} ORDER BY created_at DESC LIMIT ?`).bind(...(storeId?[clientId,storeId,limit]:[clientId,limit])).all();return json((results||[]).map(x=>({...x,metadata:x.metadata_json?JSON.parse(x.metadata_json):null})));
}

async function commerceFetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname;
  const commercePath=path.startsWith('/api/purchase-orders')||path==='/api/workflows'||path==='/api/audit-log';
  if(!commercePath)return baseWorker.fetch(request,env,ctx);
  try{
    const me=await meFromBase(request,env,ctx);
    if(path==='/api/purchase-orders'&&request.method==='GET'){const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await poList(env,clientId,url.searchParams.get('storeId')));}
    if(path==='/api/purchase-orders'&&request.method==='POST')return createPO(request,env,me);
    const receive=path.match(/^\/api\/purchase-orders\/([^/]+)\/receive$/);if(receive&&request.method==='POST')return receivePO(request,env,me,decodeURIComponent(receive[1]));
    const detail=path.match(/^\/api\/purchase-orders\/([^/]+)$/);if(detail&&request.method==='GET'){const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));const po=await poDetail(env,decodeURIComponent(detail[1]),clientId,url.searchParams.get('storeId'));return po?json(po):json({error:'أمر الشراء غير موجود'},404);}
    if(path==='/api/workflows'&&['GET','POST'].includes(request.method))return workflows(request,env,me,url);
    if(path==='/api/audit-log'&&request.method==='GET')return auditList(env,me,url);
    return json({error:'المسار غير مدعوم'},405);
  }catch(e){return json({error:e.message||'حدث خطأ'},e.status||500);}
}

export default {
  fetch:commerceFetch,
  scheduled(controller,env,ctx){return baseWorker.scheduled?.(controller,env,ctx);}
};
