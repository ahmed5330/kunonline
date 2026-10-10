import {now,rid,round2,ensureWalletAccount,mirrorLegacyBalance} from './wallet-core.js';

async function appliedTopupCredit(env,clientId,topupId){
  return env.DB.prepare("SELECT id,amount,balance_after,created_at FROM wallet_log WHERE client_id=? AND reference_type='topup_request' AND reference_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(clientId,topupId).first();
}

export async function listPendingTopupsAdmin(env,limit=200){
  const {results=[]}=await env.DB.prepare(`SELECT id,client_id,amount,currency,sender_phone,transfer_method,status,requested_by,requested_at,
    CASE WHEN COALESCE(proof_data_url,'')<>'' OR COALESCE(proof_url,'')<>'' THEN 1 ELSE 0 END has_proof
    FROM wallet_topup_requests WHERE status='pending' ORDER BY requested_at ASC LIMIT ?`)
    .bind(Math.max(1,Math.min(500,Number(limit)||200))).all();
  return results;
}

export async function getPendingTopupProofAdmin(env,topupId){
  const row=await env.DB.prepare(`SELECT id,client_id,amount,currency,sender_phone,transfer_method,status,requested_by,requested_at,
    proof_data_url,proof_url
    FROM wallet_topup_requests WHERE id=? LIMIT 1`).bind(topupId).first();
  if(!row)throw Object.assign(new Error('طلب الشحن غير موجود'),{status:404,code:'TOPUP_NOT_FOUND'});
  return row;
}

async function afterTopupSettlement(env,clientId){
  try{
    return {access:await (await import('./subscription-billing.js')).reconcileSubscriptionAfterTopup(env,clientId),settlementPending:false};
  }catch(error){
    // Payment is already credited, so never claim activation or ask the user
    // to approve the same transfer again. Surface incomplete billing explicitly.
    return {access:null,settlementPending:true,settlementErrorCode:String(error?.code||'BILLING_SETTLEMENT_RETRY')};
  }
}
export async function approveTopup(env,topupId,actor,note='',options={}){
  const row=await env.DB.prepare("SELECT * FROM wallet_topup_requests WHERE id=?").bind(topupId).first();
  if(!row)throw Object.assign(new Error('طلب الشحن غير موجود'),{status:404,code:'TOPUP_NOT_FOUND'});

  if(String(row.status)==='approved'){
    const applied=await appliedTopupCredit(env,row.client_id,topupId);
    if(!applied){
      throw Object.assign(new Error('طلب التحويل معلّم كمعتمد لكن لا يوجد قيد رصيد مطابق. يحتاج مراجعة/إصلاح إداري قبل اعتباره مشحونًا.'),{
        status:409,code:'TOPUP_APPROVAL_INTEGRITY',clientId:row.client_id,topupId
      });
    }
    const account=await ensureWalletAccount(env,row.client_id);
    const {access,settlementPending,settlementErrorCode}=await afterTopupSettlement(env,row.client_id);
    return {
      ok:true,alreadyApproved:true,id:topupId,clientId:row.client_id,status:'approved',
      requestedAmount:round2(row.amount),creditedAmount:round2(applied.amount),
      balanceAfterCredit:round2(applied.balance_after),balance:round2((await ensureWalletAccount(env,row.client_id)).balance),settlementPending,settlementErrorCode,
      currency:account.currency||row.currency||'EGP',access
    };
  }
  if(String(row.status)!=='pending'){
    throw Object.assign(new Error(`طلب الشحن حالته الحالية: ${row.status||'غير معروفة'}`),{status:409,code:'TOPUP_NOT_PENDING'});
  }

  // Legacy/partial-safety guard: if a credit ledger already exists for a still-pending
  // request, never add the money again. Heal only the request status.
  const existingCredit=await appliedTopupCredit(env,row.client_id,topupId);
  if(existingCredit){
    const ts=now();
    await env.DB.prepare("UPDATE wallet_topup_requests SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'")
      .bind(actor||'admin',ts,String(note||'Recovered existing wallet credit'),topupId).run();
    const account=await ensureWalletAccount(env,row.client_id);
    const {access,settlementPending,settlementErrorCode}=await afterTopupSettlement(env,row.client_id);
    return {
      ok:true,alreadyApproved:true,recoveredRequestState:true,id:topupId,clientId:row.client_id,status:'approved',
      requestedAmount:round2(row.amount),creditedAmount:round2(existingCredit.amount),
      balanceAfterCredit:round2(existingCredit.balance_after),balance:round2((await ensureWalletAccount(env,row.client_id)).balance),settlementPending,settlementErrorCode,
      currency:account.currency||row.currency||'EGP',access
    };
  }

  const requestedAmount=round2(row.amount);
  const requestedCredit=options?.creditAmount===undefined||options?.creditAmount===null||options?.creditAmount===''?requestedAmount:options.creditAmount;
  const creditedAmount=round2(requestedCredit);
  if(!Number.isFinite(Number(requestedCredit))||creditedAmount<=0){
    throw Object.assign(new Error('المبلغ الذي سيتم إضافته لازم يكون أكبر من صفر'),{status:400,code:'TOPUP_CREDIT_AMOUNT_INVALID'});
  }

  const account=await ensureWalletAccount(env,row.client_id),logId=rid('WLG'),ts=now(),key=`topup:${topupId}`;
  const metadata={
    senderPhone:row.sender_phone,
    transferMethod:row.transfer_method,
    requestedAmount,
    creditedAmount,
    adjustedByAdmin:creditedAmount!==requestedAmount
  };
  try{
    await env.DB.batch([
      env.DB.prepare('UPDATE wallet_accounts SET balance=ROUND(balance+?,2),updated_at=? WHERE client_id=?').bind(creditedAmount,ts,row.client_id),
      env.DB.prepare(`INSERT INTO wallet_log (id,client_id,store_id,type,amount,balance_after,note,created_at,created_by,reference_type,reference_id,idempotency_key,metadata_json)
        SELECT ?,?,NULL,'topup',?,balance,?,?,?,?,?,?,? FROM wallet_accounts WHERE client_id=?`)
        .bind(logId,row.client_id,creditedAmount,`شحن محفظة معتمد — ${topupId}`,ts,actor||'admin','topup_request',topupId,key,JSON.stringify(metadata),row.client_id),
      env.DB.prepare("UPDATE wallet_topup_requests SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'")
        .bind(actor||'admin',ts,String(note||''),topupId)
    ]);
  }catch(error){
    if(/idx_wallet_log_idempotency|UNIQUE constraint failed/i.test(String(error?.message||error))){
      const applied=await appliedTopupCredit(env,row.client_id,topupId);
      const current=await ensureWalletAccount(env,row.client_id);
      return {
        ok:true,alreadyApproved:true,id:topupId,clientId:row.client_id,status:'approved',
        requestedAmount,creditedAmount:round2(applied?.amount??creditedAmount),
        balanceAfterCredit:round2(applied?.balance_after??current.balance),balance:round2(current.balance),
        currency:current.currency||row.currency||'EGP'
      };
    }
    throw error;
  }

  const applied=await appliedTopupCredit(env,row.client_id,topupId);
  if(!applied||round2(applied.amount)!==creditedAmount){
    throw Object.assign(new Error('تعذر تأكيد قيد الشحن في سجل المحفظة بعد الاعتماد'),{
      status:500,code:'TOPUP_LEDGER_VERIFY_FAILED',clientId:row.client_id,topupId
    });
  }
  const credited=await env.DB.prepare('SELECT balance,currency FROM wallet_accounts WHERE client_id=?').bind(row.client_id).first();
  await mirrorLegacyBalance(env,row.client_id,credited?.balance||0);

  // Approval credits exactly the admin-confirmed amount. Do not silently consume it
  // against old pending order rows inside the approval action.
  const {access,settlementPending,settlementErrorCode}=await afterTopupSettlement(env,row.client_id);

  const final=await env.DB.prepare('SELECT balance,currency FROM wallet_accounts WHERE client_id=?').bind(row.client_id).first();
  await mirrorLegacyBalance(env,row.client_id,final?.balance||0);
  return {
    ok:true,alreadyApproved:false,id:topupId,clientId:row.client_id,status:'approved',
    requestedAmount,creditedAmount,previousBalance:round2(account.balance),settlementPending,settlementErrorCode,
    balanceAfterCredit:round2(credited?.balance),balance:round2(final?.balance),
    currency:final?.currency||row.currency||'EGP',access
  };
}

export async function rejectTopup(env,topupId,actor,note=''){
  const ts=now();const result=await env.DB.prepare("UPDATE wallet_topup_requests SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").bind(actor||'admin',ts,String(note||''),topupId).run();
  if(!result?.meta?.changes)throw Object.assign(new Error('طلب الشحن غير موجود أو تمت مراجعته بالفعل'),{status:409,code:'TOPUP_NOT_PENDING'});
  return {ok:true,id:topupId,status:'rejected'};
}
