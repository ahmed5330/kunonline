import {effectiveOrderFee} from './feature-entitlements.js';
import {ensureWalletAccount,round2} from './wallet-account.js';

export async function walletSnapshot(env,clientId){
  const account=await ensureWalletAccount(env,clientId),fee=account.billing_version==='v27'?await effectiveOrderFee(env,clientId):Math.max(0,Number(account.base_order_fee)||0);
  const pending=await env.DB.prepare("SELECT COUNT(*) n,COALESCE(SUM(amount),0) amount FROM wallet_topup_requests WHERE client_id=? AND status='pending'").bind(clientId).first();
  // Fresh/legacy onboarding schemas can predate the duplicate-links migration.
  // Exclude duplicate order fees whenever the relation exists, while remaining
  // compatible with older installations/isolated QA fixtures.
  let unbilled;
  try{
    unbilled=await env.DB.prepare("SELECT COUNT(*) n FROM order_billing b JOIN orders o ON o.id=b.order_id AND o.client_id=b.client_id WHERE b.client_id=? AND b.status IN ('pending','pending_insufficient','failed') AND NOT EXISTS (SELECT 1 FROM order_duplicate_links dup WHERE dup.duplicate_order_id=o.id)").bind(clientId).first();
  }catch(error){
    if(!/no such table:\\s*order_duplicate_links/i.test(String(error?.message||error)))throw error;
    unbilled=await env.DB.prepare("SELECT COUNT(*) n FROM order_billing WHERE client_id=? AND status IN ('pending','pending_insufficient','failed')").bind(clientId).first();
  }
  return {clientId,balance:round2(account.balance),currency:account.currency,effectiveOrderFee:fee,baseOrderFee:Number(account.base_order_fee)||0,minOrderFee:Number(account.min_order_fee)||0,maxOrderFee:Number(account.max_order_fee)||0,creditLimit:Number(account.credit_limit)||0,billingVersion:account.billing_version,status:account.status,pendingTopups:Number(pending?.n)||0,pendingTopupAmount:round2(pending?.amount),unbilledOrders:Number(unbilled?.n)||0};
}

export async function listWalletLog(env,clientId,limit=100){
  const {results=[]}=await env.DB.prepare('SELECT * FROM wallet_log WHERE client_id=? ORDER BY created_at DESC LIMIT ?').bind(clientId,Math.max(1,Math.min(500,Number(limit)||100))).all();
  return results;
}
