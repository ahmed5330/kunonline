import {round2} from './wallet-account.js';

// Read-only, admin-only diagnostic (route authorization lives in subscription-control).
// Ledger rows are ordered by SQLite insertion sequence, not by wall-clock timestamps,
// because sync jobs can write several monetary events in the same millisecond.
const signed=row=>['topup','credit','admin_credit','refund'].includes(String(row.type||'').toLowerCase())?Math.abs(Number(row.amount)||0):-(Math.abs(Number(row.amount)||0));
export async function walletPaymentDiagnostics(env,clientId){
  const account=await env.DB.prepare('SELECT balance,currency FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  if(!account)return {clientId,available:false,reason:'WALLET_NOT_FOUND'};
  const {results:logs=[]}=await env.DB.prepare(`SELECT rowid seq,id,created_at,type,amount,balance_after,note,order_id,reference_type,reference_id
    FROM wallet_log WHERE client_id=? ORDER BY rowid DESC LIMIT 700`).bind(clientId).all();
  const anchorIndex=logs.findIndex(row=>row.type==='topup'&&['topup_request','admin_adjustment'].includes(String(row.reference_type||'')));
  const latest=logs[0]||null,anchor=anchorIndex>=0?logs[anchorIndex]:null;
  const after=anchor?logs.slice(0,anchorIndex).reverse():[];
  const debits=after.filter(row=>signed(row)<0);
  const credits=after.filter(row=>signed(row)>0);
  const byReason={orders:0,subscription:0,other:0};
  for(const row of debits){
    const category=row.reference_type==='order'?'orders':row.reference_type==='subscription_month'?'subscription':'other';
    byReason[category]=round2(byReason[category]+Math.abs(signed(row)));
  }
  const debitsTotal=round2(debits.reduce((a,r)=>a-signed(r),0));
  const creditsTotal=round2(credits.reduce((a,r)=>a+signed(r),0));
  const expectedFromTopup=anchor?round2(Number(anchor.balance_after||0)+creditsTotal-debitsTotal):null;
  const currentBalance=round2(account.balance);
  const {n:missingApprovedCredits=0}=await env.DB.prepare(`SELECT COUNT(*) n FROM wallet_topup_requests r
    WHERE r.client_id=? AND r.status='approved' AND NOT EXISTS
      (SELECT 1 FROM wallet_log l WHERE l.client_id=r.client_id
       AND l.reference_type='topup_request' AND l.reference_id=r.id)`).bind(clientId).first()||{};
  const {n:duplicateCreditRequests=0}=await env.DB.prepare(`SELECT COUNT(*) n FROM
    (SELECT reference_id FROM wallet_log WHERE client_id=? AND reference_type='topup_request'
      GROUP BY reference_id HAVING COUNT(*)>1)`).bind(clientId).first()||{};
  return {
    clientId,currency:account.currency||'EGP',balance:currentBalance,
    lastLedgerBalance:latest?round2(latest.balance_after):null,
    ledgerBalanceMismatch:latest?round2(currentBalance-Number(latest.balance_after||0)):null,
    lastApprovedCredit:anchor?{
      id:anchor.reference_id,at:anchor.created_at,amount:round2(anchor.amount),
      balanceAfter:round2(anchor.balance_after)
    }:null,
    sinceLastCredit:anchor?{
      debits:debitsTotal,credits:creditsTotal,debitBreakdown:byReason,
      expectedBalance:expectedFromTopup,
      drift:round2(currentBalance-expectedFromTopup),
      becameEmpty:round2(anchor.balance_after)>0&&currentBalance<=0,
      entries:after.slice(-100).map(row=>({
        id:row.id,at:row.created_at,type:row.type,amount:round2(row.amount),
        balanceAfter:round2(row.balance_after),referenceType:row.reference_type,
        orderId:row.order_id,note:row.note
      })),
      truncated:after.length>100
    }:null,
    missingApprovedCredits:Number(missingApprovedCredits)||0,
    duplicateCreditRequests:Number(duplicateCreditRequests)||0,
    ledgerWindowTruncated:logs.length===700&&!anchor
  };
}
