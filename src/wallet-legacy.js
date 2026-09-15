import {now,rid,round2,ensureWalletAccount,mirrorLegacyBalance} from './wallet-core.js';

export async function adminCreditWallet(env,clientId,amount,actor='admin',note='Manual admin credit'){
  amount=round2(amount);if(amount<=0)throw Object.assign(new Error('المبلغ لازم يكون أكبر من صفر'),{status:400});
  await ensureWalletAccount(env,clientId);const ts=now(),logId=rid('WLG'),key=`admin-credit:${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare('UPDATE wallet_accounts SET balance=ROUND(balance+?,2),updated_at=? WHERE client_id=?').bind(amount,ts,clientId),
    env.DB.prepare(`INSERT INTO wallet_log (id,client_id,store_id,type,amount,balance_after,note,created_at,created_by,reference_type,reference_id,idempotency_key,metadata_json)
      SELECT ?,?,NULL,'topup',?,balance,?,?,?,?,?,?,? FROM wallet_accounts WHERE client_id=?`)
      .bind(logId,clientId,amount,String(note||'Manual admin credit'),ts,actor,'admin_adjustment',logId,key,JSON.stringify({source:'admin_direct'}),clientId)
  ]);
  const row=await env.DB.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').bind(clientId).first();await mirrorLegacyBalance(env,clientId,row?.balance||0);return {ok:true,clientId,balance:round2(row?.balance),walletLogId:logId};
}

export async function sanitizeLegacyStateBilling(env,state){
  if(!state||!Array.isArray(state.clients))return state;
  const {results=[]}=await env.DB.prepare("SELECT client_id,balance FROM wallet_accounts WHERE billing_version='v27'").all();
  const map=new Map(results.map(x=>[String(x.client_id),x]));
  for(const c of state.clients||[]){const account=map.get(String(c.id));if(!account)continue;c.walletFeePerOrder=0;c.walletBalance=round2(account.balance);}
  return state;
}


export async function syncLegacyBillingMirrors(env){
  const {results=[]}=await env.DB.prepare("SELECT client_id,balance FROM wallet_accounts WHERE billing_version='v27'").all();
  const outcomes=[];for(const row of results){try{outcomes.push({clientId:row.client_id,ok:await mirrorLegacyBalance(env,row.client_id,row.balance,{disableLegacyFee:true})})}catch(error){outcomes.push({clientId:row.client_id,ok:false,error:String(error?.message||error)})}}return outcomes;
}
