import {subscriptionOrderFee} from './subscription-billing.js';
import {now,rid,round2,ensureWalletAccount,mirrorLegacyBalance} from './wallet-core.js';

async function billingStartAt(env,clientId){
  const paid=await env.DB.prepare("SELECT created_at FROM audit_log WHERE client_id=? AND action='subscription.billing.start' ORDER BY created_at ASC LIMIT 1").bind(clientId).first();
  if(paid?.created_at)return String(paid.created_at);
  const migrated=await env.DB.prepare("SELECT created_at FROM audit_log WHERE client_id=? AND action='wallet.billing.migrate' ORDER BY created_at ASC LIMIT 1").bind(clientId).first();
  return migrated?.created_at?String(migrated.created_at):null;
}
function orderBeforeBillingStart(order,startAt,cutoffRowid){
  if(!startAt)return Number(order.order_rowid)<=Number(cutoffRowid||0);
  const source=String(order.date||order.created_at||'').trim();
  const orderDay=/^\d{4}-\d{2}-\d{2}/.test(source)?source.slice(0,10):'';
  const startDay=/^\d{4}-\d{2}-\d{2}/.test(startAt)?startAt.slice(0,10):'';
  if(orderDay&&startDay){
    if(orderDay<startDay)return true;
    if(orderDay>startDay)return false;
    const sourceHasTime=/T\d{2}:\d{2}/.test(source)||/ \d{2}:\d{2}/.test(source);
    if(sourceHasTime){
      const orderTs=Date.parse(source),startTs=Date.parse(startAt);
      if(Number.isFinite(orderTs)&&Number.isFinite(startTs))return orderTs<startTs;
    }
    return Number(order.order_rowid)<=Number(cutoffRowid||0);
  }
  return Number(order.order_rowid)<=Number(cutoffRowid||0);
}
async function waivePreBillingOrder(env,order,reason='PRE_BILLING_DATE'){
  const ts=now();
  await env.DB.prepare(`INSERT INTO order_billing (order_id,client_id,store_id,fee,status,attempts,last_error,created_at,charged_at,updated_at)
    VALUES (?,?,?,?, 'waived',1,?,?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET fee=0,status='waived',last_error=excluded.last_error,charged_at=COALESCE(order_billing.charged_at,excluded.charged_at),updated_at=excluded.updated_at`)
    .bind(order.id,order.client_id,order.store_id||null,0,reason,ts,ts,ts).run();
  return {ok:true,status:'waived',fee:0,skipped:'pre_billing_date'};
}

