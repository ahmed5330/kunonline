// Boundary between canonical order recovery and the dedicated five-minute
// Cloudflare Cron RPC. Genuine failures remain fatal. A verified next-number
// wait may finish the scheduled task while provider recovery stays incomplete.
// This module handles ONLY sanitized aggregate results, not tenant or order data.
const integer=value=>{
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:0;
};
export function checkEasyOrdersCronRecovery(result){
  if(!result||typeof result!=='object'||Array.isArray(result)){
    return {ok:false,code:'EASYORDERS_CRON_NO_RESULT',checkedConnections:0,
      deferredConnections:0,failedConnections:0,throttledConnections:0};
  }
  const failed=integer(result.failedConnections);
  const throttled=integer(result.rateLimitedConnections);
  // Older deployments can report only rateLimited/results, without new
  // failedConnections fields: do not accidentally mark them successful.
  const legacyRows=Array.isArray(result.results)?result.results:[];
  const failedCount=Math.max(failed,legacyRows.filter(row=>row?.status==='error').length);
  const throttledCount=Math.max(throttled,legacyRows.filter(row=>row?.status==='rate_limited').length,
    result.rateLimited===true?1:0);
  const feeFailed=integer(result?.feeReconciliation?.failed);
  const waitingRows=legacyRows.filter(row=>row?.status==='waiting_for_provider_order');
  const hasWaiting=waitingRows.length>0||integer(result.waitingForProviderConnections)>0;
  const verifiedWaiting=waitingRows.length>0&&Number(result.waitingForProviderConnections)===waitingRows.length&&
    Number(result.failedConnections)===0&&Number(result.rateLimitedConnections)===0&&
    legacyRows.every(row=>['healthy','catching_up','waiting_for_short_id','waiting_for_provider_order'].includes(row?.status))&&
    waitingRows.every(row=>row.providerWaitingVerified===true&&row.providerHttpStatus===400&&
      row.providerErrorCategory==='provider_other_http'&&row.error===null&&
      Number.isSafeInteger(Number(row.highestShortId))&&Number(row.highestShortId)>0&&
      Number.isSafeInteger(Number(row.nextShortId))&&Number(row.nextShortId)===Number(row.highestShortId)+1&&
      row.estimatedRemaining===0&&row.unresolvedAheadCount===0&&Number(row.requests)>=2);
  const reportedFailure=result.ok!==true&&!verifiedWaiting;
  const fail=reportedFailure||(hasWaiting&&!verifiedWaiting)||failedCount>0||throttledCount>0||feeFailed>0;
  const checked=integer(result.checkedConnections??legacyRows.length);
  const deferred=integer(result.uncheckedConnections);
  return {ok:!fail,
    code:fail?(throttledCount?'EASYORDERS_CRON_THROTTLED':failedCount>0?'EASYORDERS_CRON_RECOVERY_FAILED':feeFailed>0?'EASYORDERS_CRON_FEE_RECONCILIATION_FAILED':'EASYORDERS_CRON_RECOVERY_FAILED'):null,
    checkedConnections:checked,deferredConnections:deferred,
    deferredProviderConnections:verifiedWaiting?waitingRows.length:0,
    providerRecoveryComplete:!fail&&!hasWaiting&&deferred===0&&legacyRows.every(row=>row?.status==='healthy'),
    failedConnections:failedCount,throttledConnections:throttledCount,
    failedFeeReconciliations:feeFailed};
}
export function assertEasyOrdersCronRecovered(result){
  const health=checkEasyOrdersCronRecovery(result);
  if(!health.ok){
    // This error is suitable for Cloudflare Worker scheduled failure logs:
    // no connection IDs, errors, keys, customer details or order refs.
    const e=new Error(health.code);
    e.code=health.code;
    e.aggregate={checkedConnections:health.checkedConnections,
      deferredConnections:health.deferredConnections,
      failedConnections:health.failedConnections,
      throttledConnections:health.throttledConnections,
      failedFeeReconciliations:health.failedFeeReconciliations};
    throw e;
  }
  return result;
}
