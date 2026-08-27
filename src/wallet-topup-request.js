import {now,rid,round2} from './wallet-core.js';

function validateProofDataUrl(value){
  if(!value)return null;
  const s=String(value);
  if(!/^data:image\/(jpeg|png|webp);base64,/i.test(s))throw Object.assign(new Error('إثبات التحويل يجب أن يكون صورة JPG/PNG/WebP'),{status:400,code:'INVALID_PROOF'});
  if(s.length>450000)throw Object.assign(new Error('صورة التحويل كبيرة. اضغط الصورة لأقل من 330KB تقريبًا.'),{status:413,code:'PROOF_TOO_LARGE'});
  return s;
}

export async function requestTopup(env,clientId,body,actor){
  const amount=round2(body.amount);if(amount<=0)throw Object.assign(new Error('المبلغ لازم يكون أكبر من صفر'),{status:400});
  const phone=String(body.senderPhone||body.phone||'').replace(/\s+/g,'').trim();if(phone.length<8)throw Object.assign(new Error('رقم الهاتف المحوّل منه مطلوب'),{status:400});
  const proofDataUrl=validateProofDataUrl(body.proofDataUrl||null),proofUrl=body.proofUrl?String(body.proofUrl):null;
  if(!proofDataUrl&&!proofUrl)throw Object.assign(new Error('ارفع صورة إثبات التحويل'),{status:400,code:'PROOF_REQUIRED'});
  const id=rid('TOP'),ts=now();
  await env.DB.prepare(`INSERT INTO wallet_topup_requests
    (id,client_id,amount,currency,sender_phone,transfer_method,proof_data_url,proof_url,status,requested_by,requested_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,amount,String(body.currency||'EGP'),phone,String(body.transferMethod||'wallet_transfer'),proofDataUrl,proofUrl,'pending',actor||'',ts,JSON.stringify(body.metadata||{})).run();
  return {ok:true,id,status:'pending',amount};
}

export async function listTopups(env,clientId,{status=null,limit=100}={}){
  let sql='SELECT id,client_id,amount,currency,sender_phone,transfer_method,proof_data_url,proof_url,status,requested_by,requested_at,reviewed_by,reviewed_at,review_note,metadata_json FROM wallet_topup_requests WHERE client_id=?',binds=[clientId];
  if(status){sql+=' AND status=?';binds.push(status)}sql+=' ORDER BY requested_at DESC LIMIT ?';binds.push(Math.max(1,Math.min(300,Number(limit)||100)));
  const {results=[]}=await env.DB.prepare(sql).bind(...binds).all();return results;
}
