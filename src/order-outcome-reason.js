/*
 * Accept both Android's historic cancelReason and the outcome workflow's
 * reason/outcomeReason contract. Never substitute a customer's order note
 * for an explicit staff cancellation reason.
 */
export function normalizeOutcomeReason(body={},state=''){
  const raw=state==='cancelled'
    ? [body.cancelReason,body.reason,body.outcomeReason]
    : [body.reason,body.outcomeReason];
  return raw.map(value=>String(value??'').trim()).find(Boolean)||'';
}
