import {round2} from './wallet-account.js';

// Read-only, admin-only diagnostic (route authorization lives in subscription-control).
// Ledger rows are ordered by SQLite insertion sequence, not by wall-clock timestamps,
// because sync jobs can write several monetary events in the same millisecond.
const CREDIT_TYPES=new Set(['topup','credit','admin_credit','refund']);
const DEBIT_TYPES=new Set(['deduct','debit','charge','fee','subscription']);
const knownSigned=row=>{
  const type=String(row.type||'').toLowerCase(),amount=Number(row.amount);
  if(!Number.isFinite(amount)||amount<0||(!CREDIT_TYPES.has(type)&&!DEBIT_TYPES.has(type)))return null;
  return (CREDIT_TYPES.has(type)?1:-1)*Math.abs(amount);
};
const signed=row=>knownSigned(row)??0;
// Verify the chain oldest -> newest, not just current wallet balance vs latest row.
// Use rowid for ordering because events frequently share a millisecond.
export function auditWalletLedgerContinuity(logs,limit=12){
  const rows=Array.isArray(logs)?logs:[];
  const anomalies=[],unknownTypes=new Set();let verifiedPairs=0,anomalyCount=0;
  for(let i=rows.length-2;i>=0;i--){
    const earlier=rows[i+1],later=rows[i],delta=knownSigned(later);
    if(delta===null){
      unknownTypes.add(String(later.type||'unknown').slice(0,60));continue;
    }
    const previous=Number(earlier.balance_after),actual=Number(later.balance_after);
    if(!Number.isFinite(previous)||!Number.isFinite(actual)){
      anomalyCount++;
      if(anomalies.length<limit)anomalies.push({id:later.id,seq:later.seq,reason:'non_numeric_balance'});
      continue;
    }
    const expected=round2(previous+delta),difference=round2(actual-expected);
    verifiedPairs++;
    if(Math.abs(difference)>0.009){
      anomalyCount++;
      if(anomalies.length<limit)anomalies.push({id:later.id,seq:later.seq,at:later.created_at||null,referenceType:later.reference_type||null,
        expected,recorded:round2(actual),difference});
    }
  }
  return {checkedPairs:verifiedPairs,anomalyCount,anomalies,
    unknownTypes:[...unknownTypes],truncatedAnomalies:anomalyCount>anomalies.length};
}
export async function walletPaymentDiagnostics(env,clientId){
  const account=await env.DB.prepare('SELECT balance,currency,billing_version FROM wallet_accounts WHERE client_id=?').bind(clientId).first();
  if(!account)return {clientId,available:false,reason:'WALLET_NOT_FOUND'};
  // Never return the legacy state JSON; only reveal parity indicators to an admin.
  const legacyRow=await env.DB.prepare('SELECT json FROM state WHERE id=1').first();
  let legacyClient=null,legacyStateValid=false;
  if(legacyRow?.json){
    try{const parsed=JSON.parse(legacyRow.json);legacyStateValid=Array.isArray(parsed?.clients);
      if(legacyStateValid)legacyClient=parsed.clients.find(row=>String(row.id)===String(clientId))||null;
    }catch{legacyStateValid=false;}
  }
  const storedLegacyBalance=legacyClient&&Number.isFinite(Number(legacyClient.walletBalance))?
    round2(legacyClient.walletBalance):null;
  const canonicalBalance=round2(account.balance);
  const legacyFee=legacyClient&&Number.isFinite(Number(legacyClient.walletFeePerOrder))?
    round2(legacyClient.walletFeePerOrder):null;
  const legacyMirror={
    available:!!legacyClient,legacyStateValid,balance:storedLegacyBalance,
    balanceDrift:storedLegacyBalance===null?null:round2(storedLegacyBalance-canonicalBalance),
    mismatch:storedLegacyBalance!==null&&Math.abs(storedLegacyBalance-canonicalBalance)>0.009,
    oldPerOrderFee:legacyFee,oldFeeStillEnabled:account.billing_version==='v27'&&legacyFee!==null&&legacyFee>0
  };
  const {results:logs=[]}=await env.DB.prepare(`SELECT rowid seq,id,created_at,type,amount,balance_after,note,order_id,reference_type,reference_id
    FROM wallet_log WHERE client_id=? ORDER BY rowid DESC LIMIT 700`).bind(clientId).all();
  const ledgerContinuity=auditWalletLedgerContinuity(logs);
  const ledgerCoverage={scanned:logs.length,limitedTo:700,mayHaveOlderEntries:logs.length===700};
  const anchorIndex=logs.findIndex(row=>row.type==='topup'&&['topup_request','admin_adjustment'].includes(String(row.reference_type||'')));
  const latest=logs[0]||null,anchor=anchorIndex>=0?logs[anchorIndex]:null;
  const after=anchor?logs.slice(0,anchorIndex).reverse():[];
  const unknownAfterCredit=after.filter(row=>knownSigned(row)===null);
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
    clientId,currency:account.currency||'EGP',balance:currentBalance,legacyMirror,
    ledgerContinuity,ledgerCoverage,
    lastLedgerBalance:latest?round2(latest.balance_after):null,
    ledgerBalanceMismatch:latest?round2(currentBalance-Number(latest.balance_after||0)):null,
    lastApprovedCredit:anchor?{
      id:anchor.reference_id,at:anchor.created_at,amount:round2(anchor.amount),
      balanceAfter:round2(anchor.balance_after)
    }:null,
    sinceLastCredit:anchor?{
      reconstructionReliable:unknownAfterCredit.length===0&&ledgerContinuity.anomalyCount===0,
      unknownLedgerEntries:unknownAfterCredit.length,
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
