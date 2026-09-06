import {now,rid,round2,ensureWalletAccount,mirrorLegacyBalance} from './wallet-core.js';

export async function listPendingTopupsAdmin(env,limit=200){
  const {results=[]}=await env.DB.prepare("SELECT id,client_id,amount,currency,sender_phone,transfer_method,proof_data_url,proof_url,status,requested_by,requested_at FROM wallet_topup_requests WHERE status='pending' ORDER BY requested_at ASC LIMIT ?").bind(Math.max(1,Math.min(500,Number(limit)||200))).all();
  return results;
}

export async function approveTopup(env,topupId,actor,note=''){
  const row=await env.DB.prepare("SELECT * FROM wallet_topup_requests WHERE id=? AND status='pending'").bind(topupId).first();
  if(!row)throw Object.assign(new Error('طلب الشحن غير موجود أو تمت مراجعته بالفعل'),{status:409,code:'TOPUP_NOT_PENDING'});
  const account=await ensureWalletAccount(env,row.client_id),logId=rid('WLG'),ts=now(),key=`topup:${topupId}`;
  try{
    await env.DB.batch([
      env.DB.prepare('UPDATE wallet_accounts SET balance=ROUND(balance+?,2),updated_at=? WHERE client_id=?').bind(row.amount,ts,row.client_id),
      env.DB.prepare(`INSERT INTO wallet_log (id,client_id,store_id,type,amount,balance_after,note,created_at,created_by,reference_type,reference_id,idempotency_key,metadata_json)
        SELECT ?,?,NULL,'topup',?,balance,?,?,?,?,?,?,? FROM wallet_accounts WHERE client_id=?`)
        .bind(logId,row.client_id,row.amount,`شحن محفظة معتمد — ${topupId}`,ts,actor||'admin','topup_request',topupId,key,JSON.stringify({senderPhone:row.sender_phone,transferMethod:row.transfer_method}),row.client_id),
      env.DB.prepare("UPDATE wallet_topup_requests SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").bind(actor||'admin',ts,String(note||''),topupId)
    ]);
  }catch(error){
    if(/idx_wallet_log_idempotency|UNIQUE constraint failed/i.test(String(error?.message||error)))throw Object.assign(new Error('تم اعتماد طلب الشحن بالفعل'),{status:409,code:'TOPUP_ALREADY_APPLIED'});
    throw error;
  }
  const updated=await env.DB.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').bind(row.client_id).first();
  await mirrorLegacyBalance(env,row.client_id,updated?.balance||0);
  return {ok:true,id:topupId,clientId:row.client_id,balance:round2(updated?.balance),previousBalance:round2(account.balance)};
}

export async function rejectTopup(env,topupId,actor,note=''){
  const ts=now();const result=await env.DB.prepare("UPDATE wallet_topup_requests SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").bind(actor||'admin',ts,String(note||''),topupId).run();
  if(!result?.meta?.changes)throw Object.assign(new Error('طلب الشحن غير موجود أو تمت مراجعته بالفعل'),{status:409,code:'TOPUP_NOT_PENDING'});
  return {ok:true,id:topupId,status:'rejected'};
}
