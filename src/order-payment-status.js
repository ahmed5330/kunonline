/**
 * Payment evidence is orthogonal to order fulfilment/collection.
 * Only authenticated provider payment events are authoritative; a payment
 * method such as "card" or "cod", and ordinary order states (confirmed,
 * shipped, collected), never prove a successful online payment.
 *
 * Stored in the existing order history JSON for backward compatibility:
 * no database migration, live table writes or schema rollout required.
 */
const clean = value => String(value ?? '').trim();
export const verifiedProviderPaymentStatus = value => {
  switch (clean(value).toLowerCase()) {
    case 'paid': return 'paid';
    case 'refunded': return 'refunded';
    default: return 'unknown';
  }
};
export function createProviderPaymentEvent(providerStatus, {reference = '',at = '',source = 'easyorders-webhook'} = {}) {
  const paymentStatus = verifiedProviderPaymentStatus(providerStatus);
  if (paymentStatus === 'unknown') return null;
  return {
    type:'payment_status',
    paymentStatus,
    source,
    ref:clean(reference),
    at:clean(at) || new Date().toISOString(),
  };
}
export function paymentFromHistory(value) {
  let history = [];
  if (Array.isArray(value)) history = value;
  else if (typeof value === 'string') {
    try { const decoded = JSON.parse(value); if (Array.isArray(decoded)) history = decoded; } catch {}
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i];
    if (!event || event.type !== 'payment_status' || event.source !== 'easyorders-webhook') continue;
    const status = verifiedProviderPaymentStatus(event.paymentStatus);
    if (status !== 'unknown') return {status, source:'easyorders', reference:clean(event.ref), at:clean(event.at)};
  }
  return {status:'unknown', source:'', reference:'', at:''};
}
export function paymentFromOrder({history,providerStatus} = {}) {
  const stored = paymentFromHistory(history);
  const fresh = verifiedProviderPaymentStatus(providerStatus);
  // Without a trusted sequence number, a stale provider read reporting "paid"
  // must never override an authenticated refund event already in the journal.
  if (stored.status === 'refunded' && fresh !== 'refunded') return stored;
  return fresh === 'unknown' ? stored : {status:fresh,source:'easyorders',reference:stored.reference,at:stored.at};
}
