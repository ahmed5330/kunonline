import {effectiveOrderFee} from './feature-entitlements.js';
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

function cairoToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=k=>parts.find(p=>p.type===k)?.value||'';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
async function pricedOrderFee(env,clientId,account){
  let sub=null;
  try{
    sub=await env.DB.prepare('SELECT status,period_end FROM subscriptions WHERE client_id=? ORDER BY created_at DESC LIMIT 1').bind(clientId).first();
  }catch(error){
    // Old v27 fixtures and legacy installations can predate managed subscriptions.
    // All other billing errors must propagate, never guess or silently waive.
    if(!/no such table:\s*subscriptions/i.test(String(error?.message||error)))throw error;
  }
  if(!sub)return {fee:round2(await effectiveOrderFee(env,clientId)),reason:'unmanaged'};
  if(['paused','cancelled','suspended'].includes(String(sub.status||'')))return {fee:0,reason:'subscription_paused'};
  if(sub.status==='trialing'&&/^\d{4}-\d{2}-\d{2}$/.test(String(sub.period_end||''))&&cairoToday()<sub.period_end){
    return {fee:0,reason:'free_trial'};
  }
  // The paid subscription's configured per-order fee is final. Module deltas
  // must not silently override the price displayed in the admin/customer panel.
  return {fee:Math.max(0,round2(account.base_order_fee)),reason:'managed_paid'};
}


export async function billOrder(env,orderId,{allowBacklogCharge=false}={}){
  const order=await env.DB.prepare('SELECT rowid AS order_rowid,id,client_id,store_id,date,created_at FROM orders WHERE id=?').bind(orderId).first();
  if(!order)return {ok:false,skipped:'order_not_found'};
  const duplicate=await env.DB.prepare('SELECT canonical_order_id FROM order_duplicate_links WHERE duplicate_order_id=?').bind(orderId).first();
  if(duplicate)return {ok:true,skipped:'linked_duplicate_order',canonicalOrderId:duplicate.canonical_order_id};
  const account=await ensureWalletAccount(env,order.client_id);
  if(account.billing_version!=='v27'||account.status!=='active')return {ok:true,skipped:'billing_not_v27'};
  if(Number(order.order_rowid)<=Number(account.billing_start_rowid||0))return {ok:true,skipped:'pre_v27_order'};
  const existing=await env.DB.prepare('SELECT * FROM order_billing WHERE order_id=?').bind(orderId).first();
  if(existing?.status==='charged'||existing?.status==='waived')return {ok:true,status:existing.status,fee:Number(existing.fee)||0};
  if(existing&&!allowBacklogCharge)return {ok:false,status:existing.status,fee:round2(existing.fee),code:'BACKLOG_REQUIRES_REVIEW'};
  const startedAt=await billingStartAt(env,order.client_id);
  if(orderBeforeBillingStart(order,startedAt,account.billing_start_rowid))return waivePreBillingOrder(env,order,'PRE_BILLING_DATE');
  const pricing=await pricedOrderFee(env,order.client_id,account),fee=pricing.fee,ts=now();
  if(fee<=0){
    await env.DB.prepare(`INSERT INTO order_billing (order_id,client_id,store_id,fee,status,attempts,created_at,charged_at,updated_at)
      VALUES (?,?,?,?, 'waived',1,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status='waived',fee=0,updated_at=excluded.updated_at`)
      .bind(orderId,order.client_id,order.store_id||null,0,ts,ts,ts).run();
    return {ok:true,status:'waived',fee:0,reason:pricing.reason};
  }
  if(!allowBacklogCharge){
    const recovery=await env.DB.prepare(`SELECT id FROM wallet_log
      WHERE client_id=? AND type='topup'
        AND datetime(created_at)>=datetime(?) LIMIT 1`)
      .bind(order.client_id,order.created_at||order.date||'').first();
    if(recovery){
      await env.DB.prepare(`INSERT OR IGNORE INTO order_billing
        (order_id,client_id,store_id,fee,status,attempts,last_error,created_at,updated_at)
        VALUES (?,?,?,?, 'pending_insufficient',0,'PRE_TOPUP_BACKLOG_REVIEW',?,?)`)
        .bind(orderId,order.client_id,order.store_id||null,fee,ts,ts).run();
      return {ok:false,status:'pending_insufficient',fee,code:'PRE_TOPUP_BACKLOG_REVIEW'};
    }
  }
  const startingBalance=round2(account.balance);
  if(startingBalance<=0){
    await env.DB.prepare(`INSERT INTO order_billing
      (order_id,client_id,store_id,fee,status,attempts,last_error,created_at,updated_at)
      VALUES (?,?,?,?, 'pending_insufficient',1,'INSUFFICIENT_BALANCE',?,?)
      ON CONFLICT(order_id) DO UPDATE SET fee=excluded.fee,status='pending_insufficient',
        attempts=order_billing.attempts+1,last_error='INSUFFICIENT_BALANCE',updated_at=excluded.updated_at`)
      .bind(orderId,order.client_id,order.store_id||null,fee,ts,ts).run();
    return {ok:false,status:'pending_insufficient',fee,code:'INSUFFICIENT_BALANCE'};
  }
  await env.DB.prepare(`INSERT INTO order_billing (order_id,client_id,store_id,fee,status,attempts,created_at,updated_at)
    VALUES (?,?,?,?, 'pending',0,?,?) ON CONFLICT(order_id) DO UPDATE SET fee=excluded.fee,updated_at=excluded.updated_at`)
    .bind(orderId,order.client_id,order.store_id||null,fee,ts,ts).run();
  const logId=rid('WLG'),key=`order:${orderId}`;
  try{
    await env.DB.batch([
      // Atomic, one-order overdraft: move to a negative balance ONLY if funds
      // were still positive when this transaction began. Widen credit_limit
      // solely to cover this final order, never to admit further orders.
      // The CHECK(balance >= -credit_limit) aborts the WHOLE batch if another
      // order already exhausted/paused the account, protecting the ledger.
      env.DB.prepare(`UPDATE wallet_accounts SET
        credit_limit=CASE WHEN ROUND(balance,2)>0 AND status='active' AND billing_version='v27'
          THEN MAX(COALESCE(credit_limit,0),MAX(0,ROUND(?-balance,2)))
          ELSE credit_limit END,
        balance=CASE WHEN ROUND(balance,2)>0 AND status='active' AND billing_version='v27'
          THEN ROUND(balance-?,2) ELSE -COALESCE(credit_limit,0)-0.01 END,
        updated_at=? WHERE client_id=?`)
        .bind(fee,fee,ts,order.client_id),
      env.DB.prepare(`INSERT INTO wallet_log (id,client_id,store_id,type,amount,balance_after,note,created_at,created_by,order_id,reference_type,reference_id,idempotency_key,metadata_json)
        SELECT ?,?,?, 'deduct',?,balance,?,?,?,?,?,?,?,? FROM wallet_accounts WHERE client_id=?`)
        .bind(logId,order.client_id,order.store_id||null,fee,'خصم تلقائي — أوردر جديد',ts,'system',orderId,'order',orderId,key,JSON.stringify({billingVersion:'v27'}),order.client_id),
      env.DB.prepare("UPDATE order_billing SET status='charged',wallet_log_id=?,attempts=attempts+1,last_error=NULL,charged_at=?,updated_at=? WHERE order_id=?")
        .bind(logId,ts,ts,orderId)
    ]);
  }catch(error){
    const text=String(error?.message||error);
    // Another request may already have committed this order and exhausted the
    // wallet. Recover its ledger before classifying a CHECK failure as debt.
    const committed=await env.DB.prepare('SELECT id,balance_after FROM wallet_log WHERE client_id=? AND idempotency_key=?').bind(order.client_id,key).first();
    if(committed?.id){
      await env.DB.prepare("UPDATE order_billing SET status='charged',wallet_log_id=?,last_error=NULL,charged_at=COALESCE(charged_at,?),updated_at=? WHERE order_id=?").bind(committed.id,ts,ts,orderId).run();
      return {ok:true,status:'charged',fee,balance:round2(committed.balance_after),deduplicated:true};
    }
    if(/CHECK constraint failed|wallet_accounts/i.test(text)){
      await env.DB.prepare("UPDATE order_billing SET status='pending_insufficient',attempts=attempts+1,last_error='INSUFFICIENT_BALANCE',updated_at=? WHERE order_id=?").bind(now(),orderId).run();
      return {ok:false,status:'pending_insufficient',fee,code:'INSUFFICIENT_BALANCE'};
    }
    await env.DB.prepare("UPDATE order_billing SET status='failed',attempts=attempts+1,last_error=?,updated_at=? WHERE order_id=?").bind(text.slice(0,500),now(),orderId).run();
    throw error;
  }
  const updated=await env.DB.prepare('SELECT balance FROM wallet_accounts WHERE client_id=?').bind(order.client_id).first();
  await mirrorLegacyBalance(env,order.client_id,updated?.balance||0);
  return {ok:true,status:'charged',fee,balance:round2(updated?.balance)};
}

