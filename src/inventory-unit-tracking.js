import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const num=v=>Number(v)||0;
const stamp=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const AVAILABLE=new Set(['in_stock','returned_in_stock']);
const HOLDING=new Set(['confirmed','preparing']);
const SHIPPED=new Set(['shipped']);
const DELIVERED=new Set(['signed','collected']);
const RELEASED=new Set(['pending','deferred','cancelled']);
const RETURN_HOLD=new Set(['returned_pending_inspection','quarantined','damaged']);
const SCAN_CONTEXTS=new Set(['packing','dispatch']);
const fail=(message,status=400,code='UNIT_TRACKING_ERROR')=>{throw Object.assign(new Error(message),{status,code});};

const SCHEMA=[
  `CREATE TABLE IF NOT EXISTS product_tracking_codes (id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,product_id TEXT NOT NULL,variant_id TEXT,code TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_tracking_code_unique ON product_tracking_codes(client_id,code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_tracking_entity_unique ON product_tracking_codes(client_id,product_id,COALESCE(variant_id,''))`,
  `CREATE TABLE IF NOT EXISTS inventory_units (id TEXT PRIMARY KEY,unit_code TEXT NOT NULL,client_id TEXT NOT NULL,store_id TEXT,product_id TEXT NOT NULL,variant_id TEXT,batch_id TEXT,batch_item_id TEXT,product_name TEXT,sku TEXT,status TEXT NOT NULL DEFAULT 'in_stock',current_order_id TEXT,last_order_id TEXT,received_at TEXT,reserved_at TEXT,shipped_at TEXT,delivered_at TEXT,returned_at TEXT,retired_at TEXT,source TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unit_code_unique ON inventory_units(client_id,unit_code)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_units_stock ON inventory_units(client_id,store_id,product_id,variant_id,status,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_units_batch ON inventory_units(client_id,batch_item_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_units_order ON inventory_units(client_id,current_order_id,status)`,
  `CREATE TABLE IF NOT EXISTS inventory_unit_events (id TEXT PRIMARY KEY,unit_id TEXT NOT NULL,unit_code TEXT NOT NULL,client_id TEXT NOT NULL,store_id TEXT,order_id TEXT,event_type TEXT NOT NULL,from_status TEXT,to_status TEXT,note TEXT,source TEXT,actor TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_unit ON inventory_unit_events(client_id,unit_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_code ON inventory_unit_events(client_id,unit_code,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_unit_events_order ON inventory_unit_events(client_id,order_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS order_unit_allocations (id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,order_id TEXT NOT NULL,order_item_id TEXT,stock_allocation_id TEXT,unit_id TEXT NOT NULL,unit_code TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,released_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_order_unit_unique ON order_unit_allocations(order_id,unit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_unit_order ON order_unit_allocations(client_id,order_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_order_unit_unit ON order_unit_allocations(client_id,unit_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS inventory_scan_sessions (id TEXT PRIMARY KEY,client_id TEXT NOT NULL,store_id TEXT,order_id TEXT NOT NULL,scan_context TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',order_scan_code TEXT,expected_units INTEGER NOT NULL DEFAULT 0,scanned_units INTEGER NOT NULL DEFAULT 0,awb TEXT,actor TEXT,actor_user_id TEXT,device_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_scan_sessions_order ON inventory_scan_sessions(client_id,order_id,scan_context,status,updated_at)`,
  `CREATE TABLE IF NOT EXISTS inventory_scan_events (id TEXT PRIMARY KEY,session_id TEXT,client_id TEXT NOT NULL,store_id TEXT,order_id TEXT,unit_id TEXT,unit_code TEXT,scan_context TEXT NOT NULL,scan_kind TEXT NOT NULL,result TEXT NOT NULL,awb TEXT,actor TEXT,actor_user_id TEXT,device_id TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_scan_events_order ON inventory_scan_events(client_id,order_id,scan_context,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_scan_events_unit ON inventory_scan_events(client_id,unit_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_scan_events_session ON inventory_scan_events(session_id,created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_scan_unit_accept_unique ON inventory_scan_events(session_id,unit_id,scan_kind) WHERE unit_id IS NOT NULL AND result='accepted'`
];

let schemaReady=false;
export async function ensureInventoryUnitSchema(env){
  if(schemaReady)return;
  for(const sql of SCHEMA)await env.DB.prepare(sql).run();
  schemaReady=true;
}

