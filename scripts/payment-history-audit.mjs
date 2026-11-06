/**
 * READ-ONLY audit of historical Easy Orders payment evidence.
 *
 * Usage: node scripts/payment-history-audit.mjs /path/to/authorized-export.json
 * Input: JSON array of exported {client_id,store_id,ref,source,state,history}.
 * No database connections, mutations, provider calls or customer PII in output.
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {paymentFromHistory} from '../src/order-payment-status.js';

const value=v=>String(v??'').trim();
const isEasyOrder=row=>/easy\s*orders|easyorders|إيزي\s*أوردرز/i.test(
  [row.source,row.ref].map(value).join(' ')
);
const freshCounts=()=>({
  total:0,
  verifiedPaid:0,
  verifiedRefunded:0,
  unknownNeedsProviderCheck:0,
  codCollectedIsNotProof:0,
});

/** No order identifiers, phone numbers, names, amounts, or notes are returned. */
export function summarizePaymentHistory(rows){
  if(!Array.isArray(rows))throw new TypeError('Input must be an array of exported orders');
  const totals=freshCounts(),stores=new Map();
  for(const row of rows){
    if(!row||typeof row!=='object'||!isEasyOrder(row))continue;
    const scope=[value(row.client_id)||'unspecified-client',value(row.store_id)||'unspecified-store'].join(' / ');
    const group=stores.get(scope)||freshCounts();
    stores.set(scope,group);
    const status=paymentFromHistory(row.history).status;
    for(const counts of [totals,group]){
      counts.total+=1;
      if(status==='paid')counts.verifiedPaid+=1;
      else if(status==='refunded')counts.verifiedRefunded+=1;
      else {
        counts.unknownNeedsProviderCheck+=1;
        if(value(row.state)==='collected')counts.codCollectedIsNotProof+=1;
      }
    }
  }
  return {
    auditedAt:new Date().toISOString(),
    mode:'READ_ONLY_NO_BACKFILL',
    totals,
    stores:[...stores].sort(([a],[b])=>a.localeCompare(b)).map(([scope,counts])=>({scope,...counts})),
    note:'Unknown/collected orders are NOT evidence of online payment. Reconcile each with authenticated provider history before any backfill.'
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(!process.argv[2])throw new Error('Provide path to a local authorized JSON export');
    const parsed=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const rows=Array.isArray(parsed)?parsed:parsed?.rows;
    process.stdout.write(JSON.stringify(summarizePaymentHistory(rows),null,2)+'\n');
  }catch(error){
    process.stderr.write('Payment audit failed: '+error.message+'\n');
    process.exitCode=1;
  }
}
