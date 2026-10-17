/*
 * Platform-admin J&T carrier ledger. Does not change orders or financial balances.
 * Carrier report import is not equivalent to a full J&T account API sync.
 */
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const clean=(v,max=250)=>String(v??'').trim().slice(0,max);
const STATES=['created','picked_up','in_transit','delivered','returned','cancelled','unknown'];
const iso=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v,20))?clean(v,20):null;
const amount=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?Math.round(n*100)/100:null;};
export function jntStatus(raw){
  const s=clean(raw,240).toLowerCase();
  if(/return|rts|reject|مرتجع|راجع|استرجاع|إرجاع|مرفوض/.test(s))return 'returned';
  if(/cancel|void|ملغي|إلغاء|الغاء/.test(s))return 'cancelled';
  if(/delivered|signed|تم التسليم|تم التوصيل|مستلم/.test(s))return 'delivered';
  if(/pickup|picked up|استلام المندوب|استلمت الشركة/.test(s))return 'picked_up';
  if(/transit|dispatch|shipping|shipped|out for delivery|in warehouse|في الطريق|جاري الشحن|التوزيع|في المخزن/.test(s))return 'in_transit';
  if(/create|new|pending|printed|تم إنشاء|تم انشاء|تم طباعة/.test(s))return 'created';
  return 'unknown';
}
export function normalizeJntShipment(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const awb=clean(row.awb||row.waybill||row.billCode||row.Waybill,110);
  if(!awb||!/^[\p{L}\p{N}._/-]{3,110}$/u.test(awb))return null;
  const rawStatus=clean(row.rawStatus||row.status||row.waybillStatus,240);
  return {
    account:clean(row.account||row.customerCode||'J&T',100),
    awb,source:'jt_sheet',orderRef:clean(row.orderRef||row.clientOrderNo,150),
    shipmentDate:iso(row.shipmentDate||row.date),lastEventAt:clean(row.lastEventAt,35)||null,
    status:STATES.includes(row.normalizedStatus)?row.normalizedStatus:jntStatus(rawStatus),
    rawStatus,sender:clean(row.sender||row.senderName,180),
    receiverProvince:clean(row.receiverProvince,160),
    codAmount:amount(row.codAmount),collectedAmount:amount(row.collectedAmount),
    shippingFee:amount(row.shippingFee),returnReason:clean(row.returnReason,700),
    sourceFile:clean(row.sourceFile,180)
  };
}
async function auth(request,delegate){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await delegate.fetch(new Request(u.toString(),{method:'GET',headers:request.headers}));
  if(!r.ok)return {error:json({error:'محتاج تسجيل الدخول',code:'AUTH_REQUIRED'},401)};
  const me=await r.json().catch(()=>({}));
  if(me?.role!=='admin')return {error:json({error:'القسم خاص بإدارة المنصة فقط',code:'ADMIN_ONLY'},403)};
  return {me};
}
async function ensure(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS admin_jnt_shipments (account TEXT NOT NULL, awb TEXT NOT NULL, source TEXT NOT NULL, order_ref TEXT, shipment_date TEXT, last_event_at TEXT, status TEXT NOT NULL, raw_status TEXT, sender TEXT, receiver_province TEXT, cod_amount REAL, collected_amount REAL, shipping_fee REAL, return_reason TEXT, source_file TEXT, imported_at TEXT NOT NULL, PRIMARY KEY(account, awb))').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_jnt_shipments_date ON admin_jnt_shipments(shipment_date)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_jnt_shipments_status ON admin_jnt_shipments(status)').run();
}
function filters(u){
  const where=[],bind=[];
  const status=clean(u.searchParams.get('status'),30),from=iso(u.searchParams.get('from')),to=iso(u.searchParams.get('to')),sender=clean(u.searchParams.get('sender'),180),q=clean(u.searchParams.get('q'),110);
  if(status&&STATES.includes(status)){where.push('s.status=?');bind.push(status);}
  if(from){where.push('s.shipment_date>=?');bind.push(from);}
  if(to){where.push('s.shipment_date<=?');bind.push(to);}
  if(sender){where.push('s.sender=?');bind.push(sender);}
  if(q){const like='%'+q.replace(/[%_]/g,'')+'%';where.push('(s.awb LIKE ? OR s.order_ref LIKE ?)');bind.push(like,like);}
  return {sql:where.length?'WHERE '+where.join(' AND '):'',bind};
}
const COLS='s.account,s.awb,s.order_ref AS orderRef,s.shipment_date AS shipmentDate,s.last_event_at AS lastEventAt,s.status,s.raw_status AS rawStatus,s.sender,s.receiver_province AS receiverProvince,s.cod_amount AS codAmount,s.collected_amount AS collectedAmount,s.shipping_fee AS shippingFee,s.return_reason AS returnReason,s.source_file AS sourceFile,s.imported_at AS importedAt,EXISTS(SELECT 1 FROM orders o WHERE o.awb=s.awb) AS linkedToKun';
async function list(db,u){
  const {sql,bind}=filters(u);
  const limit=Math.min(300,Math.max(1,parseInt(u.searchParams.get('limit'),10)||100));
  const offset=Math.min(10000000,Math.max(0,parseInt(u.searchParams.get('offset'),10)||0));
  const [page,summary,senders]=await Promise.all([
    db.prepare('SELECT '+COLS+' FROM admin_jnt_shipments s '+sql+' ORDER BY COALESCE(s.shipment_date,substr(s.imported_at,1,10)) DESC,s.awb DESC LIMIT ? OFFSET ?').bind(...bind,limit,offset).all(),
    db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS created,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS pickedUp,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS transit,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS returned,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS cancelled,SUM(CASE WHEN s.status=? THEN 1 ELSE 0 END) AS unknown,COALESCE(SUM(s.cod_amount),0) AS codExpected,COALESCE(SUM(s.collected_amount),0) AS codReportedCollected,COALESCE(SUM(s.shipping_fee),0) AS shippingFees,SUM(CASE WHEN EXISTS(SELECT 1 FROM orders o WHERE o.awb=s.awb) THEN 1 ELSE 0 END) AS linkedToKun FROM admin_jnt_shipments s '+sql).bind(...STATES,...bind).first(),
    db.prepare('SELECT sender,COUNT(*) AS count FROM admin_jnt_shipments WHERE sender IS NOT NULL AND sender<>? GROUP BY sender ORDER BY count DESC LIMIT 100').bind('').all()
  ]);
  return json({ok:true,source:'jt_sheet',isCompleteCarrierHistory:false,
    completenessNotice:'هذه الشحنات واردة من كشوف J&T المستوردة فقط. جميع شحنات الحساب تحتاج تصدير كشف كامل من الشركة أو صلاحية API لسرد كل البوالص.',
    total:Number(summary?.total||0),summary:summary||{},senders:senders.results||[],
    items:(page.results||[]).map(x=>({...x,linkedToKun:Boolean(x.linkedToKun)})),limit,offset});
}
async function importRows(db,request){
  if(Number(request.headers.get('content-length')||0)>2000000)return json({error:'الدفعة أكبر من الحد المسموح'},413);
  const data=await request.json().catch(()=>null);
  if(!data||!Array.isArray(data.rows)||data.rows.length<1||data.rows.length>200)return json({error:'أرسل 1 إلى 200 شحنة بكل دفعة',code:'INVALID_BATCH'},400);
  const rows=[],bad=[];
  for(let i=0;i<data.rows.length;i++){const r=normalizeJntShipment(data.rows[i]);if(r)rows.push(r);else bad.push(i+1);}
  if(!rows.length)return json({error:'لا توجد أرقام بوالص صالحة',invalidRowIndices:bad.slice(0,20)},400);
  const columns='account,awb,source,order_ref,shipment_date,last_event_at,status,raw_status,sender,receiver_province,cod_amount,collected_amount,shipping_fee,return_reason,source_file,imported_at';
  const updates='source=excluded.source,order_ref=excluded.order_ref,shipment_date=COALESCE(excluded.shipment_date,admin_jnt_shipments.shipment_date),last_event_at=COALESCE(excluded.last_event_at,admin_jnt_shipments.last_event_at),status=excluded.status,raw_status=excluded.raw_status,sender=excluded.sender,receiver_province=excluded.receiver_province,cod_amount=COALESCE(excluded.cod_amount,admin_jnt_shipments.cod_amount),collected_amount=COALESCE(excluded.collected_amount,admin_jnt_shipments.collected_amount),shipping_fee=COALESCE(excluded.shipping_fee,admin_jnt_shipments.shipping_fee),return_reason=excluded.return_reason,source_file=excluded.source_file,imported_at=excluded.imported_at';
  const stmt='INSERT INTO admin_jnt_shipments ('+columns+') VALUES ('+Array(16).fill('?').join(',')+') ON CONFLICT(account,awb) DO UPDATE SET '+updates;
  const stamp=new Date().toISOString();
  await db.batch(rows.map(r=>db.prepare(stmt).bind(r.account,r.awb,r.source,r.orderRef,r.shipmentDate,r.lastEventAt,r.status,r.rawStatus,r.sender,r.receiverProvince,r.codAmount,r.collectedAmount,r.shippingFee,r.returnReason,r.sourceFile,stamp)));
  return json({ok:true,processed:rows.length,rejected:bad.length,invalidRowIndices:bad.slice(0,20)});
}
export async function handleAdminJntShipments({request,env,delegate}){
  const u=new URL(request.url);
  if(u.pathname!=='/api/admin/jnt-shipments')return null;
  if(request.method!=='GET'&&request.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const identity=await auth(request,delegate);
    if(identity.error)return identity.error;
    if(!env?.DB)return json({error:'قاعدة بيانات التقارير غير متاحة',code:'DATABASE_UNAVAILABLE'},503);
    await ensure(env.DB);
    return request.method==='POST'?importRows(env.DB,request):list(env.DB,u);
  }catch(e){
    console.error('[admin-jnt-shipments]',e?.code||e?.name||'error');
    return json({error:'تعذر قراءة تقرير J&T. راجع إعدادات قاعدة البيانات.',code:'JNT_LEDGER_ERROR'},503);
  }
}