async function currentUser(request,env,ctx,delegate){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const response=await delegate.fetch(new Request(u.toString(),{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)fail(me?.error||'محتاج تسجّل دخول',response.status||401,'AUTH_REQUIRED');
  return me;
}
async function scoped(request,env,me,clientId,{write=false,storeId=null}={}){
  const s=await resolveStoreScope(env,me,clientId,storeId||new URL(request.url).searchParams.get('storeId')||null,{write});
  return s.storeId||null;
}
function actorName(me){return clean(me?.email||me?.name||me?.role||me?.uid)||'system';}
function safeCode(v){return clean(v,100).toUpperCase().replace(/[^A-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50);}
function scanCode(value){
  let v=clean(value,1000);
  try{const u=new URL(v);v=u.searchParams.get('unit')||u.searchParams.get('code')||v;}catch{}
  v=v.replace(/^KUN:UNIT:/i,'').trim();
  return safeCode(v);
}
function qrValue(unitCode){return `https://app.kun-online.com/v2/?unit=${encodeURIComponent(unitCode)}`;}
function barcodeValue(unitCode){return clean(unitCode,100);}

async function trackingCode(env,{clientId,storeId,productId,variantId=null,createdBy='system'}){
  const existing=await env.DB.prepare('SELECT code FROM product_tracking_codes WHERE client_id=? AND product_id=? AND COALESCE(variant_id,\'\')=COALESCE(?,\'\') LIMIT 1').bind(clientId,productId,variantId).first();
  if(existing?.code)return existing.code;
  let row;
  if(variantId)row=await env.DB.prepare('SELECT v.sku,v.name,p.sku product_sku,p.name product_name FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.id=? AND v.product_id=? AND v.client_id=?').bind(variantId,productId,clientId).first();
  else row=await env.DB.prepare('SELECT sku,name product_name FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();
  if(!row)fail('المنتج غير موجود لإنشاء كود التتبع',404,'TRACKING_PRODUCT_NOT_FOUND');
  const preferred=safeCode(row.sku||row.product_sku||'');
  for(let attempt=0;attempt<8;attempt++){
    const base=preferred||(variantId?'V':'P')+'-'+crypto.randomUUID().slice(0,6).toUpperCase();
    const code=attempt===0?base:`${base}-${crypto.randomUUID().slice(0,3).toUpperCase()}`;
    try{
      await env.DB.prepare('INSERT INTO product_tracking_codes (id,client_id,store_id,product_id,variant_id,code,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)').bind(rid('PTC'),clientId,storeId,productId,variantId,code,stamp(),createdBy).run();
      return code;
    }catch(error){if(!/UNIQUE/i.test(String(error?.message||error)))throw error;}
  }
  fail('تعذر إنشاء كود منتج فريد',409,'TRACKING_CODE_COLLISION');
}

async function event(env,unit,{eventType,fromStatus=null,toStatus=null,orderId=null,note='',source='unit_tracking',actor='system',metadata={}}){
  await env.DB.prepare('INSERT INTO inventory_unit_events (id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,note,source,actor,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(rid('UEV'),unit.id,unit.unit_code,unit.client_id,unit.store_id||null,orderId||unit.current_order_id||unit.last_order_id||null,eventType,fromStatus,toStatus,clean(note,1200),source,actor,JSON.stringify(metadata||{}),stamp()).run();
}

async function createUnit(env,{clientId,storeId,productId,variantId=null,batchId=null,batchItemId=null,productName='',sku='',source='inventory',receivedAt=null,createdBy='system',metadata={}}){
  const pcode=await trackingCode(env,{clientId,storeId,productId,variantId,createdBy});
  for(let attempt=0;attempt<10;attempt++){
    const suffix=crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase(),unitCode=`${pcode}-${suffix}`,id=rid('UNT'),at=stamp();
    try{
      const unit={id,unit_code:unitCode,client_id:clientId,store_id:storeId||null,product_id:productId,variant_id:variantId||null,batch_id:batchId||null,batch_item_id:batchItemId||null,product_name:productName||'',sku:sku||'',status:'in_stock',current_order_id:null,last_order_id:null};
      await env.DB.prepare('INSERT INTO inventory_units (id,unit_code,client_id,store_id,product_id,variant_id,batch_id,batch_item_id,product_name,sku,status,current_order_id,last_order_id,received_at,source,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,unitCode,clientId,storeId||null,productId,variantId||null,batchId||null,batchItemId||null,productName||'',sku||'','in_stock',null,null,receivedAt||at,source,JSON.stringify(metadata||{}),at,at).run();
      await event(env,unit,{eventType:'received_into_inventory',toStatus:'in_stock',note:'تم إنشاء كود تتبع للقطعة وإدخالها إلى المخزون',source,actor:createdBy,metadata:{productTrackingCode:pcode,...metadata}});
      return unit;
    }catch(error){if(!/UNIQUE/i.test(String(error?.message||error)))throw error;}
  }
  fail('تعذر إنشاء كود قطعة فريد',409,'UNIT_CODE_COLLISION');
}

async function productInfo(env,{clientId,productId,variantId=null}){
  if(variantId){
    return env.DB.prepare('SELECT p.name product_name,COALESCE(v.sku,p.sku,\'\') sku,v.stock FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.id=? AND v.product_id=? AND v.client_id=?').bind(variantId,productId,clientId).first();
  }
  return env.DB.prepare('SELECT name product_name,COALESCE(sku,\'\') sku,stock FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();
}

async function reconcileBatchItem(env,item,{actor='system'}={}){
  const target=Math.max(0,Math.floor(num(item.initial_qty))),remaining=item.remaining_qty===undefined||item.remaining_qty===null?target:Math.floor(num(item.remaining_qty)),desiredAvailable=Math.max(0,Math.min(target,remaining)),row=await env.DB.prepare('SELECT COUNT(*) n FROM inventory_units WHERE client_id=? AND batch_item_id=?').bind(item.client_id,item.id).first(),have=num(row?.n);
  const p=await productInfo(env,{clientId:item.client_id,productId:item.product_id,variantId:item.variant_id||null});
  let created=0;
  for(let i=have;i<target;i++){
    await createUnit(env,{clientId:item.client_id,storeId:item.store_id,productId:item.product_id,variantId:item.variant_id||null,batchId:item.batch_id,batchItemId:item.id,productName:item.product_name||p?.product_name||'',sku:p?.sku||'',source:'inventory_batch',receivedAt:item.batch_created_at||item.created_at,createdBy:actor,metadata:{batchName:item.batch_name||'',legacyBackfill:Boolean(item.existing_batch)}});
    created++;
  }

  // Historical lots can have initial_qty > remaining_qty because pieces already left stock
  // before unit tracking existed. Keep only remaining_qty as physically available; the
  // difference becomes legacy_outbound until a live allocation claims it.
  const {results:available=[]}=await env.DB.prepare("SELECT * FROM inventory_units WHERE client_id=? AND batch_item_id=? AND status IN ('in_stock','returned_in_stock') AND current_order_id IS NULL ORDER BY created_at,id").bind(item.client_id,item.id).all();
  if(available.length>desiredAvailable){
    const surplus=available.length-desiredAvailable;
    for(const unit of available.slice(0,surplus)){
      await setStatus(env,unit,'legacy_outbound',{eventType:'legacy_backfill_outbound',note:'قطعة تاريخية خرجت من المخزون قبل تفعيل تتبع الوحدات',source:'unit_tracking_backfill',actor,metadata:{batchId:item.batch_id,batchName:item.batch_name||'',initialQty:target,remainingQty:desiredAvailable}});
    }
  }else if(available.length<desiredAvailable){
    const need=desiredAvailable-available.length;
    const {results:recoverable=[]}=await env.DB.prepare("SELECT * FROM inventory_units WHERE client_id=? AND batch_item_id=? AND status='legacy_outbound' AND current_order_id IS NULL ORDER BY created_at,id LIMIT ?").bind(item.client_id,item.id,need).all();
    for(const unit of recoverable){
      await setStatus(env,unit,'in_stock',{eventType:'legacy_backfill_recovered',note:'تمت مطابقة القطعة مع الرصيد الحالي وإعادتها كقطعة متاحة',source:'unit_tracking_backfill',actor,metadata:{batchId:item.batch_id,batchName:item.batch_name||'',remainingQty:desiredAvailable}});
    }
  }
  return {created,target,available:desiredAvailable};
}

async function reconcileBatch(env,{clientId,batchId,actor='system'}){
  const {results=[]}=await env.DB.prepare('SELECT i.*,b.name batch_name,b.created_at batch_created_at FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.client_id=? AND i.batch_id=?').bind(clientId,batchId).all();
  let created=0;for(const item of results)created+=(await reconcileBatchItem(env,item,{actor})).created;return {created,items:results.length};
}

async function availableCount(env,{clientId,storeId,productId,variantId=null}){
  const sql=`SELECT COUNT(*) n FROM inventory_units WHERE client_id=? AND store_id IS ? AND product_id=? AND COALESCE(variant_id,'')=COALESCE(?,'') AND status IN ('in_stock','returned_in_stock') AND current_order_id IS NULL`;
  return num((await env.DB.prepare(sql).bind(clientId,storeId||null,productId,variantId).first())?.n);
}
async function reconcileEntityStock(env,{clientId,storeId,productId,variantId=null,actor='system',source='coverage_backfill'}){
  const p=await productInfo(env,{clientId,productId,variantId});if(!p)return {created:0,missing:0};
  const target=Math.max(0,Math.floor(num(p.stock))),have=await availableCount(env,{clientId,storeId,productId,variantId});
  if(have>=target)return {created:0,target,have};
  let created=0;for(let i=have;i<target;i++){await createUnit(env,{clientId,storeId,productId,variantId,productName:p.product_name||'',sku:p.sku||'',source,createdBy:actor,metadata:{coverageBackfill:true}});created++;}
  return {created,target,have:target};
}
export async function reconcileAllUnitCoverage(env,{clientId,storeId=null,actor='system'}={}){
  await ensureInventoryUnitSchema(env);
  const batchBinds=[clientId],storeSql=storeId?' AND i.store_id=?':'';if(storeId)batchBinds.push(storeId);
  const {results:items=[]}=await env.DB.prepare(`SELECT i.*,b.name batch_name,b.created_at batch_created_at,1 existing_batch FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.client_id=?${storeSql}`).bind(...batchBinds).all();
  let created=0;for(const item of items)created+=(await reconcileBatchItem(env,item,{actor})).created;
  const pb=[clientId],ps=storeId?' AND store_id=?':'';if(storeId)pb.push(storeId);
  const {results:products=[]}=await env.DB.prepare(`SELECT id,store_id FROM products WHERE client_id=?${ps} AND active=1`).bind(...pb).all();
  for(const p of products){
    const {results:variants=[]}=await env.DB.prepare('SELECT id FROM product_variants WHERE product_id=? AND client_id=? AND active=1').bind(p.id,clientId).all();
    if(variants.length){for(const v of variants)created+=(await reconcileEntityStock(env,{clientId,storeId:p.store_id||storeId,productId:p.id,variantId:v.id,actor})).created;}
    else created+=(await reconcileEntityStock(env,{clientId,storeId:p.store_id||storeId,productId:p.id,actor})).created;
  }
  return {ok:true,created};
}

async function setStatus(env,unit,status,{orderId=null,eventType='status_changed',note='',source='order_lifecycle',actor='system',metadata={}}={}){
  const clearsCurrentOrder=['in_stock','returned_in_stock','retired','legacy_outbound',...RETURN_HOLD].includes(status);
  if(unit.status===status&&String(unit.current_order_id||'')===String((clearsCurrentOrder?null:orderId)||''))return unit;
  const from=unit.status,at=stamp(),fields={reserved_at:null,shipped_at:null,delivered_at:null,returned_at:null,retired_at:null};
  if(status==='reserved')fields.reserved_at=at;if(status==='shipped')fields.shipped_at=at;if(status==='delivered')fields.delivered_at=at;if(status==='returned_in_stock'||RETURN_HOLD.has(status))fields.returned_at=at;if(status==='retired')fields.retired_at=at;
  const clear=['in_stock','returned_in_stock','retired','legacy_outbound',...RETURN_HOLD].includes(status),current=clear?null:(orderId||unit.current_order_id||null),last=orderId||unit.current_order_id||unit.last_order_id||null;
  await env.DB.prepare(`UPDATE inventory_units SET status=?,current_order_id=?,last_order_id=?,reserved_at=COALESCE(?,reserved_at),shipped_at=COALESCE(?,shipped_at),delivered_at=COALESCE(?,delivered_at),returned_at=COALESCE(?,returned_at),retired_at=COALESCE(?,retired_at),updated_at=? WHERE id=?`).bind(status,current,last,fields.reserved_at,fields.shipped_at,fields.delivered_at,fields.returned_at,fields.retired_at,at,unit.id).run();
  await event(env,unit,{eventType,fromStatus:from,toStatus:status,orderId:last,note,source,actor,metadata});
  return {...unit,status,current_order_id:current,last_order_id:last};
}

async function stockAllocations(env,clientId,orderId){
  let {results=[]}=await env.DB.prepare("SELECT a.*,i.product_name,b.name batch_name FROM order_item_stock_allocations a LEFT JOIN inventory_batch_items i ON i.id=a.batch_item_id LEFT JOIN inventory_batches b ON b.id=a.batch_id WHERE a.client_id=? AND a.order_id=? AND a.status='allocated' ORDER BY a.created_at,a.id").bind(clientId,orderId).all().catch(()=>({results:[]}));
  if(results.length)return results;
  const legacy=await env.DB.prepare("SELECT a.*,i.product_name,b.name batch_name,NULL order_item_id,a.order_id stock_allocation_id FROM order_stock_allocations a LEFT JOIN inventory_batch_items i ON i.id=a.batch_item_id LEFT JOIN inventory_batches b ON b.id=a.batch_id WHERE a.client_id=? AND a.order_id=? AND a.status='allocated'").bind(clientId,orderId).first().catch(()=>null);
  return legacy?[legacy]:[];
}

async function ensureOrderUnitAssignments(env,{clientId,orderId,actor='system'}){
  const allocations=await stockAllocations(env,clientId,orderId);let assigned=0;
  for(const a of allocations){
    const batchState=await env.DB.prepare('SELECT i.initial_qty,i.remaining_qty,b.created_at batch_created_at,b.name batch_name FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.id=? AND i.client_id=?').bind(a.batch_item_id,clientId).first();
    await reconcileBatchItem(env,{id:a.batch_item_id,batch_id:a.batch_id,client_id:a.client_id,store_id:a.store_id,product_id:a.product_id,variant_id:a.variant_id,product_name:a.product_name,initial_qty:batchState?.initial_qty||0,remaining_qty:batchState?.remaining_qty,batch_name:batchState?.batch_name||a.batch_name,batch_created_at:batchState?.batch_created_at},{actor});
    const needed=Math.max(0,Math.floor(num(a.qty))),existing=num((await env.DB.prepare('SELECT COUNT(*) n FROM order_unit_allocations WHERE client_id=? AND order_id=? AND stock_allocation_id=?').bind(clientId,orderId,a.id||a.stock_allocation_id||orderId).first())?.n),left=needed-existing;if(left<=0)continue;
    const {results:units=[]}=await env.DB.prepare("SELECT * FROM inventory_units WHERE client_id=? AND batch_item_id=? AND status IN ('legacy_outbound','in_stock','returned_in_stock') AND current_order_id IS NULL ORDER BY CASE status WHEN 'legacy_outbound' THEN 0 ELSE 1 END,received_at,created_at,id LIMIT ?").bind(clientId,a.batch_item_id,left).all();
    if(units.length<left)fail(`لا توجد أكواد قطع كافية لتغطية أوردر ${orderId}. المطلوب ${left} والمتاح ${units.length}.`,409,'UNIT_TRACKING_COVERAGE_MISMATCH');
    for(const unit of units){
      const at=stamp(),allocId=rid('OUA');await env.DB.prepare(`INSERT INTO order_unit_allocations (id,client_id,store_id,order_id,order_item_id,stock_allocation_id,unit_id,unit_code,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id,unit_id) DO UPDATE SET stock_allocation_id=excluded.stock_allocation_id,status='reserved',updated_at=excluded.updated_at,released_at=NULL`).bind(allocId,clientId,a.store_id||null,orderId,a.order_item_id||null,a.id||a.stock_allocation_id||orderId,unit.id,unit.unit_code,'reserved',at,at).run();
      await setStatus(env,unit,'reserved',{orderId,eventType:'reserved_for_order',note:`تم حجز القطعة للأوردر ${orderId}`,source:'fifo_confirmation',actor,metadata:{stockAllocationId:a.id||null,batchId:a.batch_id,batchName:a.batch_name||''}});assigned++;
    }
  }
  return assigned;
}

export async function syncOrderUnitTracking(env,{clientId,orderId,actor='system',source='order_lifecycle'}={}){
  await ensureInventoryUnitSchema(env);
  const order=await env.DB.prepare('SELECT id,client_id,store_id,state,awb,return_type,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!order)return {ok:false,reason:'order_not_found'};
  if(HOLDING.has(clean(order.state))||SHIPPED.has(clean(order.state))||DELIVERED.has(clean(order.state)))await ensureOrderUnitAssignments(env,{clientId,orderId,actor});
  const {results:rows=[]}=await env.DB.prepare('SELECT u.*,a.id allocation_id,a.status allocation_status FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id AND u.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? ORDER BY a.created_at,a.id').bind(clientId,orderId).all();
  let target=null,eventType='order_state_synced',note='';
  if(HOLDING.has(order.state)){target='reserved';eventType='reserved_for_order';note='القطعة محجوزة للأوردر بعد التأكيد';}
  else if(SHIPPED.has(order.state)){target='shipped';eventType='handed_to_shipping';note=order.awb?`تم تسليم القطعة للشحن — AWB ${order.awb}`:'تم تسليم القطعة للشحن';}
  else if(DELIVERED.has(order.state)){target='delivered';eventType='delivered_to_customer';note='تم تسليم القطعة للعميل';}
  else if(order.state==='returned'){target='returned_pending_inspection';eventType='return_received_pending_inspection';note='تم استلام المرتجع وهو في انتظار الفحص؛ لم يعد متاحًا للبيع بعد';}
  else if(RELEASED.has(order.state)){target='in_stock';eventType='reservation_released';note='تم فك حجز القطعة وإعادتها للمخزون';}
  if(!target)return {ok:true,orderId,state:order.state,units:rows.length,changed:0};
  let changed=0;for(const row of rows){
    if(order.state==='returned'&&(['returned_in_stock','quarantined','damaged'].includes(row.status)))continue;
    const before=row.status;await setStatus(env,row,target,{orderId,eventType,note,source,actor,metadata:{orderState:order.state,awb:order.awb||null,returnType:order.return_type||null}});if(before!==target)changed++;await env.DB.prepare('UPDATE order_unit_allocations SET status=?,updated_at=?,released_at=? WHERE id=?').bind(target==='returned_pending_inspection'?'return_pending':target==='returned_in_stock'?'returned':target==='in_stock'?'released':target,stamp(),['returned_in_stock','in_stock'].includes(target)?stamp():null,row.allocation_id).run();
  }
  if(order.awb){
    await env.DB.prepare("UPDATE inventory_scan_sessions SET awb=COALESCE(NULLIF(awb,''),?),updated_at=? WHERE client_id=? AND order_id=?").bind(order.awb,stamp(),clientId,orderId).run().catch(()=>{});
    await env.DB.prepare("UPDATE inventory_scan_events SET awb=COALESCE(NULLIF(awb,''),?) WHERE client_id=? AND order_id=?").bind(order.awb,clientId,orderId).run().catch(()=>{});
  }
  return {ok:true,orderId,state:order.state,units:rows.length,changed};
}

export async function reconcileTrackedOrderLifecycles(env,{clientId=null,limit=500,actor='system'}={}){
  await ensureInventoryUnitSchema(env);
  const cap=Math.max(1,Math.min(2000,Number(limit)||500)),seen=new Map(),add=rows=>{for(const row of rows||[]){if(!row?.client_id||!row?.order_id)continue;if(clientId&&String(row.client_id)!==String(clientId))continue;seen.set(`${row.client_id}:${row.order_id}`,row);}};
  const own=await env.DB.prepare(`SELECT DISTINCT client_id,order_id FROM order_unit_allocations ${clientId?'WHERE client_id=?':''} ORDER BY updated_at DESC LIMIT ?`).bind(...(clientId?[clientId,cap]:[cap])).all().catch(()=>({results:[]}));
  add(own.results);
  const modern=await env.DB.prepare(`SELECT DISTINCT a.client_id,a.order_id FROM order_item_stock_allocations a JOIN orders o ON o.id=a.order_id AND o.client_id=a.client_id WHERE a.status='allocated' ${clientId?'AND a.client_id=?':''} ORDER BY a.created_at DESC LIMIT ?`).bind(...(clientId?[clientId,cap]:[cap])).all().catch(()=>({results:[]}));
  add(modern.results);
  const legacy=await env.DB.prepare(`SELECT DISTINCT a.client_id,a.order_id FROM order_stock_allocations a JOIN orders o ON o.id=a.order_id AND o.client_id=a.client_id WHERE a.status='allocated' ${clientId?'AND a.client_id=?':''} ORDER BY a.created_at DESC LIMIT ?`).bind(...(clientId?[clientId,cap]:[cap])).all().catch(()=>({results:[]}));
  add(legacy.results);
  const rows=[...seen.values()].slice(0,cap),outcomes=[];
  for(const row of rows){
    try{outcomes.push(await syncOrderUnitTracking(env,{clientId:row.client_id,orderId:row.order_id,actor,source:'lifecycle_reconcile'}));}
    catch(error){outcomes.push({ok:false,clientId:row.client_id,orderId:row.order_id,error:String(error?.message||error)});}
  }
  return {ok:true,checked:rows.length,changed:outcomes.reduce((sum,x)=>sum+num(x?.changed),0),outcomes};
}

export async function reconcileAllClientsUnitCoverage(env,{limit=500,actor='scheduled'}={}){
  await ensureInventoryUnitSchema(env);
  const {results=[]}=await env.DB.prepare('SELECT DISTINCT client_id FROM products WHERE client_id IS NOT NULL ORDER BY client_id LIMIT ?').bind(Math.max(1,Math.min(2000,Number(limit)||500))).all();
  const outcomes=[];
  for(const row of results){
    try{outcomes.push({clientId:row.client_id,...await reconcileAllUnitCoverage(env,{clientId:row.client_id,actor})});}
    catch(error){outcomes.push({clientId:row.client_id,ok:false,error:String(error?.message||error)});}
  }
  return {ok:true,checked:results.length,created:outcomes.reduce((sum,x)=>sum+num(x?.created),0),outcomes};
}

async function retireUnits(env,{clientId,storeId,productId,variantId=null,qty,actor='system',note='تسوية مخزون سالبة'}){
  const count=Math.max(0,Math.floor(qty));if(!count)return 0;await reconcileEntityStock(env,{clientId,storeId,productId,variantId,actor});
  const {results=[]}=await env.DB.prepare("SELECT * FROM inventory_units WHERE client_id=? AND store_id IS ? AND product_id=? AND COALESCE(variant_id,'')=COALESCE(?,'') AND status IN ('in_stock','returned_in_stock') AND current_order_id IS NULL ORDER BY received_at,created_at,id LIMIT ?").bind(clientId,storeId||null,productId,variantId,count).all();
  if(results.length<count)fail('لا توجد قطع متاحة كافية لتنفيذ التسوية السالبة',409,'UNIT_TRACKING_NEGATIVE_STOCK_MISMATCH');
  for(const unit of results)await setStatus(env,unit,'retired',{eventType:'manual_stock_out',note,source:'stock_adjust',actor});
  return results.length;
}
async function createAdjustmentUnits(env,{clientId,storeId,productId,variantId=null,qty,actor='system',note='',stockDate=null}){
  const p=await productInfo(env,{clientId,productId,variantId});let created=0;for(let i=0;i<Math.floor(qty);i++){await createUnit(env,{clientId,storeId,productId,variantId,productName:p?.product_name||'',sku:p?.sku||'',source:'stock_adjust',receivedAt:stockDate?stockDate+'T12:00:00Z':stamp(),createdBy:actor,metadata:{note}});created++;}return created;
}

function mutationPath(path,method){
  if(method==='POST'&&path==='/api/inventory/stock-adjust')return 'stock_adjust';
  if(method==='POST'&&path==='/api/inventory/batches')return 'batch_create';
  if(method==='POST'&&path==='/api/products')return 'product_create';
  if(method==='POST'&&path==='/api/commerce/product-import')return 'product_import';
  if(method==='PATCH'&&/^\/api\/products\/[^/]+$/.test(path))return 'product_edit';
  if(method==='POST'&&/^\/api\/purchase-orders\/[^/]+\/receive$/.test(path))return 'purchase_receive';
  return null;
}

async function afterMutation(env,{kind,body,responseData,clientId,storeId,actor}){
  if(kind==='batch_create'){
    const batchId=clean(responseData?.id||responseData?.batch?.id);if(batchId)return reconcileBatch(env,{clientId,batchId,actor});
  }
  if(kind==='stock_adjust'){
    const productId=clean(body.productId||body.product_id),variantId=clean(body.variantId||body.variant_id)||null,delta=Number(body.delta);if(!productId||!Number.isFinite(delta)||delta===0)return null;
    const p=await productInfo(env,{clientId,productId,variantId});if(!p)fail('المنتج غير موجود بعد تعديل المخزون',404,'TRACKING_PRODUCT_NOT_FOUND');
    const target=Math.max(0,Math.floor(num(p.stock))),before=await availableCount(env,{clientId,storeId,productId,variantId});
    let created=0,retired=0;
    if(before<target)created=await createAdjustmentUnits(env,{clientId,storeId,productId,variantId,qty:target-before,actor,note:body.note||'',stockDate:body.stockDate||body.stock_date||null});
    else if(before>target)retired=await retireUnits(env,{clientId,storeId,productId,variantId,qty:before-target,actor,note:body.note||'تسوية مخزون سالبة'});
    const after=await availableCount(env,{clientId,storeId,productId,variantId});
    if(after!==target)fail(`رصيد المنتج ${target} لكن عدد القطع المكودة المتاحة ${after}`,409,'UNIT_TRACKING_STOCK_COVERAGE_MISMATCH');
    return {created,retired,target,available:after};
  }
  if(kind==='product_create'||kind==='product_edit'){
    const productId=clean(responseData?.product?.id||responseData?.id);if(!productId)return null;
    const product=await env.DB.prepare('SELECT id,store_id FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();if(!product)return null;
    const {results:variants=[]}=await env.DB.prepare('SELECT id FROM product_variants WHERE product_id=? AND client_id=? AND active=1').bind(productId,clientId).all();
    let created=0;if(variants.length){for(const v of variants)created+=(await reconcileEntityStock(env,{clientId,storeId:product.store_id||storeId,productId,variantId:v.id,actor,source:'product_stock'})).created;}else created+=(await reconcileEntityStock(env,{clientId,storeId:product.store_id||storeId,productId,actor,source:'product_stock'})).created;return {created};
  }
  if(kind==='product_import')return reconcileAllUnitCoverage(env,{clientId,storeId,actor:'product-import:'+actor});
  if(kind==='purchase_receive')return reconcileAllUnitCoverage(env,{clientId,storeId,actor});
  return null;
}

async function unitDetails(env,{clientId,code}){
  let unit=await env.DB.prepare('SELECT u.*,p.code product_tracking_code,b.name batch_name FROM inventory_units u LEFT JOIN product_tracking_codes p ON p.client_id=u.client_id AND p.product_id=u.product_id AND COALESCE(p.variant_id,\'\')=COALESCE(u.variant_id,\'\') LEFT JOIN inventory_batches b ON b.id=u.batch_id WHERE u.client_id=? AND u.unit_code=?').bind(clientId,code).first();if(!unit)fail('كود القطعة غير موجود',404,'UNIT_NOT_FOUND');
  // A scan is also a freshness boundary: if the carrier/order changed in the
  // background, synchronize the linked order before returning the history.
  const linkedOrder=clean(unit.current_order_id||unit.last_order_id);
  if(linkedOrder){
    await syncOrderUnitTracking(env,{clientId,orderId:linkedOrder,actor:'scan-reconcile',source:'qr_lookup'}).catch(()=>{});
    unit=await env.DB.prepare('SELECT u.*,p.code product_tracking_code,b.name batch_name FROM inventory_units u LEFT JOIN product_tracking_codes p ON p.client_id=u.client_id AND p.product_id=u.product_id AND COALESCE(p.variant_id,\'\')=COALESCE(u.variant_id,\'\') LEFT JOIN inventory_batches b ON b.id=u.batch_id WHERE u.client_id=? AND u.unit_code=?').bind(clientId,code).first();
  }
  const [{results:events=[]},{results:allocations=[]}]=await Promise.all([
    env.DB.prepare('SELECT id,event_type,from_status,to_status,order_id,note,source,actor,metadata_json,created_at FROM inventory_unit_events WHERE client_id=? AND unit_id=? ORDER BY created_at DESC,id DESC LIMIT 500').bind(clientId,unit.id).all(),
    env.DB.prepare('SELECT id,order_id,status,created_at,updated_at,released_at FROM order_unit_allocations WHERE client_id=? AND unit_id=? ORDER BY created_at DESC').bind(clientId,unit.id).all()
  ]);
  const orderIds=[...new Set(allocations.map(x=>x.order_id).filter(Boolean))];let orders=[];
  if(orderIds.length){const r=await env.DB.prepare(`SELECT id,ref,state,awb,date,created_at,return_type FROM orders WHERE client_id=? AND id IN (${orderIds.map(()=>'?').join(',')})`).bind(clientId,...orderIds).all();orders=r.results||[];}
  return {unit:{...unit,metadata:JSON.parse(unit.metadata_json||'{}'),qrValue:qrValue(unit.unit_code),barcodeValue:barcodeValue(unit.unit_code)},events:events.map(x=>({...x,metadata:(()=>{try{return JSON.parse(x.metadata_json||'{}')}catch{return {}}})()})),allocations,orders};
}


function orderScanCode(value){
  let v=clean(value,1000);
  try{const u=new URL(v);v=u.searchParams.get('order')||u.searchParams.get('awb')||u.searchParams.get('ref')||u.searchParams.get('code')||v;}catch{}
  return clean(v.replace(/^KUN:(?:ORDER|AWB):/i,''),180);
}
function scanContext(value){const v=clean(value,40).toLowerCase();if(!SCAN_CONTEXTS.has(v))fail('سياق المسح غير صحيح',400,'SCAN_CONTEXT_INVALID');return v;}
async function findOrderByScan(env,{clientId,code}){
  const raw=orderScanCode(code);if(!raw)fail('امسح كود الطلب أو البوليصة',400,'ORDER_SCAN_CODE_REQUIRED');
  const row=await env.DB.prepare("SELECT id,client_id,store_id,ref,state,awb,product,qty,date,return_type,restocked FROM orders WHERE client_id=? AND (UPPER(id)=UPPER(?) OR UPPER(COALESCE(ref,''))=UPPER(?) OR UPPER(COALESCE(awb,''))=UPPER(?)) ORDER BY CASE WHEN UPPER(COALESCE(awb,''))=UPPER(?) THEN 0 WHEN UPPER(COALESCE(ref,''))=UPPER(?) THEN 1 ELSE 2 END LIMIT 1").bind(clientId,raw,raw,raw,raw,raw).first();
  if(!row)fail('لم يتم العثور على طلب أو بوليصة بهذا الكود',404,'ORDER_SCAN_NOT_FOUND');
  const matchedBy=String(row.awb||'').toUpperCase()===raw.toUpperCase()?'awb':String(row.ref||'').toUpperCase()===raw.toUpperCase()?'ref':'order_id';
  return {row,raw,matchedBy};
}
async function orderUnits(env,{clientId,orderId,actor='system'}){
  const order=await env.DB.prepare('SELECT id,client_id,store_id,ref,state,awb,product,qty,return_type,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!order)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(['confirmed','preparing','shipped','signed','collected','returned'].includes(clean(order.state)))await ensureOrderUnitAssignments(env,{clientId,orderId,actor});
  const {results=[]}=await env.DB.prepare("SELECT a.id allocation_id,a.order_item_id,a.stock_allocation_id,a.status allocation_status,u.* FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id AND u.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? ORDER BY a.created_at,a.id").bind(clientId,orderId).all();
  return {order,units:results};
}
async function sessionFor(env,{clientId,orderId,context,actor='system',actorUserId=null,deviceId='',orderScanCodeValue=''}){
  const ctx=scanContext(context),loaded=await orderUnits(env,{clientId,orderId,actor}),expected=loaded.units.length;
  let session=await env.DB.prepare("SELECT * FROM inventory_scan_sessions WHERE client_id=? AND order_id=? AND scan_context=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1").bind(clientId,orderId,ctx).first();
  if(!session||Number(session.expected_units)!==expected){
    const at=stamp(),id=rid('SCN');
    await env.DB.prepare("INSERT INTO inventory_scan_sessions (id,client_id,store_id,order_id,scan_context,status,order_scan_code,expected_units,scanned_units,awb,actor,actor_user_id,device_id,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,0,?,?,?,?,?,?)").bind(id,clientId,loaded.order.store_id||null,orderId,ctx,clean(orderScanCodeValue,180)||null,expected,loaded.order.awb||null,actor,actorUserId||null,clean(deviceId,180)||null,at,at).run();
    session=await env.DB.prepare('SELECT * FROM inventory_scan_sessions WHERE id=?').bind(id).first();
  }else if(orderScanCodeValue||deviceId){
    await env.DB.prepare('UPDATE inventory_scan_sessions SET order_scan_code=COALESCE(?,order_scan_code),device_id=COALESCE(?,device_id),actor=?,actor_user_id=COALESCE(?,actor_user_id),updated_at=? WHERE id=?').bind(clean(orderScanCodeValue,180)||null,clean(deviceId,180)||null,actor,actorUserId||null,stamp(),session.id).run();
    session={...session,order_scan_code:clean(orderScanCodeValue,180)||session.order_scan_code,device_id:clean(deviceId,180)||session.device_id};
  }
  return {session,order:loaded.order,units:loaded.units};
}
async function scanEvent(env,{session,order,unit=null,kind,result,actor='system',actorUserId=null,deviceId='',metadata={}}){
  const id=rid('SEV'),at=stamp();
  try{
    await env.DB.prepare('INSERT INTO inventory_scan_events (id,session_id,client_id,store_id,order_id,unit_id,unit_code,scan_context,scan_kind,result,awb,actor,actor_user_id,device_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,session?.id||null,order.client_id,order.store_id||null,order.id,unit?.id||null,unit?.unit_code||null,session?.scan_context||clean(metadata.context)||'packing',kind,result,order.awb||session?.awb||null,actor,actorUserId||null,clean(deviceId,180)||null,JSON.stringify(metadata||{}),at).run();
  }catch(error){
    if(!(result==='accepted'&&/UNIQUE/i.test(String(error?.message||error))))throw error;
  }
  return id;
}
async function scanSnapshot(env,{clientId,orderId,context,actor='system'}){
  const ctx=scanContext(context),state=await sessionFor(env,{clientId,orderId,context:ctx,actor}),session=state.session,order=state.order,units=state.units;
  const {results:accepted=[]}=await env.DB.prepare("SELECT DISTINCT unit_id FROM inventory_scan_events WHERE session_id=? AND scan_kind='unit' AND result='accepted' AND unit_id IS NOT NULL").bind(session.id).all();
  const scanned=new Set(accepted.map(x=>String(x.unit_id))),count=scanned.size,expected=units.length,complete=expected>0&&count===expected;
  if(Number(session.scanned_units)!==count||session.status!==(complete?'completed':'open')){
    await env.DB.prepare("UPDATE inventory_scan_sessions SET scanned_units=?,status=?,completed_at=?,awb=COALESCE(NULLIF(awb,''),?),updated_at=? WHERE id=?").bind(count,complete?'completed':'open',complete?(session.completed_at||stamp()):null,order.awb||null,stamp(),session.id).run();
  }
  return {session:{...session,scanned_units:count,status:complete?'completed':'open',awb:order.awb||session.awb||null},order:{id:order.id,ref:order.ref||null,state:order.state,awb:order.awb||null,product:order.product||'',qty:num(order.qty),returnType:order.return_type||null},expectedCount:expected,scannedCount:count,remainingCount:Math.max(0,expected-count),complete,units:units.map(u=>({unitCode:u.unit_code,productName:u.product_name||'',sku:u.sku||'',productId:u.product_id,variantId:u.variant_id||null,batchId:u.batch_id||null,batchItemId:u.batch_item_id||null,status:u.status,scanned:scanned.has(String(u.id))}))};
}
async function openOrderScan(env,{clientId,code,context,actor='system',actorUserId=null,deviceId=''}){
  const ctx=scanContext(context),found=await findOrderByScan(env,{clientId,code}),order=found.row;
  if(ctx==='packing'&&!['confirmed','preparing'].includes(clean(order.state)))fail('تجهيز القطع بالمسح متاح للأوردر الموجود في قسم الطباعة قبل الشحن',409,'PACKING_ORDER_STATE_INVALID');
  if(ctx==='dispatch'&&(clean(order.state)!=='shipped'||!clean(order.awb)))fail('مسح التسليم لشركة الشحن متاح بعد إنشاء AWB والبوليصة الرسمية',409,'DISPATCH_ORDER_STATE_INVALID');
  const state=await sessionFor(env,{clientId,orderId:order.id,context:ctx,actor,actorUserId,deviceId,orderScanCodeValue:found.raw});
  await scanEvent(env,{session:state.session,order,kind:found.matchedBy==='awb'?'awb':'order',result:'accepted',actor,actorUserId,deviceId,metadata:{matchedBy:found.matchedBy,scannedCode:found.raw,context:ctx}});
  return {...await scanSnapshot(env,{clientId,orderId:order.id,context:ctx,actor}),matchedBy:found.matchedBy};
}
async function scanUnitForOrder(env,{clientId,orderId,code,context,actor='system',actorUserId=null,deviceId=''}){
  const ctx=scanContext(context),state=await sessionFor(env,{clientId,orderId,context:ctx,actor,actorUserId,deviceId}),session=state.session,order=state.order;
  if(ctx==='packing'&&!['confirmed','preparing'].includes(clean(order.state)))fail('الأوردر خرج من مرحلة التجهيز',409,'PACKING_ORDER_STATE_INVALID');
  if(ctx==='dispatch'&&(clean(order.state)!=='shipped'||!clean(order.awb)))fail('لا يمكن تأكيد التسليم للشحن قبل إنشاء AWB',409,'DISPATCH_ORDER_STATE_INVALID');
  const unitCode=scanCode(code);if(!unitCode)fail('امسح باركود القطعة',400,'UNIT_CODE_REQUIRED');
  let unit=await env.DB.prepare('SELECT * FROM inventory_units WHERE client_id=? AND unit_code=?').bind(clientId,unitCode).first();
  if(!unit)fail('كود القطعة غير موجود',404,'UNIT_NOT_FOUND');
  const duplicate=await env.DB.prepare("SELECT id FROM inventory_scan_events WHERE session_id=? AND unit_id=? AND scan_kind='unit' AND result='accepted' LIMIT 1").bind(session.id,unit.id).first();
  if(duplicate)return {...await scanSnapshot(env,{clientId,orderId,context:ctx,actor}),duplicate:true,acceptedUnit:unit.unit_code};
  let allocation=await env.DB.prepare('SELECT * FROM order_unit_allocations WHERE client_id=? AND order_id=? AND unit_id=? LIMIT 1').bind(clientId,orderId,unit.id).first();
  if(!allocation&&ctx==='packing'){
    if(unit.current_order_id&&String(unit.current_order_id)!==String(orderId)){
      await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'reserved_for_other_order'}});
      fail('القطعة محجوزة لأوردر آخر',409,'UNIT_RESERVED_FOR_OTHER_ORDER');
    }
    if(!AVAILABLE.has(unit.status)||unit.current_order_id){
      await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'unit_not_available',status:unit.status}});
      fail('القطعة غير متاحة للتجهيز',409,'UNIT_NOT_AVAILABLE_FOR_PACKING');
    }
    const snap=await scanSnapshot(env,{clientId,orderId,context:ctx,actor}),acceptedCodes=new Set(snap.units.filter(x=>x.scanned).map(x=>x.unitCode));
    const candidate=state.units.find(x=>!acceptedCodes.has(x.unit_code)&&String(x.product_id)===String(unit.product_id)&&String(x.variant_id||'')===String(unit.variant_id||'')&&String(x.batch_item_id||'')===String(unit.batch_item_id||''));
    if(!candidate){
      await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'wrong_product_variant_or_batch'}});
      fail('هذه القطعة لا تطابق القطع المطلوبة للأوردر أو دفعة FIFO المخصصة له',409,'UNIT_ORDER_MISMATCH');
    }
    await setStatus(env,candidate,'in_stock',{orderId,eventType:'packing_scan_placeholder_released',note:'تم استبدال القطعة المحجوزة بقطعة ممسوحة من نفس المنتج والدفعة',source:'packing_scan',actor,metadata:{sessionId:session.id,replacedBy:unit.unit_code,deviceId}});
    await env.DB.prepare('UPDATE order_unit_allocations SET unit_id=?,unit_code=?,updated_at=? WHERE id=?').bind(unit.id,unit.unit_code,stamp(),candidate.allocation_id).run();
    unit=await setStatus(env,unit,'reserved',{orderId,eventType:'packing_scan_claimed',note:'تم ربط القطعة فعليًا بالأوردر '+orderId+' عن طريق المسح',source:'packing_scan',actor,metadata:{sessionId:session.id,replacedUnit:candidate.unit_code,deviceId}});
    allocation={...candidate,unit_id:unit.id,unit_code:unit.unit_code};
  }
  if(!allocation){
    await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'not_allocated_to_order'}});
    fail('هذه القطعة ليست ضمن القطع التي تم تجهيزها لهذا الأوردر',409,'UNIT_NOT_IN_ORDER');
  }
  await scanEvent(env,{session,order,unit,kind:'unit',result:'accepted',actor,actorUserId,deviceId,metadata:{allocationId:allocation.id,stockAllocationId:allocation.stock_allocation_id||null,context:ctx}});
  await event(env,unit,{eventType:ctx==='packing'?'picked_and_packed_scan':'dispatch_scan_verified',fromStatus:unit.status,toStatus:unit.status,orderId,source:ctx+'_scan',actor,note:ctx==='packing'?'تم التحقق من القطعة بالمسح أثناء التجهيز والتعبئة':'تم التحقق من القطعة بالمسح عند التسليم لشركة الشحن',metadata:{scanSessionId:session.id,deviceId,awb:order.awb||null}});
  return {...await scanSnapshot(env,{clientId,orderId,context:ctx,actor}),acceptedUnit:unit.unit_code};
}
export async function assertOrderScanReady(env,{clientId,orderId,actor='system'}={}){
  const loaded=await orderUnits(env,{clientId,orderId,actor});
  if(!loaded.units.length)return {ok:true,required:false,expectedCount:0,scannedCount:0,complete:true};
  const snap=await scanSnapshot(env,{clientId,orderId,context:'packing',actor});
  if(!snap.complete)fail('لا يمكن إنشاء البوليصة قبل مسح كل قطع الأوردر. تم مسح '+snap.scannedCount+' من '+snap.expectedCount+'.',409,'UNIT_PACKING_SCAN_REQUIRED');
  return {ok:true,required:true,...snap};
}
async function closeAllocationIfInspected(env,{clientId,orderId,stockAllocationId}){
  if(!stockAllocationId)return;
  const row=await env.DB.prepare("SELECT COUNT(*) n FROM order_unit_allocations WHERE client_id=? AND order_id=? AND stock_allocation_id=? AND status IN ('reserved','shipped','delivered','return_pending')").bind(clientId,orderId,stockAllocationId).first();
  if(num(row?.n)===0){
    await env.DB.prepare("UPDATE order_item_stock_allocations SET status='returned',updated_at=? WHERE id=? AND client_id=?").bind(stamp(),stockAllocationId,clientId).run().catch(()=>{});
    await env.DB.prepare("UPDATE order_stock_allocations SET status='returned',updated_at=? WHERE id=? AND client_id=?").bind(stamp(),stockAllocationId,clientId).run().catch(()=>{});
  }
}
async function dispositionReturnedUnit(env,{clientId,code,disposition,reason='',actor='system',actorUserId=null,deviceId=''}){
  const unitCode=scanCode(code);if(!unitCode)fail('امسح باركود القطعة المرتجعة',400,'UNIT_CODE_REQUIRED');
  let unit=await env.DB.prepare('SELECT * FROM inventory_units WHERE client_id=? AND unit_code=?').bind(clientId,unitCode).first();if(!unit)fail('كود القطعة غير موجود',404,'UNIT_NOT_FOUND');
  const orderId=clean(unit.last_order_id||unit.current_order_id),order=orderId?await env.DB.prepare('SELECT id,client_id,store_id,ref,state,awb,return_type,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first():null;
  if(!order||clean(order.state)!=='returned')fail('القطعة ليست مرتبطة بأوردر مرتجع حاليًا',409,'UNIT_RETURN_ORDER_REQUIRED');
  if(!['returned_pending_inspection','quarantined','damaged','returned_in_stock'].includes(unit.status)){
    await syncOrderUnitTracking(env,{clientId,orderId,actor,source:'return_scan'});
    unit=await env.DB.prepare('SELECT * FROM inventory_units WHERE id=?').bind(unit.id).first();
  }
  const action=clean(disposition,40).toLowerCase();if(!['restock','quarantine','damaged'].includes(action))fail('اختر إرجاع للمخزون أو حجر للفحص أو هالك',400,'RETURN_DISPOSITION_INVALID');
  if(action==='restock'&&unit.status==='returned_in_stock')return {ok:true,idempotent:true,disposition:'restock',...await unitDetails(env,{clientId,code:unit.unit_code})};
  if(action==='damaged'&&unit.status==='damaged')return {ok:true,idempotent:true,disposition:'damaged',...await unitDetails(env,{clientId,code:unit.unit_code})};
  if(action==='quarantine'&&unit.status==='quarantined')return {ok:true,idempotent:true,disposition:'quarantine',...await unitDetails(env,{clientId,code:unit.unit_code})};
  const allocation=await env.DB.prepare('SELECT * FROM order_unit_allocations WHERE client_id=? AND order_id=? AND unit_id=? ORDER BY created_at DESC LIMIT 1').bind(clientId,orderId,unit.id).first();
  if(action==='restock'){
    const p=await productInfo(env,{clientId,productId:unit.product_id,variantId:unit.variant_id||null});if(!p)fail('تعذر العثور على المنتج لإرجاع القطعة للمخزون',409,'RETURN_PRODUCT_NOT_FOUND');
    if(unit.batch_item_id){
      await env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=MIN(initial_qty,COALESCE(remaining_qty,0)+1) WHERE id=? AND client_id=?').bind(unit.batch_item_id,clientId).run();
      if(unit.batch_id)await env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=? AND client_id=?").bind(unit.batch_id,clientId).run().catch(()=>{});
    }
    let newStock=0;if(unit.variant_id){await env.DB.prepare('UPDATE product_variants SET stock=COALESCE(stock,0)+1 WHERE id=? AND client_id=?').bind(unit.variant_id,clientId).run();newStock=num((await env.DB.prepare('SELECT stock FROM product_variants WHERE id=? AND client_id=?').bind(unit.variant_id,clientId).first())?.stock);}
    else{await env.DB.prepare('UPDATE products SET stock=COALESCE(stock,0)+1 WHERE id=? AND client_id=?').bind(unit.product_id,clientId).run();newStock=num((await env.DB.prepare('SELECT stock FROM products WHERE id=? AND client_id=?').bind(unit.product_id,clientId).first())?.stock);}
    const stockNote='مرتجع مفحوص — Unit '+unit.unit_code+' — Order '+orderId+(reason?' — '+clean(reason,300):'');
    await env.DB.prepare('INSERT INTO stock_log (id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,supplier_id,supplier_name,stock_date,batch_id,batch_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(rid('STK'),clientId,unit.store_id||null,unit.product_id,unit.variant_id||null,unit.product_name||p.product_name||'',1,newStock,stockNote,null,null,stamp().slice(0,10),unit.batch_id||null,null,stamp(),actor).run().catch(()=>{});
    unit=await setStatus(env,unit,'returned_in_stock',{orderId,eventType:'return_restocked_after_inspection',note:'تم فحص المرتجع وإرجاع القطعة للمخزون كقطعة صالحة للبيع',source:'return_scan',actor,metadata:{deviceId,reason:clean(reason,600),awb:order.awb||null}});
    if(allocation)await env.DB.prepare("UPDATE order_unit_allocations SET status='returned',updated_at=?,released_at=? WHERE id=?").bind(stamp(),stamp(),allocation.id).run();
  }else{
    const status=action==='quarantine'?'quarantined':'damaged',eventType=action==='quarantine'?'return_quarantined':'return_marked_damaged',note=action==='quarantine'?'تم وضع القطعة المرتجعة في الحجر لحين فحص إضافي':'تم تصنيف القطعة المرتجعة كهالك / تالفة';
    unit=await setStatus(env,unit,status,{orderId,eventType,note,source:'return_scan',actor,metadata:{deviceId,reason:clean(reason,600),awb:order.awb||null}});
    if(allocation)await env.DB.prepare('UPDATE order_unit_allocations SET status=?,updated_at=?,released_at=? WHERE id=?').bind(status,stamp(),stamp(),allocation.id).run();
  }
  await scanEvent(env,{session:{id:null,scan_context:'returns',awb:order.awb||null},order,unit,kind:'return_disposition',result:'accepted',actor,actorUserId,deviceId,metadata:{disposition:action,reason:clean(reason,600)}});
  if(allocation)await closeAllocationIfInspected(env,{clientId,orderId,stockAllocationId:allocation.stock_allocation_id});
  const check=await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN u.status='returned_in_stock' THEN 1 ELSE 0 END) restocked FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id WHERE a.client_id=? AND a.order_id=?").bind(clientId,orderId).first();
  const allRestocked=num(check?.total)>0&&num(check?.total)===num(check?.restocked);await env.DB.prepare('UPDATE orders SET restocked=? WHERE id=? AND client_id=?').bind(allRestocked?1:0,orderId,clientId).run().catch(()=>{});
  return {ok:true,disposition:action,...await unitDetails(env,{clientId,code:unit.unit_code})};
}
async function pendingReturns(env,{clientId,storeId=null,limit=300}){
  const where=["u.client_id=?","u.status IN ('returned_pending_inspection','quarantined','damaged')"],binds=[clientId];if(storeId){where.push('u.store_id=?');binds.push(storeId);}binds.push(Math.max(1,Math.min(1000,Number(limit)||300)));
  const sql="SELECT u.unit_code,u.product_name,u.sku,u.status,u.returned_at,u.last_order_id,o.ref order_ref,o.awb,o.return_type FROM inventory_units u LEFT JOIN orders o ON o.id=u.last_order_id AND o.client_id=u.client_id WHERE "+where.join(' AND ')+" ORDER BY COALESCE(u.returned_at,u.updated_at) DESC LIMIT ?";
  const {results=[]}=await env.DB.prepare(sql).bind(...binds).all();
  return results;
}

function lifecycleOrderId(path){
  const patterns=[
    /^\/api\/customer-service\/orders\/([^/]+)\/state$/,
    /^\/api\/jt\/shipments\/([^/]+)\/print$/,
    /^\/api\/post-shipping\/orders\/([^/]+)\/(?:delivered|shipping-sheet-apply|shipping-sheet-retry)$/,
    /^\/api\/orders\/([^/]+)$/
  ];
  for(const p of patterns){const m=path.match(p);if(m)return decodeURIComponent(m[1]);}
  return null;
}

export async function syncInventoryTrackingAfterResponse({request,response,env,actor='system'}){
  if(!response?.ok)return response;
  const url=new URL(request.url),orderId=lifecycleOrderId(url.pathname);if(!orderId)return response;
  try{
    await ensureInventoryUnitSchema(env);
    const row=await env.DB.prepare('SELECT client_id FROM orders WHERE id=?').bind(orderId).first();if(row?.client_id)await syncOrderUnitTracking(env,{clientId:row.client_id,orderId,actor,source:url.pathname});
  }catch(error){console.warn('unit tracking lifecycle sync failed',error);}
  return response;
}

export async function handleInventoryUnitTracking({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase(),kind=mutationPath(path,method),isApi=path.startsWith('/api/inventory/unit-tracking');
  if(!kind&&!isApi)return null;
  try{
    await ensureInventoryUnitSchema(env);
    const me=await currentUser(request,env,ctx,delegate),requested=url.searchParams.get('clientId'),clientId=resolveTenant(me,requested||(me.role==='client'?me.clientId:null)),write=method!=='GET';
    // Existing product/stock mutations keep their original permission contract in
    // the delegated route. Tracking-only APIs require Inventory permission here.
    if(isApi){
      const orderScanApi=path.startsWith('/api/inventory/unit-tracking/order-scan');
      if(orderScanApi)requirePermission(me,'orders',write?'update':'read');
      else requirePermission(me,'inventory',write?'update':'read');
    }
    const body=write?await request.clone().json().catch(()=>({})):{};
    const storeId=await scoped(request,env,me,clientId,{write,storeId:body.storeId||body.store_id||null}),actor=actorName(me);

    if(kind){
      if(kind==='stock_adjust'){
        // Reconcile the pre-mutation stock first so a positive delta creates exactly the
        // newly-added units and a negative delta retires exact existing units.
        await reconcileAllUnitCoverage(env,{clientId,storeId,actor});
        if(Number(body.delta)<0){
          const productId=clean(body.productId||body.product_id),variantId=clean(body.variantId||body.variant_id)||null,needed=Math.max(0,Math.floor(Math.abs(Number(body.delta))));
          const have=await availableCount(env,{clientId,storeId,productId,variantId});if(have<needed)fail(`لا توجد أكواد قطع كافية للتسوية. المطلوب ${needed} والمتاح ${have}.`,409,'UNIT_TRACKING_NEGATIVE_STOCK_MISMATCH');
        }
      }
      const response=await delegate.fetch(request,env,ctx);if(!response.ok)return response;
      const data=await response.clone().json().catch(()=>({}));await afterMutation(env,{kind,body,responseData:data,clientId,storeId,actor});return response;
    }


    if(path==='/api/inventory/unit-tracking/order-scan/open'&&method==='POST'){
      const context=scanContext(body.context||body.scanContext||'packing'),code=body.code||body.orderCode||body.awb;
      return json({ok:true,...await openOrderScan(env,{clientId,code,context,actor,actorUserId:me?.uid||me?.id||null,deviceId:body.deviceId||body.device_id||''})});
    }
    if(path==='/api/inventory/unit-tracking/order-scan/status'&&method==='GET'){
      const orderId=clean(url.searchParams.get('orderId')),context=scanContext(url.searchParams.get('context')||'packing');if(!orderId)fail('orderId مطلوب',400,'ORDER_ID_REQUIRED');
      return json({ok:true,...await scanSnapshot(env,{clientId,orderId,context,actor})});
    }
    if(path==='/api/inventory/unit-tracking/order-scan/unit'&&method==='POST'){
      const orderId=clean(body.orderId||body.order_id),context=scanContext(body.context||body.scanContext||'packing');if(!orderId)fail('orderId مطلوب',400,'ORDER_ID_REQUIRED');
      return json({ok:true,...await scanUnitForOrder(env,{clientId,orderId,code:body.code||body.unitCode,context,actor,actorUserId:me?.uid||me?.id||null,deviceId:body.deviceId||body.device_id||''})});
    }
    if(path==='/api/inventory/unit-tracking/returns'&&method==='GET'){
      return json({ok:true,units:await pendingReturns(env,{clientId,storeId,limit:url.searchParams.get('limit')})});
    }
    if(path==='/api/inventory/unit-tracking/returns/disposition'&&method==='POST'){
      return json(await dispositionReturnedUnit(env,{clientId,code:body.code||body.unitCode,disposition:body.disposition,reason:body.reason||'',actor,actorUserId:me?.uid||me?.id||null,deviceId:body.deviceId||body.device_id||''}));
    }
    if(path==='/api/inventory/unit-tracking/summary'&&method==='GET'){
      const reconciled=await reconcileAllUnitCoverage(env,{clientId,storeId,actor});
      const lifecycle=await reconcileTrackedOrderLifecycles(env,{clientId,limit:500,actor});
      const binds=[clientId],storeSql=storeId?' AND store_id=?':'';if(storeId)binds.push(storeId);
      const [counts,products]=await Promise.all([
        env.DB.prepare(`SELECT status,COUNT(*) n FROM inventory_units WHERE client_id=?${storeSql} GROUP BY status ORDER BY status`).bind(...binds).all(),
        env.DB.prepare(`SELECT t.code,t.product_id,t.variant_id,COALESCE(v.name,p.name) item_name,COUNT(u.id) unit_count,SUM(CASE WHEN u.status IN ('in_stock','returned_in_stock') AND u.current_order_id IS NULL THEN 1 ELSE 0 END) available_count FROM product_tracking_codes t JOIN products p ON p.id=t.product_id AND p.client_id=t.client_id LEFT JOIN product_variants v ON v.id=t.variant_id AND v.client_id=t.client_id LEFT JOIN inventory_units u ON u.client_id=t.client_id AND u.product_id=t.product_id AND COALESCE(u.variant_id,'')=COALESCE(t.variant_id,'') WHERE t.client_id=?${storeId?' AND t.store_id=?':''} GROUP BY t.id ORDER BY item_name`).bind(...binds).all()
      ]);
      return json({ok:true,reconciled,lifecycle,counts:counts.results||[],products:products.results||[]});
    }
    if(path==='/api/inventory/unit-tracking/reconcile'&&method==='POST'){
      const coverage=await reconcileAllUnitCoverage(env,{clientId,storeId,actor});
      const lifecycle=await reconcileTrackedOrderLifecycles(env,{clientId,limit:1000,actor});
      return json({ok:true,created:coverage.created||0,coverage,lifecycle});
    }
    if(path==='/api/inventory/unit-tracking/lookup'&&method==='GET'){
      const code=scanCode(url.searchParams.get('code'));if(!code)fail('اكتب أو امسح كود القطعة',400,'UNIT_CODE_REQUIRED');return json({ok:true,...await unitDetails(env,{clientId,code})});
    }
    if(path==='/api/inventory/unit-tracking/units'&&method==='GET'){
      await reconcileAllUnitCoverage(env,{clientId,storeId,actor});const where=['u.client_id=?'],binds=[clientId];if(storeId){where.push('u.store_id=?');binds.push(storeId);}const productId=clean(url.searchParams.get('productId')),status=clean(url.searchParams.get('status')),scope=clean(url.searchParams.get('scope')),q=clean(url.searchParams.get('q'));if(productId){where.push('u.product_id=?');binds.push(productId);}if(status){where.push('u.status=?');binds.push(status);}if(scope==='available')where.push("u.status IN ('in_stock','returned_in_stock') AND u.current_order_id IS NULL");if(scope==='warehouse')where.push("u.status IN ('in_stock','returned_in_stock','reserved','returned_pending_inspection','quarantined','damaged')");if(q){where.push('(u.unit_code LIKE ? OR u.product_name LIKE ? OR u.sku LIKE ?)');binds.push(`%${q}%`,`%${q}%`,`%${q}%`);}const limit=Math.max(1,Math.min(10000,Number(url.searchParams.get('limit'))||200));binds.push(limit);
      const {results=[]}=await env.DB.prepare(`SELECT u.*,t.code product_tracking_code,b.name batch_name FROM inventory_units u LEFT JOIN product_tracking_codes t ON t.client_id=u.client_id AND t.product_id=u.product_id AND COALESCE(t.variant_id,'')=COALESCE(u.variant_id,'') LEFT JOIN inventory_batches b ON b.id=u.batch_id WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT ?`).bind(...binds).all();return json({ok:true,units:results.map(x=>({...x,qrValue:qrValue(x.unit_code),barcodeValue:barcodeValue(x.unit_code)}))});
    }
    if(path==='/api/inventory/unit-tracking/qr'&&method==='GET'){
      const code=scanCode(url.searchParams.get('code'));if(!code)fail('كود القطعة مطلوب',400,'UNIT_CODE_REQUIRED');await unitDetails(env,{clientId,code});const target=qrValue(code),qr=`https://quickchart.io/qr?text=${encodeURIComponent(target)}&size=240&margin=2&ecLevel=M&format=png`;return Response.redirect(qr,302);
    }
    if(path==='/api/inventory/unit-tracking/barcode'&&method==='GET'){
      const code=scanCode(url.searchParams.get('code'));if(!code)fail('كود القطعة مطلوب',400,'UNIT_CODE_REQUIRED');
      await unitDetails(env,{clientId,code});
      const barcodeUrl=new URL('https://quickchart.io/barcode');
      barcodeUrl.searchParams.set('type','code128');
      barcodeUrl.searchParams.set('text',barcodeValue(code));
      barcodeUrl.searchParams.set('format','png');
      barcodeUrl.searchParams.set('width','420');
      barcodeUrl.searchParams.set('height','110');
      barcodeUrl.searchParams.set('includeText','true');
      return Response.redirect(barcodeUrl.toString(),302);
    }
    return json({error:'مسار تتبع القطع غير معروف',code:'UNIT_TRACKING_ROUTE_NOT_FOUND'},404);
  }catch(error){return json({error:error?.message||'تعذر تنفيذ تتبع القطعة',code:error?.code||'UNIT_TRACKING_ERROR'},error?.status||500);}
}