export async function billOrder(env,orderId,{allowBacklogCharge=false}={}){
  const order=await env.DB.prepare('SELECT rowid AS order_rowid,id,client_id,store_id,date,created_at FROM orders WHERE id=?').bind(orderId).first();
  if(!order)return {ok:false,skipped:'order_not_found'};
  const account=await ensureWalletAccount(env,order.client_id);
  if(account.billing_version!=='v27'||account.status!=='active')return {ok:true,skipped:'billing_not_v27'};
  const existing=await env.DB.prepare('SELECT * FROM order_billing WHERE order_id=?').bind(orderId).first();
  if(existing?.status==='charged'||existing?.status==='waived')return {ok:true,status:existing.status,fee:Number(existing.fee)||0};
  // Existing uncollected debt must not be retried just because an integration
  // sends an order update after the merchant tops up. Require explicit review.
  if(existing&&!allowBacklogCharge)return {ok:false,status:existing.status,fee:round2(existing.fee),code:'BACKLOG_REQUIRES_REVIEW'};
  const startedAt=await billingStartAt(env,order.client_id);
  if(orderBeforeBillingStart(order,startedAt,account.billing_start_rowid))return waivePreBillingOrder(env,order,'PRE_BILLING_DATE');
  const fee=await subscriptionOrderFee(env,order.client_id),ts=now();
  if(fee<=0){
    await env.DB.prepare(`INSERT INTO order_billing (order_id,client_id,store_id,fee,status,attempts,created_at,charged_at,updated_at)
      VALUES (?,?,?,?, 'waived',1,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status='waived',fee=0,updated_at=excluded.updated_at`)
      .bind(orderId,order.client_id,order.store_id||null,0,ts,ts,ts).run();
    return {ok:true,status:'waived',fee:0};
  }
  if(!allowBacklogCharge){
    const recovered=await env.DB.prepare(`SELECT id FROM wallet_log
      WHERE client_id=? AND type='topup'
        AND datetime(created_at)>=datetime(?) LIMIT 1`)
      .bind(order.client_id,order.created_at||order.date||'').first();
    if(recovered){
      // Imported/historical order predates recovery from a depleted balance.
      // Record it as pending review, not a fresh debit against new money.
      await env.DB.prepare(`INSERT OR IGNORE INTO order_billing
        (order_id,client_id,store_id,fee,status,attempts,last_error,created_at,updated_at)
        VALUES (?,?,?,?, 'pending_insufficient',0,'PRE_TOPUP_BACKLOG_REVIEW',?,?)`)
        .bind(orderId,order.client_id,order.store_id||null,fee,ts,ts).run();
      return {ok:false,status:'pending_insufficient',fee,code:'PRE_TOPUP_BACKLOG_REVIEW'};
    }
  }
  const startingBalance=round2(account.balance);
  // An order is not credit: never bill it partially or below zero, even when a
  // legacy/monthly credit_limit is present on the wallet account.
  if(startingBalance<fee){
    await env.DB.prepare(`INSERT INTO order_billing (order_id,client_id,store_id,fee,status,attempts,last_error,created_at,updated_at)
      VALUES (?,?,?,?, 'pending_insufficient',1,'INSUFFICIENT_BALANCE',?,?)
      ON CONFLICT(order_id) DO UPDATE SET fee=excluded.fee,status='pending_insufficient',attempts=order_billing.attempts+1,last_error='INSUFFICIENT_BALANCE',updated_at=excluded.updated_at`)
      .bind(orderId,order.client_id,order.store_id||null,fee,ts,ts).run();
    return {ok:false,status:'pending_insufficient',fee,balance:startingBalance,code:'INSUFFICIENT_BALANCE'};
  }
  await env.DB.prepare(`INSERT INTO order_billing (order_id,client_id,store_id,fee,status,attempts,created_at,updated_at)
    VALUES (?,?,?,?, 'pending',0,?,?) ON CONFLICT(order_id) DO UPDATE SET fee=excluded.fee,updated_at=excluded.updated_at`)
    .bind(orderId,order.client_id,order.store_id||null,fee,ts,ts).run();
  const logId=rid('WLG'),key=`order:${orderId}`;
  try{
    await env.DB.batch([
      // CHECK(balance >= -credit_limit) on wallet_accounts makes an overdraw fail the whole transaction.
      // Preflight balance may be stale when two new orders arrive simultaneously.
      // Reject the entire atomic batch if available funds were consumed meanwhile.
      env.DB.prepare('UPDATE wallet_accounts SET balance=CASE WHEN ROUND(balance,2)>=? THEN ROUND(balance-?,2) ELSE -credit_limit-0.01 END,updated_at=? WHERE client_id=?')
        .bind(fee,fee,ts,order.client_id),
      env.DB.prepare(`INSERT INTO wallet_log (id,client_id,store_id,type,amount,balance_after,note,created_at,created_by,order_id,reference_type,reference_id,idempotency_key,metadata_json)
        SELECT ?,?,?, 'deduct',?,balance,?,?,?,?,?,?,?,? FROM wallet_accounts WHERE client_id=?`)
        .bind(logId,order.client_id,order.store_id||null,fee,'خصم تلقائي — أوردر جديد',ts,'system',orderId,'order',orderId,key,JSON.stringify({billingVersion:'v27'}),order.client_id),
      env.DB.prepare("UPDATE order_billing SET status='charged',wallet_log_id=?,attempts=attempts+1,last_error=NULL,charged_at=?,updated_at=? WHERE order_id=?")
        .bind(logId,ts,ts,orderId)
    ]);
  }catch(error){
    const text=String(error?.message||error);
    if(/CHECK constraint failed|wallet_accounts/i.test(text)){
      await env.DB.prepare("UPDATE order_billing SET status='pending_insufficient',attempts=attempts+1,last_error='INSUFFICIENT_BALANCE',updated_at=? WHERE order_id=?").bind(now(),orderId).run();
      return {ok:false,status:'pending_insufficient',fee,code:'INSUFFICIENT_BALANCE'};
    }
    if(/idx_wallet_log_idempotency|UNIQUE constraint failed/i.test(text)){
      const log=await env.DB.prepare('SELECT id,balance_after FROM wallet_log WHERE client_id=? AND idempotency_key=?').bind(order.client_id,key).first();
      await env.DB.prepare("UPDATE order_billing SET status='charged',wallet_log_id=?,last_error=NULL,charged_at=COALESCE(charged_at,?),updated_at=? WHERE order_id=?").bind(log?.id||null,ts,ts,orderId).run();
      return {ok:true,status:'charged',fee,deduplicated:true};
    }
    await env.DB.prepare("UPDATE order_billing SET status='failed',attempts=attempts+1,last_error=?,updated_at=? WHERE order_id=?").bind(text.slice(0,500),now(),orderId).run();
    throw error;
  }
  const updated=await env.DB.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').bind(order.client_id).first();
  await mirrorLegacyBalance(env,order.client_id,updated?.balance||0);
  return {ok:true,status:'charged',fee,balance:round2(updated?.balance)};
}

export async function reconcileUnbilledOrders(env,{clientId=null,limit=100}={}){
  // Automatic reconciliation is for newly discovered, unbilled orders only.
  // A failed/insufficient order is an explicit debt candidate, NOT a mandate to
  // debit a later approved topup silently. Reattempts need an explicit billOrder.
  //
  // Also never sweep an unbilled order that existed before a topup restored an
  // exhausted wallet: those historical orders require manual ledger review.
  let sql=`SELECT o.id FROM orders o JOIN wallet_accounts w ON w.client_id=o.client_id AND w.billing_version='v27' AND w.status='active' AND w.balance>0
    LEFT JOIN order_billing b ON b.order_id=o.id
    WHERE o.rowid>COALESCE(w.billing_start_rowid,0) AND b.order_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM wallet_log t
        WHERE t.client_id=o.client_id AND t.type='topup'
          AND datetime(t.created_at)>=datetime(COALESCE(o.created_at,o.date))
      )`;
  const binds=[];if(clientId){sql+=' AND o.client_id=?';binds.push(clientId)}sql+=' ORDER BY COALESCE(o.date,o.created_at) ASC LIMIT ?';binds.push(Math.max(1,Math.min(300,Number(limit)||100)));
  const {results=[]}=await env.DB.prepare(sql).bind(...binds).all(),outcomes=[];
  for(const row of results){try{outcomes.push({orderId:row.id,...await billOrder(env,row.id)})}catch(error){outcomes.push({orderId:row.id,ok:false,error:String(error?.message||error)})}}
  return outcomes;
}



export const __walletOrderInternals={orderBeforeBillingStart};