export async function reconcileUnbilledOrders(env,{clientId=null,limit=100}={}){
  // Only auto-reconcile newly discovered orders. Never consume later topups
  // by replaying pending/failed charges from an exhausted wallet.
  let sql=`SELECT o.id FROM orders o JOIN wallet_accounts w ON w.client_id=o.client_id AND w.billing_version='v27' AND w.status='active' AND w.balance>0
    LEFT JOIN order_billing b ON b.order_id=o.id
    WHERE o.rowid>COALESCE(w.billing_start_rowid,0) AND b.order_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM order_duplicate_links dup WHERE dup.duplicate_order_id=o.id)
      AND NOT EXISTS (
        SELECT 1 FROM wallet_log t
        WHERE t.client_id=o.client_id AND t.type='topup'
          AND datetime(t.created_at)>=datetime(COALESCE(o.created_at,o.date))
      )`;
  const binds=[];if(clientId){sql+=' AND o.client_id=?';binds.push(clientId)}sql+=' ORDER BY COALESCE(o.created_at,o.date) ASC LIMIT ?';binds.push(Math.max(1,Math.min(300,Number(limit)||100)));
  const {results=[]}=await env.DB.prepare(sql).bind(...binds).all(),outcomes=[];
  for(const row of results){try{outcomes.push({orderId:row.id,...await billOrder(env,row.id)})}catch(error){outcomes.push({orderId:row.id,ok:false,error:String(error?.message||error)})}}
  return outcomes;
}


export const __previewWalletBillingInternals={pricedOrderFee};
