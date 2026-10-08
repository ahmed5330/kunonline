import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {assertUnitStore,operationGuard,decodeUnitCode,UNIT_SAFETY_SCHEMA} from './inventory-unit-safety.js';
import {warehouseOperation} from './inventory-warehouse-operations.js';
import {isSerializedProduct,rejectQuantityMutation} from './inventory-tracking-mode.js';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const num=v=>Number(v)||0;
const stamp=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().toUpperCase()}`;
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

const schemaReady=new WeakSet();
export async function ensureInventoryUnitSchema(env){
  if(schemaReady.has(env.DB))return;
  const ready=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_schema_v128_4_ready'").first();if(ready){schemaReady.add(env.DB);return;}
  for(const sql of [...SCHEMA,...UNIT_SAFETY_SCHEMA])await env.DB.prepare(sql).run();
  schemaReady.add(env.DB);
}

async function currentUser(request,env,ctx,delegate){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const response=await delegate.fetch(new Request(u.toString(),{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)fail(me?.error||'محتاج تسجّل دخول',response.ok?401:(response.status||401),'AUTH_REQUIRED');
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
  return decodeUnitCode(v).slice(0,180);
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

function eventStatement(env,unit,{eventType,fromStatus=null,toStatus=null,orderId=null,note='',source='unit_tracking',actor='system',metadata={}}){
  return env.DB.prepare('INSERT INTO inventory_unit_events (id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,note,source,actor,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(rid('UEV'),unit.id,unit.unit_code,unit.client_id,unit.store_id||null,orderId||unit.current_order_id||unit.last_order_id||null,eventType,fromStatus,toStatus,clean(note,1200),source,actor,JSON.stringify(metadata||{}),stamp());
}
async function event(env,unit,options){await eventStatement(env,unit,options).run();}

export async function serializedReceiptStatements(env,{clientId,storeId,productId,variantId=null,batchId=null,batchItemId=null,receiptRef=null,qty,productName='',createdBy='system',receivedAt=stamp()}){
  if(!await isSerializedProduct(env,clientId,productId,variantId))return [];
  if(!Number.isSafeInteger(qty)||qty<1||qty>200)fail('استلام المنتج المرقم يحتاج عددًا صحيحًا من 1 إلى 200 قطعة لكل بند',400,'SERIALIZED_RECEIPT_QUANTITY_INVALID');
  await ensureInventoryUnitSchema(env);
  const prefix=await trackingCode(env,{clientId,storeId,productId,variantId,createdBy}),steps=[];
  for(let n=0;n<qty;n++){
    const uid=rid('UNT'),code=prefix+'-'+crypto.randomUUID().replace(/-/g,'').toUpperCase(),metadata=JSON.stringify({receiptBatchId:batchId,receiptRef});
    steps.push(env.DB.prepare('INSERT INTO inventory_units(id,unit_code,client_id,store_id,product_id,variant_id,batch_id,batch_item_id,product_name,sku,status,received_at,source,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uid,code,clientId,storeId,productId,variantId,batchId,batchItemId,productName,'','in_stock',receivedAt,'serialized_receipt',metadata,receivedAt,receivedAt));
    steps.push(eventStatement(env,{id:uid,unit_code:code,client_id:clientId,store_id:storeId},{eventType:'received_into_inventory',toStatus:'in_stock',source:'serialized_receipt',actor:createdBy,metadata:{receiptBatchId:batchId,receiptRef}}));
  }
  return steps;
}

async function createUnit(env,{clientId,storeId,productId,variantId=null,batchId=null,batchItemId=null,productName='',sku='',source='inventory',receivedAt=null,createdBy='system',metadata={}}){
  const pcode=await trackingCode(env,{clientId,storeId,productId,variantId,createdBy});
  for(let attempt=0;attempt<10;attempt++){
    const suffix=crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase(),unitCode=`${pcode}-${suffix}`,id=rid('UNT'),at=stamp();
    try{
      const unit={id,unit_code:unitCode,client_id:clientId,store_id:storeId||null,product_id:productId,variant_id:variantId||null,batch_id:batchId||null,batch_item_id:batchItemId||null,product_name:productName||'',sku:sku||'',status:'in_stock',current_order_id:null,last_order_id:null};
      const steps=[];
      if(Number.isInteger(metadata.backfillExpectedCount)){
        if(batchItemId)steps.push(operationGuard(env,'(SELECT COUNT(*) FROM inventory_units WHERE client_id=? AND batch_item_id=?)=?',[clientId,batchItemId,metadata.backfillExpectedCount]));
        else steps.push(operationGuard(env,"(SELECT COUNT(*) FROM inventory_units WHERE client_id=? AND store_id IS ? AND product_id=? AND COALESCE(variant_id,'')=COALESCE(?,'') AND status IN ('in_stock','returned_in_stock') AND current_order_id IS NULL)=?",[clientId,storeId||null,productId,variantId,metadata.backfillExpectedCount]));
      }
      steps.push(env.DB.prepare('INSERT INTO inventory_units (id,unit_code,client_id,store_id,product_id,variant_id,batch_id,batch_item_id,product_name,sku,status,current_order_id,last_order_id,received_at,source,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,unitCode,clientId,storeId||null,productId,variantId||null,batchId||null,batchItemId||null,productName||'',sku||'','in_stock',null,null,receivedAt||at,source,JSON.stringify(metadata||{}),at,at));
      steps.push(env.DB.prepare('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,event_type,to_status,note,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(rid('UEV'),id,unitCode,clientId,storeId||null,'received_into_inventory','in_stock','إنشاء هوية للقطعة الحالية',source,createdBy,JSON.stringify({productTrackingCode:pcode,...metadata}),at),env.DB.prepare('DELETE FROM inventory_operation_guards'));
      try{await env.DB.batch(steps);}catch(e){if(/CHECK constraint failed/.test(String(e.message)))fail('المخزون تغير أثناء الترقيم؛ أعد المحاولة',409,'BACKFILL_CONCURRENT_CHANGE');throw e;}
      return unit;
    }catch(error){if(!/UNIQUE/i.test(String(error?.message||error)))throw error;}
  }
  fail('تعذر إنشاء كود قطعة فريد',409,'UNIT_CODE_COLLISION');
}

async function createBackfillUnits(env,{clientId,storeId,productId,variantId=null,batchId=null,batchItemId=null,productName='',sku='',source,receivedAt=null,actor,metadata={},have,target,stock}){
  const count=target-have;if(!Number.isSafeInteger(count)||count<0||count>10000)fail('كمية الترقيم غير صحيحة أو تتجاوز 10000 قطعة للبند',409,'BACKFILL_SIZE_INVALID');if(!count)return 0;
  const prefix=await trackingCode(env,{clientId,storeId,productId,variantId,createdBy:actor}),at=stamp(),items=Array.from({length:count},()=>({id:rid('UNT'),code:prefix+'-'+crypto.randomUUID().replace(/-/g,'').toUpperCase(),event:rid('UEV')})),json=JSON.stringify(items);
  const predicate=batchItemId?'(SELECT COUNT(*) FROM inventory_units WHERE client_id=? AND batch_item_id=?)=? AND EXISTS(SELECT 1 FROM inventory_batch_items WHERE id=? AND client_id=? AND COALESCE(remaining_qty,initial_qty)=?)':"(SELECT COUNT(*) FROM inventory_units WHERE client_id=? AND store_id IS ? AND product_id=? AND COALESCE(variant_id,'')=COALESCE(?,'') AND status IN ('in_stock','returned_in_stock') AND current_order_id IS NULL)=? AND EXISTS(SELECT 1 FROM "+(variantId?'product_variants':'products')+' WHERE id=? AND client_id=? AND stock=?)';
  const binds=batchItemId?[clientId,batchItemId,have,batchItemId,clientId,stock]:[clientId,storeId||null,productId,variantId,have,variantId||productId,clientId,stock];
  const steps=[operationGuard(env,predicate,binds),env.DB.prepare("INSERT INTO inventory_units(id,unit_code,client_id,store_id,product_id,variant_id,batch_id,batch_item_id,product_name,sku,status,received_at,source,metadata_json,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.code'),?,?,?,?,?,?,?,?,'in_stock',?,?,?,?,? FROM json_each(?)").bind(clientId,storeId||null,productId,variantId,batchId,batchItemId,productName,sku,receivedAt||at,source,JSON.stringify(metadata),at,at,json),env.DB.prepare("INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,event_type,to_status,note,source,actor,metadata_json,created_at) SELECT json_extract(value,'$.event'),json_extract(value,'$.id'),json_extract(value,'$.code'),?,?,'received_into_inventory','in_stock','إنشاء هوية للقطعة الحالية',?,?,?,? FROM json_each(?)").bind(clientId,storeId||null,source,actor,JSON.stringify(metadata),at,json),env.DB.prepare('DELETE FROM inventory_operation_guards')];
  try{await env.DB.batch(steps);}catch(e){if(/CHECK constraint failed/.test(String(e.message)))fail('المخزون تغير أثناء الترقيم؛ أعد المحاولة',409,'BACKFILL_CONCURRENT_CHANGE');throw e;}return count;
}

async function productInfo(env,{clientId,productId,variantId=null}){
  if(variantId){
    return env.DB.prepare('SELECT p.name product_name,COALESCE(v.sku,p.sku,\'\') sku,v.stock FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.id=? AND v.product_id=? AND v.client_id=?').bind(variantId,productId,clientId).first();
  }
  return env.DB.prepare('SELECT name product_name,COALESCE(sku,\'\') sku,stock FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();
}

async function reconcileBatchItem(env,item,{actor='system'}={}){
  const initial=Math.max(0,Math.floor(num(item.initial_qty))),remaining=item.remaining_qty===undefined||item.remaining_qty===null?initial:Math.floor(num(item.remaining_qty)),desiredAvailable=Math.max(0,Math.min(initial,remaining));
  const active=await env.DB.prepare("SELECT COALESCE(SUM(qty),0) n FROM order_item_stock_allocations WHERE client_id=? AND batch_item_id=? AND status='allocated'").bind(item.client_id,item.id).first().catch(()=>({n:0}));
  const target=desiredAvailable+num(active?.n),row=await env.DB.prepare('SELECT COUNT(*) n FROM inventory_units WHERE client_id=? AND batch_item_id=?').bind(item.client_id,item.id).first(),have=num(row?.n);
  const p=await productInfo(env,{clientId:item.client_id,productId:item.product_id,variantId:item.variant_id||null});
  const created=await createBackfillUnits(env,{clientId:item.client_id,storeId:item.store_id,productId:item.product_id,variantId:item.variant_id||null,batchId:item.batch_id,batchItemId:item.id,productName:item.product_name||p?.product_name||'',sku:p?.sku||'',source:'inventory_batch',receivedAt:item.batch_created_at||item.created_at,actor,metadata:{batchName:item.batch_name||'',legacyBackfill:Boolean(item.existing_batch)},have,target,stock:remaining});

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
  const created=await createBackfillUnits(env,{clientId,storeId,productId,variantId,productName:p.product_name||'',sku:p.sku||'',source,actor,metadata:{coverageBackfill:true},have,target,stock:p.stock});
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

function statusTransition(env,unit,status,{orderId=null,eventType='status_changed',note='',source='order_lifecycle',actor='system',metadata={}}={}){
  const clearsCurrentOrder=['in_stock','returned_in_stock','retired','legacy_outbound',...RETURN_HOLD].includes(status);
  if(unit.status===status&&String(unit.current_order_id||'')===String((clearsCurrentOrder?null:orderId)||''))return {steps:[],value:unit};
  const from=unit.status,at=stamp(),fields={reserved_at:null,shipped_at:null,delivered_at:null,returned_at:null,retired_at:null};
  if(status==='reserved')fields.reserved_at=at;if(status==='shipped')fields.shipped_at=at;if(status==='delivered')fields.delivered_at=at;if(status==='returned_in_stock'||RETURN_HOLD.has(status))fields.returned_at=at;if(status==='retired')fields.retired_at=at;
  const clear=['in_stock','returned_in_stock','retired','legacy_outbound',...RETURN_HOLD].includes(status),current=clear?null:(orderId||unit.current_order_id||null),last=orderId||unit.current_order_id||unit.last_order_id||null;
  const steps=[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND status=? AND current_order_id IS ? AND (? IS NULL OR updated_at=?))',[unit.id,unit.client_id,unit.status,unit.current_order_id||null,unit.updated_at||null,unit.updated_at||null]),env.DB.prepare(`UPDATE inventory_units SET status=?,current_order_id=?,last_order_id=?,reserved_at=COALESCE(?,reserved_at),shipped_at=COALESCE(?,shipped_at),delivered_at=COALESCE(?,delivered_at),returned_at=COALESCE(?,returned_at),retired_at=COALESCE(?,retired_at),updated_at=? WHERE id=? AND client_id=?`).bind(status,current,last,fields.reserved_at,fields.shipped_at,fields.delivered_at,fields.returned_at,fields.retired_at,at,unit.id,unit.client_id),eventStatement(env,unit,{eventType,fromStatus:from,toStatus:status,orderId:last,note,source,actor,metadata})];
  return {steps,value:{...unit,status,current_order_id:current,last_order_id:last,updated_at:at}};
}
async function setStatus(env,unit,status,options={}){
  const transition=statusTransition(env,unit,status,options);if(!transition.steps.length&&!options.statements?.length)return transition.value;
  try{await env.DB.batch([...transition.steps.slice(0,1),...(options.statements||[]),...transition.steps.slice(1),env.DB.prepare('DELETE FROM inventory_operation_guards')]);}
  catch(e){if(/CHECK constraint failed|UNIT_ACTIVE_ALLOCATION_CONFLICT/.test(e.message))fail('القطعة تغيرت أثناء الحركة؛ حدّث الشاشة',409,'UNIT_CONCURRENT_CHANGE');throw e;}
  return transition.value;
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
    const needed=Math.max(0,Math.floor(num(a.qty))),existing=num((await env.DB.prepare('SELECT COUNT(*) n FROM order_unit_allocations WHERE client_id=? AND order_id=? AND stock_allocation_id=? AND status<>\'released\'').bind(clientId,orderId,a.id||a.stock_allocation_id||orderId).first())?.n),left=needed-existing;if(left<=0)continue;
    const {results:units=[]}=await env.DB.prepare("SELECT * FROM inventory_units WHERE client_id=? AND batch_item_id=? AND status IN ('legacy_outbound','in_stock','returned_in_stock') AND current_order_id IS NULL ORDER BY CASE status WHEN 'legacy_outbound' THEN 0 ELSE 1 END,received_at,created_at,id LIMIT ?").bind(clientId,a.batch_item_id,left).all();
    if(units.length<left)fail(`لا توجد أكواد قطع كافية لتغطية أوردر ${orderId}. المطلوب ${left} والمتاح ${units.length}.`,409,'UNIT_TRACKING_COVERAGE_MISMATCH');
    for(const unit of units){
      const at=stamp(),allocId=rid('OUA'),stockId=a.id||a.stock_allocation_id||orderId;
      const allocation=env.DB.prepare("INSERT INTO order_unit_allocations(id,client_id,store_id,order_id,order_item_id,stock_allocation_id,unit_id,unit_code,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,?) ON CONFLICT(order_id,unit_id) DO UPDATE SET stock_allocation_id=excluded.stock_allocation_id,status='reserved',updated_at=excluded.updated_at,released_at=NULL").bind(allocId,clientId,a.store_id||null,orderId,a.order_item_id||null,stockId,unit.id,unit.unit_code,at,at);
      await setStatus(env,unit,'reserved',{orderId,eventType:'reserved_for_order',note:'تم حجز القطعة للأوردر '+orderId,source:'fifo_confirmation',actor,metadata:{stockAllocationId:stockId,batchId:a.batch_id},statements:[operationGuard(env,"(SELECT COUNT(*) FROM order_unit_allocations WHERE client_id=? AND order_id=? AND stock_allocation_id=? AND status<>'released')<?",[clientId,orderId,stockId,needed]),allocation]});assigned++;

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
  // The legacy order state changes when the waybill is printed. It is not proof
  // of physical handover. New units remain reserved/packed until a manifest closes.
  else if(SHIPPED.has(order.state)){target='reserved';eventType='waybill_created';note=order.awb?`تم إنشاء البوليصة — AWB ${order.awb}`:'بانتظار تسليم المندوب';}
  else if(DELIVERED.has(order.state)){target='delivered';eventType='delivered_to_customer';note='تم تسليم القطعة للعميل';}
  else if(order.state==='returned'){target='returned_pending_inspection';eventType='return_received_pending_inspection';note='تم استلام المرتجع وهو في انتظار الفحص؛ لم يعد متاحًا للبيع بعد';}
  else if(RELEASED.has(order.state)){target='in_stock';eventType='reservation_released';note='تم فك حجز القطعة وإعادتها للمخزون';}
  if(!target)return {ok:true,orderId,state:order.state,units:rows.length,changed:0};
  let changed=0;for(const row of rows){
    if(['released','returned','quarantined','damaged','scrapped'].includes(row.allocation_status))continue;
    if(row.current_order_id&&row.current_order_id!==orderId)continue;
    if(['returned_pending_inspection','returned_in_stock','quarantined','damaged','scrapped'].includes(row.status)){
      const physicalReturn=await env.DB.prepare('SELECT 1 n FROM inventory_return_cases WHERE client_id=? AND unit_id=? AND order_id=? AND cycle_token=? LIMIT 1').bind(clientId,row.id,orderId,row.shipped_at||'').first();
      if(physicalReturn)continue;
    }
    if(SHIPPED.has(order.state)&&['packed','shipped','delivered','returned_pending_inspection','returned_in_stock','quarantined','damaged','scrapped'].includes(row.status))continue;
    if(DELIVERED.has(order.state)&&!['shipped','delivered'].includes(row.status))continue;
    if(HOLDING.has(order.state)&&['packed','shipped','delivered','in_transfer','scrapped'].includes(row.status))continue;
    if(RELEASED.has(order.state)&&['shipped','delivered','scrapped'].includes(row.status))fail('لا يمكن فك حجز قطعة خرجت فعليًا؛ استخدم المرتجع',409,'SHIPPED_UNIT_CANCEL_BLOCKED');
    if(order.state==='returned'&&(['returned_in_stock','quarantined','damaged','scrapped','missing','in_transfer'].includes(row.status)))continue;
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
  if(['POST','PUT','PATCH','DELETE'].includes(method)&&(/^\/api\/products\/[^/]+\/(?:stock(?:\/add)?|variants)$/.test(path)||/^\/api\/variants\/[^/]+(?:\/stock\/add)?$/.test(path)||method==='DELETE'&&/^\/api\/products\/[^/]+$/.test(path)))return 'legacy_stock_preflight';
  if(['POST','PATCH'].includes(method)&&(/^\/api\/customer-service\/orders\/[^/]+\/state$/.test(path)||/^\/api\/orders\/[^/]+$/.test(path)))return 'order_preflight';
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
  const {results:shipments=[]}=await env.DB.prepare('SELECT s.id,s.order_id,s.awb,s.status,s.created_at,s.printed_at,s.handed_over_at FROM inventory_shipments s JOIN inventory_shipment_units x ON x.shipment_id=s.id AND x.client_id=s.client_id WHERE x.client_id=? AND x.unit_id=? ORDER BY s.created_at DESC').bind(clientId,unit.id).all();
  return {shipments,unit:{...unit,metadata:JSON.parse(unit.metadata_json||'{}'),qrValue:qrValue(unit.unit_code),barcodeValue:barcodeValue(unit.unit_code)},events:events.map(x=>({...x,metadata:(()=>{try{return JSON.parse(x.metadata_json||'{}')}catch{return {}}})()})),allocations,orders};
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
function scanEventStatement(env,{session,order,unit=null,kind,result,actor='system',actorUserId=null,deviceId='',metadata={}}){
  return env.DB.prepare('INSERT INTO inventory_scan_events(id,session_id,client_id,store_id,order_id,unit_id,unit_code,scan_context,scan_kind,result,awb,actor,actor_user_id,device_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(rid('SEV'),session?.id||null,order.client_id,order.store_id||null,order.id,unit?.id||null,unit?.unit_code||null,session?.scan_context||clean(metadata.context)||'packing',kind,result,order.awb||session?.awb||null,actor,actorUserId||null,clean(deviceId,180)||null,JSON.stringify(metadata||{}),stamp());
}
async function scanEvent(env,options){await scanEventStatement(env,options).run();}

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
  if(ctx==='packing'&&!['confirmed','preparing','shipped'].includes(clean(order.state)))fail('تجهيز القطع بالمسح متاح للأوردر الموجود في قسم الطباعة قبل الشحن',409,'PACKING_ORDER_STATE_INVALID');
  if(ctx==='dispatch'&&(clean(order.state)!=='shipped'||!clean(order.awb)))fail('مسح التسليم لشركة الشحن متاح بعد إنشاء AWB والبوليصة الرسمية',409,'DISPATCH_ORDER_STATE_INVALID');
  const state=await sessionFor(env,{clientId,orderId:order.id,context:ctx,actor,actorUserId,deviceId,orderScanCodeValue:found.raw});
  await scanEvent(env,{session:state.session,order,kind:found.matchedBy==='awb'?'awb':'order',result:'accepted',actor,actorUserId,deviceId,metadata:{matchedBy:found.matchedBy,scannedCode:found.raw,context:ctx}});
  return {...await scanSnapshot(env,{clientId,orderId:order.id,context:ctx,actor}),matchedBy:found.matchedBy};
}
async function scanUnitForOrder(env,{clientId,orderId,code,context,actor='system',actorUserId=null,deviceId=''}){
  const ctx=scanContext(context),state=await sessionFor(env,{clientId,orderId,context:ctx,actor,actorUserId,deviceId}),session=state.session,order=state.order;
  if(ctx==='packing'&&!['confirmed','preparing','shipped'].includes(clean(order.state)))fail('الأوردر خرج من مرحلة التجهيز',409,'PACKING_ORDER_STATE_INVALID');
  if(ctx==='dispatch'&&(clean(order.state)!=='shipped'||!clean(order.awb)))fail('لا يمكن تأكيد التسليم للشحن قبل إنشاء AWB',409,'DISPATCH_ORDER_STATE_INVALID');
  const unitCode=scanCode(code);if(!unitCode)fail('امسح باركود القطعة',400,'UNIT_CODE_REQUIRED');
  let unit=await env.DB.prepare('SELECT * FROM inventory_units WHERE client_id=? AND unit_code=?').bind(clientId,unitCode).first();
  if(!unit)fail('كود القطعة غير موجود',404,'UNIT_NOT_FOUND');
  const duplicate=await env.DB.prepare("SELECT id FROM inventory_scan_events WHERE session_id=? AND unit_id=? AND scan_kind='unit' AND result='accepted' LIMIT 1").bind(session.id,unit.id).first();
  if(duplicate){await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'UNIT_ALREADY_SCANNED'}});fail('تم مسح هذه القطعة بالفعل',409,'UNIT_ALREADY_SCANNED');}
  const mutationSteps=[];
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
    const release=statusTransition(env,candidate,'in_stock',{orderId,eventType:'packing_scan_placeholder_released',source:'packing_scan',actor,metadata:{sessionId:session.id,replacedBy:unit.unit_code}});
    const claim=statusTransition(env,unit,'reserved',{orderId,eventType:'packing_scan_claimed',source:'packing_scan',actor,metadata:{sessionId:session.id,replacedUnit:candidate.unit_code}});
    mutationSteps.push(...release.steps,env.DB.prepare('UPDATE order_unit_allocations SET unit_id=?,unit_code=?,updated_at=? WHERE id=? AND client_id=? AND order_id=?').bind(unit.id,unit.unit_code,stamp(),candidate.allocation_id,clientId,orderId),...claim.steps);
    unit=claim.value;
    allocation={...candidate,unit_id:unit.id,unit_code:unit.unit_code};
  }
  if(!allocation){
    await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'not_allocated_to_order'}});
    fail('هذه القطعة ليست ضمن القطع التي تم تجهيزها لهذا الأوردر',409,'UNIT_NOT_IN_ORDER');
  }
  if(!['reserved','packed'].includes(unit.status)||String(unit.current_order_id||'')!==String(orderId)){
    await scanEvent(env,{session,order,unit,kind:'unit',result:'rejected',actor,actorUserId,deviceId,metadata:{reason:'UNIT_NOT_AVAILABLE',status:unit.status}});
    fail('حالة القطعة لا تسمح بالتجهيز أو التسليم',409,'UNIT_NOT_AVAILABLE');
  }
  const steps=[...mutationSteps,operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id=? AND status IN ('reserved','packed')) AND EXISTS(SELECT 1 FROM order_unit_allocations WHERE client_id=? AND order_id=? AND unit_id=? AND status IN ('reserved','packed')) AND (SELECT COUNT(DISTINCT unit_id) FROM inventory_scan_events WHERE session_id=? AND scan_kind='unit' AND result='accepted')<(SELECT expected_units FROM inventory_scan_sessions WHERE id=?)",[unit.id,clientId,orderId,clientId,orderId,unit.id,session.id,session.id]),scanEventStatement(env,{session,order,unit,kind:'unit',result:'accepted',actor,actorUserId,deviceId,metadata:{allocationId:allocation.id,context:ctx}}),eventStatement(env,unit,{eventType:ctx==='packing'?'picked_and_packed_scan':'dispatch_scan_verified',fromStatus:unit.status,toStatus:unit.status,orderId,source:ctx+'_scan',actor,metadata:{scanSessionId:session.id,deviceId,awb:order.awb||null}}),env.DB.prepare('DELETE FROM inventory_operation_guards')];
  try{await env.DB.batch(steps);}catch(e){if(/UNIQUE constraint failed/.test(e.message))fail('تم مسح القطعة بالفعل',409,'UNIT_ALREADY_SCANNED');if(/CHECK constraint failed|UNIT_ACTIVE_ALLOCATION_CONFLICT/.test(e.message))fail('القطعة أو التجهيز تغير أثناء المسح',409,'UNIT_CONCURRENT_CHANGE');throw e;}
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
  const unitCode=scanCode(code),action=clean(disposition,40).toLowerCase();
  if(!['restock','quarantine','damaged'].includes(action))fail('قرار الفحص غير صحيح',400,'RETURN_DISPOSITION_INVALID');
  const unit=await env.DB.prepare('SELECT * FROM inventory_units WHERE client_id=? AND unit_code=?').bind(clientId,unitCode).first();if(!unit)fail('القطعة غير موجودة',404,'UNIT_NOT_FOUND');
  const orderId=unit.current_order_id||unit.last_order_id;
  const order=await env.DB.prepare('SELECT id,client_id,store_id,state,awb FROM orders WHERE client_id=? AND id=?').bind(clientId,orderId||'').first();
  const returnCase=await env.DB.prepare('SELECT * FROM inventory_return_cases WHERE client_id=? AND unit_id=? AND order_id=? AND cycle_token=? ORDER BY created_at DESC LIMIT 1').bind(clientId,unit.id,orderId||'',unit.shipped_at||'').first();
  if(!order||(order.state!=='returned'&&!returnCase))fail('القطعة ليست مرتبطة بمرتجع مستلم',409,'UNIT_RETURN_ORDER_REQUIRED');
  const target=action==='restock'?'returned_in_stock':action==='quarantine'?'quarantined':'damaged';
  if(unit.status===target)return {ok:true,idempotent:true,disposition:action,...await unitDetails(env,{clientId,code:unitCode})};
  if(!RETURN_HOLD.has(unit.status))fail('القطعة ليست في مرحلة فحص المرتجع',409,'RETURN_ALREADY_PROCESSED');
  const at=stamp(),steps=[operationGuard(env,'EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND status=? AND updated_at=?)',[unit.id,clientId,unit.status,unit.updated_at])];
  if(action==='restock'){
    const p=await productInfo(env,{clientId,productId:unit.product_id,variantId:unit.variant_id});if(!p)fail('المنتج غير موجود',409,'RETURN_PRODUCT_NOT_FOUND');
    if(unit.batch_item_id)steps.push(operationGuard(env,'EXISTS(SELECT 1 FROM inventory_batch_items WHERE id=? AND client_id=? AND remaining_qty<initial_qty)',[unit.batch_item_id,clientId]),env.DB.prepare('UPDATE inventory_batch_items SET remaining_qty=remaining_qty+1 WHERE id=? AND client_id=?').bind(unit.batch_item_id,clientId));
    if(unit.batch_id)steps.push(env.DB.prepare("UPDATE inventory_batches SET status='active' WHERE id=? AND client_id=?").bind(unit.batch_id,clientId));
    const table=unit.variant_id?'product_variants':'products',entity=unit.variant_id||unit.product_id;
    steps.push(env.DB.prepare('UPDATE '+table+' SET stock=COALESCE(stock,0)+1 WHERE id=? AND client_id=?').bind(entity,clientId));
    steps.push(env.DB.prepare('INSERT INTO stock_log(id,client_id,store_id,product_id,variant_id,product_name,delta,new_stock,note,stock_date,batch_id,created_at,created_by) SELECT ?,?,?,?,?,?,1,stock,?,?,?,?,? FROM '+table+' WHERE id=? AND client_id=?').bind(rid('STK'),clientId,unit.store_id||null,unit.product_id,unit.variant_id||null,unit.product_name||'', 'مرتجع مفحوص '+unit.unit_code+' '+orderId,at.slice(0,10),unit.batch_id||null,at,actor,entity,clientId));
  }
  steps.push(env.DB.prepare('UPDATE inventory_units SET status=?,current_order_id=NULL,returned_at=COALESCE(returned_at,?),updated_at=? WHERE id=? AND client_id=?').bind(target,at,at,unit.id,clientId));
  steps.push(env.DB.prepare('UPDATE order_unit_allocations SET status=?,updated_at=?,released_at=? WHERE client_id=? AND order_id=? AND unit_id=?').bind(action==='restock'?'returned':target,at,at,clientId,orderId,unit.id));
  if(returnCase)steps.push(env.DB.prepare("UPDATE inventory_return_cases SET status='inspected',condition=?,inspection_reason=?,inspected_at=? WHERE id=? AND client_id=?").bind(target,clean(reason,600),at,returnCase.id,clientId));
  const type=action==='restock'?'return_restocked_after_inspection':action==='quarantine'?'return_quarantined':'return_marked_damaged';
  steps.push(env.DB.prepare('INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,note,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(rid('UEV'),unit.id,unit.unit_code,clientId,unit.store_id||null,orderId,type,unit.status,target,clean(reason,600),'return_scan',actor,JSON.stringify({deviceId,awb:returnCase?.awb||order.awb||null}),at));
  steps.push(env.DB.prepare("UPDATE orders SET restocked=CASE WHEN NOT EXISTS(SELECT 1 FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id AND u.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? AND u.status<>'returned_in_stock') THEN 1 ELSE 0 END WHERE id=? AND client_id=?").bind(clientId,orderId,orderId,clientId));
  steps.push(env.DB.prepare('DELETE FROM inventory_operation_guards'));
  try{await env.DB.batch(steps);}catch(error){if(/CHECK constraint failed/.test(String(error.message)))fail('المرتجع تغيّر أثناء الفحص؛ حدّث الشاشة',409,'RETURN_CONCURRENT_CHANGE');throw error;}
  return {ok:true,disposition:action,...await unitDetails(env,{clientId,code:unitCode})};
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
    const me=await currentUser(request,env,ctx,delegate),requested=url.searchParams.get('clientId'),clientId=resolveTenant(me,requested||(me.role==='client'?me.clientId:null)),write=method!=='GET';
    // Existing product/stock mutations keep their original permission contract in
    // the delegated route. Tracking-only APIs require Inventory permission here.
    if(isApi){
      const orderScanApi=path.startsWith('/api/inventory/unit-tracking/order-scan');
      if(orderScanApi)requirePermission(me,'orders',write?'update':'read');
      else if(write&&/^\/api\/inventory\/unit-tracking\/(?:labels\/jobs|handover(?:\/scan|\/complete)?|operations(?:\/scan|\/complete|\/approve)?|scrap(?:\/approve)?|exchanges|returns\/receive|serialize|shipments(?:\/.*)?)$/.test(path)){/* Warehouse endpoints enforce their specific operation permission. */}
      else requirePermission(me,'inventory',write?'update':'read');
    }
    const body=write?await request.clone().json().catch(()=>({})):{};
    const storeId=await scoped(request,env,me,clientId,{write,storeId:body.storeId||body.store_id||null}),actor=actorName(me);
    await ensureInventoryUnitSchema(env);
    // Verify the entity's actual store before any lookup can reconcile or mutate it.
    if(isApi){
      const orderId=clean(body.orderId||body.order_id||url.searchParams.get('orderId'));
      if(orderId&&!path.includes('/shipments'))assertUnitStore(await env.DB.prepare('SELECT store_id FROM orders WHERE client_id=? AND (id=? OR (?=1 AND ref=?))').bind(clientId,orderId,path.includes('/shipments')?1:0,orderId).first(),storeId);
      const raw=body.code||body.unitCode||url.searchParams.get('code');
      if(raw&&/\/(?:lookup|qr|barcode|unit|disposition|scrap)$/.test(path))assertUnitStore(await env.DB.prepare('SELECT store_id FROM inventory_units WHERE client_id=? AND unit_code=?').bind(clientId,scanCode(raw)).first(),storeId);
      if(path.endsWith('/order-scan/open'))assertUnitStore((await findOrderByScan(env,{clientId,code:raw||body.orderCode||body.awb})).row,storeId);
      if(path.startsWith('/api/inventory/unit-tracking/order-scan')){const scanOrder=orderId||(path.endsWith('/open')?(await findOrderByScan(env,{clientId,code:raw||body.orderCode||body.awb})).row.id:null);if(scanOrder&&await env.DB.prepare("SELECT 1 n FROM inventory_shipments WHERE client_id=? AND order_id=? AND status<>'cancelled' LIMIT 1").bind(clientId,scanOrder).first())fail('امسح بوليصة الشحنة الجزئية من مسار تجهيز الشحنات الجزئية',409,'PARTIAL_PACKING_REQUIRED');}
      const operation=await warehouseOperation({env,clientId,storeId,me,actor,path,method,body,url});
      if(operation)return json(operation);
    }

    if(kind){
      if(kind==='legacy_stock_preflight'){
        const entityId=decodeURIComponent(path.split('/')[3]);let productId=entityId;
        if(path.startsWith('/api/variants/')){const v=await env.DB.prepare('SELECT product_id,store_id FROM product_variants WHERE id=? AND client_id=?').bind(entityId,clientId).first();assertUnitStore(v,storeId);productId=v.product_id;}
        else assertUnitStore(await env.DB.prepare('SELECT store_id FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first(),storeId);
        if(await isSerializedProduct(env,clientId,productId))rejectQuantityMutation();return delegate.fetch(request,env,ctx);
      }
      if(kind==='product_create'&&body.id&&await isSerializedProduct(env,clientId,clean(body.id)))rejectQuantityMutation();
      if(kind==='stock_adjust'||kind==='product_edit'){
        const productId=clean(body.productId||body.product_id||(kind==='product_edit'?decodeURIComponent(path.split('/').at(-1)):''));
        const tracked=await env.DB.prepare("SELECT 1 n FROM inventory_serialization_snapshots WHERE client_id=? AND product_id=? AND tracking_mode='SERIALIZED' LIMIT 1").bind(clientId,productId).first();
        if(tracked&&(kind==='stock_adjust'||Object.hasOwn(body,'stock')||Array.isArray(body.variants)))fail('المنتج مرقم؛ تغيير الكمية يتم باستلام أو حركة قطع فقط',409,'SERIALIZED_MANUAL_STOCK_EDIT_BLOCKED');
      }
      if(kind==='order_preflight'){
        const orderId=path.split('/')[path.startsWith('/api/customer-service')?4:3],state=clean(body.state||body.toState||body.status);
        if(RELEASED.has(state)){
          if(await env.DB.prepare("SELECT 1 n FROM inventory_shipments WHERE client_id=? AND order_id=? AND status IN ('waybill_pending','waybill_created','printed','packing','packed','cancel_pending') LIMIT 1").bind(clientId,orderId).first())fail('ألغِ بوليصة الشحنة لدى J&T قبل فك الحجز',409,'CARRIER_CANCELLATION_REQUIRED');
          const exiting=await env.DB.prepare("SELECT 1 n FROM inventory_units WHERE client_id=? AND current_order_id=? AND status IN ('shipped','delivered') LIMIT 1").bind(clientId,orderId).first();
          if(exiting)fail('الطلب خرج فعليًا للمندوب؛ يجب تسجيل مرتجع قبل فك المخزون',409,'SHIPPED_UNIT_CANCEL_BLOCKED');
        }
        const response=await delegate.fetch(request,env,ctx);if(response.ok)await syncOrderUnitTracking(env,{clientId,orderId,actor,source:path});return response;
      }
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


    if(path==='/api/inventory/unit-tracking/serialize'&&method==='POST'){
      requirePermission(me,'inventory.serialization','activate');
      let productId=clean(body.productId),variantId=clean(body.variantId)||null;
      if(!productId&&body.code){const code=scanCode(body.code);const found=await env.DB.prepare('SELECT product_id,variant_id FROM product_tracking_codes WHERE client_id=? AND code=?').bind(clientId,code).first()||await env.DB.prepare('SELECT product_id,variant_id FROM inventory_units WHERE client_id=? AND unit_code=?').bind(clientId,code).first();if(found){productId=found.product_id;variantId=found.variant_id||null;}}
      const p=await productInfo(env,{clientId,productId,variantId});if(!p)fail('المنتج غير موجود',404,'TRACKING_PRODUCT_NOT_FOUND');
      if(!variantId&&(await env.DB.prepare('SELECT 1 n FROM product_variants WHERE client_id=? AND product_id=? AND active=1 LIMIT 1').bind(clientId,productId).first()))fail('فعّل الترقيم لكل Variant منفصلًا حتى لا تتضاعف كمية المنتج',409,'SERIALIZATION_VARIANT_REQUIRED');
      const product=await env.DB.prepare('SELECT store_id FROM products WHERE client_id=? AND id=?').bind(clientId,productId).first();assertUnitStore(product,storeId);
      const entityStore=product.store_id||null,key=JSON.stringify([clientId,entityStore,productId,variantId]),prior=await env.DB.prepare('SELECT * FROM inventory_serialization_snapshots WHERE entity_key=?').bind(key).first();if(prior?.tracking_mode==='SERIALIZED')return json({ok:true,idempotent:true,snapshot:prior});
      const before=Number(p.stock);if(!Number.isSafeInteger(before)||before<0)fail('الرصيد يحتاج مطابقة قبل الترقيم',409,'SERIALIZATION_STOCK_INVALID');
      if(prior&&prior.before_qty!==before)fail('الرصيد تغير منذ أخذ اللقطة؛ راجع المطابقة',409,'SERIALIZATION_SNAPSHOT_CHANGED');
      await env.DB.prepare('INSERT OR IGNORE INTO inventory_serialization_snapshots(entity_key,client_id,store_id,product_id,variant_id,before_qty,actor,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(key,clientId,entityStore,productId,variantId,before,actor,stamp()).run();
      const {results:items=[]}=await env.DB.prepare("SELECT i.*,b.name batch_name,b.created_at batch_created_at FROM inventory_batch_items i JOIN inventory_batches b ON b.id=i.batch_id AND b.client_id=i.client_id WHERE i.client_id=? AND i.product_id=? AND COALESCE(i.variant_id,'')=COALESCE(?,'') AND i.store_id IS ?").bind(clientId,productId,variantId,entityStore).all();for(const item of items)await reconcileBatchItem(env,item,{actor});
      await reconcileEntityStock(env,{clientId,storeId:entityStore,productId,variantId,actor});const after=await availableCount(env,{clientId,storeId:entityStore,productId,variantId});if(after!==before)fail('عدد القطع لا يطابق اللقطة؛ لم يتم اعتماد التحويل',409,'SERIALIZATION_COUNT_MISMATCH');
      const table=variantId?'product_variants':'products',entity=variantId||productId;
      await env.DB.batch([operationGuard(env,`EXISTS(SELECT 1 FROM ${table} WHERE client_id=? AND id=? AND stock=?) AND (SELECT COUNT(*) FROM inventory_units WHERE client_id=? AND store_id IS ? AND product_id=? AND COALESCE(variant_id,'')=COALESCE(?,'') AND status IN ('in_stock','returned_in_stock') AND current_order_id IS NULL)=?`,[clientId,entity,before,clientId,entityStore,productId,variantId,before]),env.DB.prepare("UPDATE inventory_serialization_snapshots SET after_qty=?,tracking_mode='SERIALIZED',completed_at=? WHERE entity_key=?").bind(after,stamp(),key),env.DB.prepare('DELETE FROM inventory_operation_guards')]);
      return json({ok:true,beforeQty:before,afterQty:after,trackingMode:'SERIALIZED'});
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
