import {assertUnitStore,operationGuard,decodeUnitCode} from './inventory-unit-safety.js';
import {requirePermission} from './access-control.js';
import {approveStocktake} from './inventory-stocktake-approval.js';
import {receivePartialReturn} from './inventory-partial-returns.js';
import {openExchange,exchangeHandoverStatements} from './inventory-exchange.js';

const at=()=>new Date().toISOString(),id=p=>`${p}-${crypto.randomUUID()}`;
const reject=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status});};
const sellable=new Set(['in_stock','returned_in_stock']);
const physical=['in_stock','returned_in_stock','reserved','packed','returned_pending_inspection','quarantined','damaged'];
const statement=(env,sql,...values)=>env.DB.prepare(sql).bind(...values);
async function atomic(env,steps){
  try{return await env.DB.batch([...steps,env.DB.prepare('DELETE FROM inventory_operation_guards')]);}
  catch(e){if(/CHECK constraint failed|UNIQUE constraint failed/.test(String(e.message)))reject('INVENTORY_CONCURRENT_CHANGE','الحركة تغيرت أو تكررت؛ حدّث الشاشة وأعد المراجعة');throw e;}
}
function audit(env,u,type,actor,metadata={},to=u.status){return statement(env,'INSERT INTO inventory_unit_events(id,unit_id,unit_code,client_id,store_id,order_id,event_type,from_status,to_status,source,actor,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id('EV'),u.id,u.unit_code,u.client_id,u.store_id||null,u.current_order_id||u.last_order_id||null,type,u.status,to,'warehouse_operations',actor,JSON.stringify(metadata),at());}
function transferStock(env,u,delta){
  const table=u.variant_id?'product_variants':'products',entity=u.variant_id||u.product_id,steps=[];
  if(delta<0)steps.push(operationGuard(env,`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND client_id=? AND stock>=1)`,[entity,u.client_id]));
  steps.push(statement(env,`UPDATE ${table} SET stock=stock+? WHERE id=? AND client_id=?`,delta,entity,u.client_id));
  if(u.batch_item_id){if(delta<0)steps.push(operationGuard(env,'EXISTS(SELECT 1 FROM inventory_batch_items WHERE id=? AND client_id=? AND remaining_qty>=1)',[u.batch_item_id,u.client_id]));steps.push(statement(env,'UPDATE inventory_batch_items SET remaining_qty=remaining_qty+? WHERE id=? AND client_id=?',delta,u.batch_item_id,u.client_id));}
  return steps;
}
async function unit(env,clientId,storeId,code){return assertUnitStore(await statement(env,'SELECT * FROM inventory_units WHERE client_id=? AND unit_code=?',clientId,decodeUnitCode(code)).first(),storeId);}
async function batch(env,clientId,storeId,batchId){return assertUnitStore(await statement(env,'SELECT * FROM inventory_handover_batches WHERE client_id=? AND id=?',clientId,batchId).first(),storeId);}
async function session(env,clientId,storeId,sessionId){return assertUnitStore(await statement(env,'SELECT * FROM inventory_operation_sessions WHERE client_id=? AND id=?',clientId,sessionId).first(),storeId);}
function observation(env,s,u){return statement(env,"INSERT OR IGNORE INTO inventory_count_baselines(session_id,unit_id,status,updated_at,warehouse,location) SELECT ?,u.id,u.status,u.updated_at,COALESCE(l.warehouse,'Main'),COALESCE(l.location,'') FROM inventory_units u LEFT JOIN inventory_unit_locations l ON l.unit_id=u.id AND l.client_id=u.client_id WHERE u.id=? AND u.client_id=?",s.id,u.id,u.client_id);}
async function manifest(env,b){const {results:orders=[]}=await statement(env,'SELECT order_id,awb FROM inventory_handover_orders WHERE client_id=? AND batch_id=?',b.client_id,b.id).all();const {results:units=[]}=await statement(env,'SELECT h.order_id,h.awb,u.unit_code,u.product_name,u.sku FROM inventory_handover_units h JOIN inventory_units u ON u.id=h.unit_id AND u.client_id=h.client_id WHERE h.client_id=? AND h.batch_id=?',b.client_id,b.id).all();return {batch:b,orders,units};}
export async function warehouseOperation({env,clientId,storeId,me,actor,path,method,body,url}){
  const base='/api/inventory/unit-tracking';
  if(path===base+'/operations/approve'&&method==='POST')return approveStocktake({env,clientId,storeId,me,actor,body});
  if(path===base+'/returns/receive'&&method==='POST')return receivePartialReturn({env,clientId,storeId,me,actor,body});
  if(path===base+'/exchanges'&&method==='POST')return openExchange({env,clientId,storeId,me,actor,body});
  if(path===base+'/search'&&method==='GET'){
    const q=String(url.searchParams.get('q')||'').trim();if(!q)reject('SEARCH_REQUIRED','اكتب الرقم أو امسح الكود',400);const code=decodeUnitCode(q);
    const {results:units=[]}=await statement(env,"SELECT u.unit_code,u.product_name,u.sku,u.status,u.current_order_id,u.last_order_id FROM inventory_units u WHERE u.client_id=? AND (? IS NULL OR u.store_id=?) AND (u.unit_code=? OR u.sku=? OR u.current_order_id=? OR u.last_order_id=? OR EXISTS(SELECT 1 FROM orders o WHERE o.client_id=u.client_id AND o.store_id IS u.store_id AND (o.id=u.current_order_id OR o.id=u.last_order_id) AND (o.awb=? OR o.ref=?))) LIMIT 100",clientId,storeId,storeId,code,q,q,q,q,q).all();return {ok:true,units};
  }
  if(path===base+'/order-scan/undo'&&method==='POST'){
    requirePermission(me,'orders','update');const u=await unit(env,clientId,storeId,body.code);if(String(u.current_order_id||'')!==String(body.orderId)||!['reserved','packed'].includes(u.status))reject('UNDO_NOT_ALLOWED','لا يمكن التراجع عن قطعة خرجت أو تخص طلبًا آخر');
    const s=await statement(env,"SELECT id FROM inventory_scan_sessions WHERE client_id=? AND order_id=? AND scan_context='packing' ORDER BY updated_at DESC LIMIT 1",clientId,body.orderId).first();if(!s)reject('SESSION_NOT_FOUND','جلسة التجهيز غير موجودة');
    await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND current_order_id=? AND status IN ('reserved','packed')) AND EXISTS(SELECT 1 FROM inventory_scan_events WHERE session_id=? AND unit_id=? AND result='accepted' AND scan_kind='unit')",[u.id,body.orderId,s.id,u.id]),statement(env,"UPDATE inventory_scan_events SET result='undone' WHERE session_id=? AND unit_id=? AND result='accepted' AND scan_kind='unit'",s.id,u.id),statement(env,"UPDATE inventory_units SET status='reserved',updated_at=? WHERE id=?",at(),u.id),statement(env,"UPDATE order_unit_allocations SET status='reserved',updated_at=? WHERE client_id=? AND order_id=? AND unit_id=?",at(),clientId,body.orderId,u.id),statement(env,"UPDATE inventory_scan_sessions SET status='open',completed_at=NULL,scanned_units=(SELECT COUNT(DISTINCT unit_id) FROM inventory_scan_events WHERE session_id=? AND result='accepted' AND scan_kind='unit'),updated_at=? WHERE id=?",s.id,at(),s.id),audit(env,u,'packing_scan_undone',actor,{sessionId:s.id},'reserved')]);return {ok:true};
  }
  if(path===base+'/order-scan/complete'&&method==='POST'){
    requirePermission(me,'orders','update');const o=assertUnitStore(await statement(env,'SELECT * FROM orders WHERE client_id=? AND id=?',clientId,body.orderId).first(),storeId);
    const s=await statement(env,"SELECT * FROM inventory_scan_sessions WHERE client_id=? AND order_id=? AND scan_context='packing' ORDER BY updated_at DESC LIMIT 1",clientId,o.id).first();
    if(!s||!s.expected_units||s.expected_units!==s.scanned_units)reject('PACKING_INCOMPLETE','لم يتم مسح جميع القطع');
    const {results:units=[]}=await statement(env,'SELECT u.* FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id AND u.client_id=a.client_id WHERE a.client_id=? AND a.order_id=?',clientId,o.id).all();
    if(units.length!==s.expected_units)reject('PACKING_CHANGED','مكونات الطلب تغيرت');
    const steps=[operationGuard(env,"EXISTS(SELECT 1 FROM orders WHERE client_id=? AND id=? AND state IN ('confirmed','preparing','shipped')) AND (SELECT COUNT(DISTINCT unit_id) FROM inventory_scan_events WHERE session_id=? AND scan_kind='unit' AND result='accepted')=?",[clientId,o.id,s.id,units.length])];
    for(const u of units){if(u.status==='packed')continue;steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND status='reserved' AND current_order_id=?)",[u.id,o.id]),statement(env,"UPDATE inventory_units SET status='packed',updated_at=? WHERE id=?",at(),u.id),statement(env,"UPDATE order_unit_allocations SET status='packed',updated_at=? WHERE client_id=? AND order_id=? AND unit_id=?",at(),clientId,o.id,u.id),audit(env,u,'packing_completed',actor,{sessionId:s.id,awb:o.awb||null},'packed'));}
    await atomic(env,steps);return {ok:true,status:'READY_FOR_HANDOVER'};
  }
  if(path===base+'/labels/jobs'&&method==='POST'){
    requirePermission(me,'inventory','print');
    const codes=[...new Set(body.codes||[])];if(!codes.length||codes.length>1000)reject('LABEL_LIMIT','اختر من 1 إلى 1000 قطعة',400);
    const rows=[];for(const code of codes)rows.push(await unit(env,clientId,storeId,code));
    const reason=String(body.reason||'').trim();const jobId=id('PRINT'),steps=[];
    for(const u of rows){const previous=await statement(env,'SELECT 1 n FROM inventory_label_job_units WHERE client_id=? AND unit_id=? LIMIT 1',clientId,u.id).first();if(previous){requirePermission(me,'inventory','reprint');if(!reason)reject('REPRINT_REASON_REQUIRED','سبب إعادة الطباعة مطلوب',400);}steps.push(operationGuard(env,'NOT EXISTS(SELECT 1 FROM inventory_label_job_units WHERE client_id=? AND unit_id=?) OR ?<>\'\'',[clientId,u.id,reason]),statement(env,'INSERT INTO inventory_label_job_units(job_id,client_id,unit_id,unit_code,is_reprint) SELECT ?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM inventory_label_job_units WHERE client_id=? AND unit_id=?) THEN 1 ELSE 0 END',jobId,clientId,u.id,u.unit_code,clientId,u.id),audit(env,u,previous?'label_reprint_requested':'label_print_requested',actor,{jobId,reason}));}
    await atomic(env,[statement(env,'INSERT INTO inventory_label_jobs(id,client_id,store_id,actor,reason,created_at) VALUES(?,?,?,?,?,?)',jobId,clientId,storeId,actor,reason,at()),...steps]);return {ok:true,jobId,count:rows.length};
  }
  if(path===base+'/handover'&&method==='POST'){
    requirePermission(me,'shipping','handover');
    const carrier=String(body.carrier||'J&T').trim();if(carrier!=='J&T')reject('CARRIER_UNSUPPORTED','J&T هي شركة الشحن المدعومة حاليًا',400);
    const batchId=id('HO');await statement(env,'INSERT INTO inventory_handover_batches(id,client_id,store_id,carrier,actor,courier,created_at) VALUES(?,?,?,?,?,?,?)',batchId,clientId,storeId,carrier,actor,String(body.courier||''),at()).run();return {ok:true,batchId};
  }
  if(path===base+'/handover/manifest'&&method==='GET')return {ok:true,...await manifest(env,await batch(env,clientId,storeId,url.searchParams.get('id')))};
  if(path===base+'/handover/scan'&&method==='POST'){
    requirePermission(me,'shipping','handover');const b=await batch(env,clientId,storeId,body.batchId);if(b.status!=='open')reject('HANDOVER_CLOSED','دفعة التسليم مغلقة');
    const o=assertUnitStore(await statement(env,'SELECT id,client_id,store_id,awb,state,history FROM orders WHERE client_id=? AND awb=?',clientId,String(body.code||'').trim()).first(),storeId);
    if(!o.awb)reject('WAYBILL_REQUIRED','البوليصة الرسمية مطلوبة');
    let carrierEvents=[];try{const parsed=JSON.parse(o.history||'[]');if(Array.isArray(parsed))carrierEvents=parsed;}catch{}
    if(!carrierEvents.some(e=>e?.type==='jt_shipment_created'&&String(e.awb||'')===o.awb)||!carrierEvents.some(e=>e?.type==='jt_label_printed'&&e.official===true&&String(e.awb||'')===o.awb))reject('JNT_OFFICIAL_WAYBILL_REQUIRED','البوليصة ليست بوليصة J&T رسمية تم إنشاؤها وطباعتها في النظام');
    const packed=await statement(env,"SELECT id,expected_units FROM inventory_scan_sessions WHERE client_id=? AND order_id=? AND scan_context='packing' AND status='completed' AND expected_units>0 AND expected_units=scanned_units ORDER BY updated_at DESC LIMIT 1",clientId,o.id).first();if(!packed)reject('SHIPMENT_NOT_READY','التجهيز غير مكتمل');
    const {results:units=[]}=await statement(env,"SELECT u.* FROM order_unit_allocations a JOIN inventory_units u ON u.id=a.unit_id AND u.client_id=a.client_id WHERE a.client_id=? AND a.order_id=? AND u.current_order_id=? AND u.status='packed'",clientId,o.id,o.id).all();
    if(!units.length||units.length!==packed.expected_units)reject('SHIPMENT_NOT_READY','عدد القطع المجهزة لا يطابق جلسة التجهيز');
    await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_handover_batches WHERE id=? AND status='open') AND NOT EXISTS(SELECT 1 FROM inventory_handover_orders h JOIN inventory_handover_batches b ON b.id=h.batch_id WHERE h.client_id=? AND h.order_id=? AND b.status IN ('open','completed'))",[b.id,clientId,o.id]),statement(env,'INSERT INTO inventory_handover_orders(batch_id,client_id,order_id,awb) VALUES(?,?,?,?)',b.id,clientId,o.id,o.awb),...units.map(u=>statement(env,'INSERT INTO inventory_handover_units(batch_id,client_id,order_id,unit_id,awb) VALUES(?,?,?,?,?)',b.id,clientId,o.id,u.id,o.awb))]);return {ok:true,...await manifest(env,b)};
  }
  if(path===base+'/handover/complete'&&method==='POST'){
    requirePermission(me,'shipping','handover');const b=await batch(env,clientId,storeId,body.batchId);if(b.status==='completed')return {ok:true,idempotent:true,...await manifest(env,b)};
    const {results:units=[]}=await statement(env,'SELECT u.*,h.awb,h.order_id FROM inventory_handover_units h JOIN inventory_units u ON u.id=h.unit_id AND u.client_id=h.client_id WHERE h.client_id=? AND h.batch_id=?',clientId,b.id).all();if(!units.length)reject('HANDOVER_EMPTY','دفعة التسليم فارغة');
    const steps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_handover_batches WHERE id=? AND status='open')",[b.id])];
    for(const u of units){steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id=? AND status='packed')",[u.id,clientId,u.order_id]),statement(env,"UPDATE inventory_units SET status='shipped',shipped_at=?,updated_at=? WHERE id=? AND client_id=?",at(),at(),u.id,clientId),statement(env,"UPDATE order_unit_allocations SET status='shipped',updated_at=? WHERE client_id=? AND order_id=? AND unit_id=?",at(),clientId,u.order_id,u.id),audit(env,u,'handed_to_shipping',actor,{batchId:b.id,awb:u.awb,carrier:b.carrier,courier:b.courier},'shipped'));}
    steps.push(...await exchangeHandoverStatements(env,clientId,units,actor),statement(env,"UPDATE inventory_handover_batches SET status='completed',completed_at=? WHERE id=?",at(),b.id));await atomic(env,steps);return {ok:true,...await manifest(env,{...b,status:'completed'})};
  }
  if(path===base+'/operations'&&method==='POST'){
    const kind=body.kind;if(!['stocktake','transfer'].includes(kind))reject('OPERATION_INVALID','عملية غير صحيحة',400);requirePermission(me,'inventory',kind);
    const source=String(body.warehouse||'Main'),location=String(body.location||''),target=String(body.targetWarehouse||''),targetLocation=String(body.targetLocation||'');if(kind==='transfer'&&(!target||(target===source&&targetLocation===location)))reject('TRANSFER_TARGET_REQUIRED','حدد موقع نقل مختلف',400);
    const sid=id(kind==='stocktake'?'COUNT':'TR'),steps=[statement(env,'INSERT INTO inventory_operation_sessions(id,client_id,store_id,kind,source_warehouse,source_location,target_warehouse,target_location,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',sid,clientId,storeId,kind,source,location,target,targetLocation,actor,at())];
    if(kind==='stocktake'){
      steps.push(statement(env,`INSERT INTO inventory_operation_units(session_id,unit_id,expected) SELECT ?,u.id,1 FROM inventory_units u LEFT JOIN inventory_unit_locations l ON l.unit_id=u.id AND l.client_id=u.client_id WHERE u.client_id=? AND (? IS NULL OR u.store_id=?) AND u.status IN (${physical.map(()=>'?').join(',')}) AND COALESCE(l.warehouse,'Main')=? AND (?='' OR COALESCE(l.location,'')=?)`,sid,clientId,storeId,storeId,...physical,source,location,location));
      steps.push(statement(env,"INSERT INTO inventory_count_baselines(session_id,unit_id,status,updated_at,warehouse,location) SELECT ?,u.id,u.status,u.updated_at,COALESCE(l.warehouse,'Main'),COALESCE(l.location,'') FROM inventory_operation_units x JOIN inventory_units u ON u.id=x.unit_id AND u.client_id=? LEFT JOIN inventory_unit_locations l ON l.unit_id=u.id AND l.client_id=u.client_id WHERE x.session_id=?",sid,clientId,sid));
    }
    await atomic(env,steps);return {ok:true,sessionId:sid};
  }
  if(path===base+'/operations/status'&&method==='GET'){
    const s=await session(env,clientId,storeId,url.searchParams.get('id'));requirePermission(me,'inventory','read');const {results:units=[]}=await statement(env,'SELECT x.*,u.unit_code,u.status,u.product_name FROM inventory_operation_units x JOIN inventory_units u ON u.id=x.unit_id AND u.client_id=? WHERE x.session_id=?',clientId,s.id).all();return {ok:true,session:s,units,missing:units.filter(u=>u.expected&&!u.scanned).length,unexpected:units.filter(u=>!u.expected&&u.scanned).length,wrongLocation:units.filter(u=>u.wrong_location).length};
  }
  if(path===base+'/operations/scan'&&method==='POST'){
    const s=await session(env,clientId,storeId,body.sessionId);requirePermission(me,'inventory',s.kind);const u=await unit(env,clientId,storeId,body.code),receiving=body.receive===true;
    if(s.kind==='stocktake'&&s.status!=='open'||s.kind==='transfer'&&s.status!==(receiving?'in_transit':'open'))reject('SESSION_CLOSED','العملية غير متاحة في هذه المرحلة');
    const loc=await statement(env,'SELECT warehouse,location FROM inventory_unit_locations WHERE unit_id=? AND client_id=?',u.id,clientId).first()||{warehouse:'Main',location:''};const wrong=loc.warehouse!==s.source_warehouse||(s.source_location&&loc.location!==s.source_location);
    if(s.kind==='stocktake'){await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_operation_sessions WHERE id=? AND status='open')",[s.id]),observation(env,s,u),statement(env,'INSERT INTO inventory_operation_units(session_id,unit_id,scanned,wrong_location) VALUES(?,?,1,?) ON CONFLICT(session_id,unit_id) DO UPDATE SET scanned=1,wrong_location=excluded.wrong_location',s.id,u.id,wrong?1:0),audit(env,u,'stocktake_scan',actor,{sessionId:s.id,wrongLocation:!!wrong})]);return {ok:true,wrongLocation:!!wrong};}
    if(receiving){await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_operation_units WHERE session_id=? AND unit_id=? AND scanned=1 AND received=0) AND EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND status='in_transfer') AND EXISTS(SELECT 1 FROM inventory_operation_sessions WHERE id=? AND status='in_transit')",[s.id,u.id,u.id,s.id]),...transferStock(env,u,1),statement(env,'INSERT INTO inventory_unit_locations(unit_id,client_id,store_id,warehouse,location) VALUES(?,?,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET warehouse=excluded.warehouse,location=excluded.location',u.id,clientId,u.store_id||null,s.target_warehouse,s.target_location||''),statement(env,"UPDATE inventory_units SET status='in_stock',updated_at=? WHERE id=?",at(),u.id),statement(env,'UPDATE inventory_operation_units SET received=1 WHERE session_id=? AND unit_id=?',s.id,u.id),audit(env,u,'transfer_received',actor,{sessionId:s.id},'in_stock')]);return {ok:true};}
    if(!sellable.has(u.status)||u.current_order_id||wrong)reject('TRANSFER_UNIT_UNAVAILABLE','القطعة غير متاحة في مصدر النقل');await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_operation_sessions WHERE id=? AND status='open')",[s.id]),statement(env,'INSERT INTO inventory_operation_units(session_id,unit_id,scanned) VALUES(?,?,1)',s.id,u.id),audit(env,u,'transfer_scan',actor,{sessionId:s.id})]);return {ok:true};
  }
  if(path===base+'/operations/complete'&&method==='POST'){
    const s=await session(env,clientId,storeId,body.sessionId);requirePermission(me,'inventory',s.kind);
    if(s.kind==='stocktake'){if(s.status!=='open')return {ok:true,idempotent:true};await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_operation_sessions WHERE id=? AND status='open')",[s.id]),statement(env,"UPDATE inventory_operation_sessions SET status='pending_approval',completed_at=? WHERE id=?",at(),s.id)]);return {ok:true,status:'pending_approval',stockChanged:false};}
    const {results:units=[]}=await statement(env,'SELECT u.*,x.received FROM inventory_operation_units x JOIN inventory_units u ON u.id=x.unit_id AND u.client_id=? WHERE x.session_id=? AND x.scanned=1',clientId,s.id).all();if(!units.length)reject('TRANSFER_EMPTY','لا توجد قطع للنقل');
    if(s.status==='in_transit'){if(units.some(u=>!u.received))reject('TRANSFER_INCOMPLETE','توجد قطع لم تصل بعد');await statement(env,"UPDATE inventory_operation_sessions SET status='completed',completed_at=? WHERE id=? AND status='in_transit'",at(),s.id).run();return {ok:true,status:'completed'};}
    if(s.status!=='open')reject('SESSION_CLOSED','العملية مغلقة');const steps=[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_operation_sessions WHERE id=? AND status='open')",[s.id])];for(const u of units)steps.push(operationGuard(env,"EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND client_id=? AND current_order_id IS NULL AND status IN ('in_stock','returned_in_stock'))",[u.id,clientId]),...transferStock(env,u,-1),statement(env,"UPDATE inventory_units SET status='in_transfer',updated_at=? WHERE id=?",at(),u.id),audit(env,u,'transfer_dispatched',actor,{sessionId:s.id},'in_transfer'));steps.push(statement(env,"UPDATE inventory_operation_sessions SET status='in_transit' WHERE id=?",s.id));await atomic(env,steps);return {ok:true,status:'in_transit'};
  }
  if(path===base+'/scrap'&&method==='POST'){
    requirePermission(me,'inventory','scrap');const u=await unit(env,clientId,storeId,body.code);if(!['quarantined','damaged','returned_pending_inspection'].includes(u.status))reject('SCRAP_STATE_INVALID','الهالك يحتاج قطعة في الفحص أو تالفة');const reason=String(body.reason||'').trim();if(!reason)reject('SCRAP_REASON_REQUIRED','سبب الهالك مطلوب',400);const requestId=id('SCRAP');await atomic(env,[statement(env,'INSERT INTO inventory_scrap_requests(id,client_id,store_id,unit_id,reason,requested_by,created_at) VALUES(?,?,?,?,?,?,?)',requestId,clientId,u.store_id||null,u.id,reason,actor,at()),audit(env,u,'scrap_requested',actor,{requestId,reason})]);return {ok:true,requestId};
  }
  if(path===base+'/scrap/approve'&&method==='POST'){
    requirePermission(me,'inventory.scrap','approve');const r=assertUnitStore(await statement(env,'SELECT * FROM inventory_scrap_requests WHERE id=? AND client_id=?',body.requestId,clientId).first(),storeId);if(r.requested_by===actor)reject('SCRAP_SEPARATE_APPROVER_REQUIRED','اعتماد الهالك يحتاج مستخدمًا آخر',403);if(r.status==='approved')return {ok:true,idempotent:true};const u=assertUnitStore(await statement(env,'SELECT * FROM inventory_units WHERE id=? AND client_id=?',r.unit_id,clientId).first(),storeId);
    await atomic(env,[operationGuard(env,"EXISTS(SELECT 1 FROM inventory_scrap_requests WHERE id=? AND status='pending') AND EXISTS(SELECT 1 FROM inventory_units WHERE id=? AND status IN ('quarantined','damaged','returned_pending_inspection'))",[r.id,u.id]),statement(env,"UPDATE inventory_units SET status='scrapped',current_order_id=NULL,updated_at=? WHERE id=?",at(),u.id),statement(env,"UPDATE inventory_scrap_requests SET status='approved',approved_by=?,approved_at=? WHERE id=?",actor,at(),r.id),audit(env,u,'scrap_approved',actor,{requestId:r.id,reason:r.reason},'scrapped')]);return {ok:true};
  }
  return null;
}
