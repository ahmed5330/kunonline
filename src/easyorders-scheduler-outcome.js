// Boundary between canonical order recovery and the dedicated five-minute
// Cloudflare Cron RPC. Never return a success signal when the provider failed,
// but allow normal 30-request budget rotation across healthy stores.
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
  const reportedFailure=result.ok!==true;
  // Older deployments can report only rateLimited/results, without new
  // failedConnections fields: do not accidentally mark them successful.
  const legacyRows=Array.isArray(result.results)?result.results:[];
  const failedCount=Math.max(failed,legacyRows.filter(row=>row?.status==='error').length);
  const throttledCount=Math.max(throttled,legacyRows.filter(row=>row?.status==='rate_limited').length,
    result.rateLimited===true?1:0);
  const feeFailed=integer(result?.feeReconciliation?.failed);
  const fail=reportedFailure||failedCount>0||throttledCount>0||feeFailed>0;
  const checked=integer(result.checkedConnections??legacyRows.length);
  const deferred=integer(result.uncheckedConnections);
  return {ok:!fail,
    code:fail?(throttledCount?'EASYORDERS_CRON_THROTTLED':failedCount>0?'EASYORDERS_CRON_RECOVERY_FAILED':feeFailed>0?'EASYORDERS_CRON_FEE_RECONCILIATION_FAILED':'EASYORDERS_CRON_RECOVERY_FAILED'):null,
    checkedConnections:checked,deferredConnections:deferred,
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
