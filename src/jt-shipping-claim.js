// Durable, fail-closed J&T create guard. No new D1 tables or live dependencies.
// A claim is NEVER automatically expired: a timed-out carrier request may still
// have created a live shipment. Retry must read J&T first, not issue addOrder.
const err=(message,code)=>Object.assign(new Error(message),{status:409,code});
const historyOf=value=>{try{const v=typeof value==='string'?JSON.parse(value||'[]'):value;return Array.isArray(v)?v:[];}catch{return [];}};
const active=value=>{const a=historyOf(value);const n=a.findLastIndex(x=>x?.type==='jt_print_voided');return n<0?a:a.slice(n+1);};
const arraySql="CASE WHEN json_valid(history) AND json_type(history)='array' THEN history ELSE '[]' END";

export function pendingJtCreateClaim(history){
  return [...active(history)].reverse().find(e=>e?.type==='jt_create_claimed')||null;
}

export async function claimJtCreate(db,row,txlogisticId){
  if(pendingJtCreateClaim(row.history))throw err('تم بدء إصدار الشحنة بالفعل. لا يمكن تكرار طلب إنشاء J&T قبل مراجعة رقم البوليصة.','JT_CREATE_RECOVERY_REQUIRED');
  const claim={type:'jt_create_claimed',claimId:crypto.randomUUID(),txlogisticId,at:new Date().toISOString(),provider:'jt'};
  // One atomic D1 compare-and-swap across ALL devices/Worker instances.
  // history IS ? is a null-safe exact-value comparison in SQLite/D1.
  const result=await db.prepare(`UPDATE orders SET history=json_insert(${arraySql},'$[#]',json(?))
    WHERE id=? AND client_id=? AND history IS ? AND COALESCE(awb,'')=''
      AND state IN ('confirmed','preparing')`)
    .bind(JSON.stringify(claim),row.id,row.client_id,row.history??null).run();
  if((result.meta?.changes??0)!==1)throw err('تغير الأوردر أو بدأ موظف آخر إصدار الشحنة. حدّث الطلب ولا تعاود الإنشاء قبل التحقق.','JT_CREATE_CLAIM_CONFLICT');
  return claim;
}

export async function persistJtClaimAwb(db,row,claim,awb){
  if(!claim?.claimId||!awb)throw err('رقم البوليصة أو إثبات حجز الإنشاء غير موجود.','JT_CREATE_PROOF_MISSING');
  const result=await db.prepare(`UPDATE orders SET awb=? WHERE id=? AND client_id=?
    AND COALESCE(awb,'')='' AND state IN ('confirmed','preparing')
    AND EXISTS (SELECT 1 FROM json_each(${arraySql}) AS entry
      WHERE json_extract(entry.value,'$.type')='jt_create_claimed'
        AND json_extract(entry.value,'$.claimId')=?)`)
    .bind(awb,row.id,row.client_id,claim.claimId).run();
  if((result.meta?.changes??0)!==1)throw err('أنشأت J&T بوليصة لكن تعذر حفظها بسبب تغيير متزامن؛ لا تنشئ أخرى، راجع الشحنة أولًا.','JT_AWB_PERSIST_CONFLICT');
}

export async function finalizeJtOfficialLabel(db,row,{awb,sortingCode='',txlogisticId='',printedAt,printedBy='',shipmentCreatedNow=false}){
  if(!awb||!printedAt)throw err('لا يجوز تغيير حالة الطلب دون إثبات البوليصة الرسمية.','JT_LABEL_PROOF_REQUIRED');
  const label={type:'jt_label_printed',at:printedAt,provider:'jt',awb,sortingCode,txlogisticId,printedAt,printedBy,confirmed:true,official:true,shipmentCreatedNow};
  const handoff={type:'jt_handoff_shipped',at:printedAt,provider:'jt',awb,sortingCode,txlogisticId,from:'printing',state:'shipped'};
  // Atomic history+state update: a crash can never write proof without state.
  const result=await db.prepare(`UPDATE orders SET state='shipped',checkpoint='جاري الشحن',
    history=json_insert(${arraySql},'$[#]',json(?),'$[#]',json(?))
    WHERE id=? AND client_id=? AND COALESCE(awb,'')=? AND state IN ('confirmed','preparing')`)
    .bind(JSON.stringify(label),JSON.stringify(handoff),row.id,row.client_id,awb).run();
  if((result.meta?.changes??0)!==1)throw err('تم إصدار البوليصة لكن حالة الأوردر تغيرت بالتزامن؛ راجع السجل قبل المتابعة.','JT_HANDOFF_STATE_CONFLICT');
  return {label,handoff};
}

export async function repairJtPrintedState(db,row){
  const printed=[...active(row.history)].reverse().find(e=>e?.type==='jt_label_printed'&&e?.official===true&&e?.awb===row.awb);
  if(!printed||!row.awb||!['confirmed','preparing'].includes(row.state))return false;
  const event={type:'jt_handoff_shipped',at:new Date().toISOString(),provider:'jt',awb:row.awb,recovered:true,source:'legacy-label-repair',state:'shipped'};
  const result=await db.prepare(`UPDATE orders SET state='shipped',checkpoint='جاري الشحن',
    history=json_insert(${arraySql},'$[#]',json(?))
    WHERE id=? AND client_id=? AND COALESCE(awb,'')=? AND state IN ('confirmed','preparing')`)
    .bind(JSON.stringify(event),row.id,row.client_id,row.awb).run();
  if((result.meta?.changes??0)!==1)throw err('تغير الأوردر أثناء استكمال حالة البوليصة القديمة؛ راجع الحالة.','JT_LABEL_REPAIR_CONFLICT');
  return true;
}
