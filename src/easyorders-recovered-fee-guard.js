/* Recovering an Easy Orders order and reconciling its management fee are
 * separate operations. A swallowed fee write error causes silent accounting
 * drift even when the order appears in Kun web/Android screens.
 * Observe/raise ONLY aggregated failure counts; do not include customer,
 * store, order IDs or provider secrets in Cron/public diagnostic responses.
 */
const positive=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0;};
export async function reconcileEasyOrdersRecoveredFees(result,reconcileFee){
  if(!result||typeof result!=='object'||Array.isArray(result))
    throw new Error('EASYORDERS_FEE_RECONCILIATION_RESULT_INVALID');
  if(typeof reconcileFee!=='function')
    throw new Error('EASYORDERS_FEE_RECONCILIATION_CALLBACK_INVALID');
  const ids=Array.isArray(result.recoveredOrderIds)?result.recoveredOrderIds:[];
  let attempted=0,failed=0,skipped=0;
  for(const id of new Set(ids.filter(x=>typeof x==='string'&&x.trim().length>0))){
    attempted++;
    try{
      const outcome=await reconcileFee(id);
      if(outcome?.ok===false){failed++;continue;}
      if(outcome?.skipped)skipped++;
    }catch{failed++;}
  }
  return {...result,feeReconciliation:{
    attempted,failed,skipped,succeeded:Math.max(0,attempted-failed),
    // A failure cannot be silently represented as an otherwise fully healthy
    // scheduled recovery. Keep already committed imported orders intact.
    status:failed?'failed':'complete'
  },ok:result.ok===true&&failed===0};
}
export function easyOrdersFeeFailures(result){
  return positive(result?.feeReconciliation?.failed);
}
