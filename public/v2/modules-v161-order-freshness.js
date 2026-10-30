/* Kun Online — cross-device order freshness bridge.
 * UI refresh is best-effort, never a replacement for durable CDC/push.
 * Avoid competing reloads, hidden-tab polling and stale-form data loss.
 */
(function () {
  if (window.KunOrderFreshnessV161) return;
  const VIEWS = new Set(['orders', 'customer-service']);
  const TICK_MS = 45000;
  const MIN_REFRESH_GAP_MS = 12000;
  let busy = false;
  let lastRefresh = 0;
  let pending = false;
  const activeView = () => window.KunSectionReloadV57?.activeView?.() || '';
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kun-order-freshness-v1') : null;
  const editing = () =>
    Boolean(document.querySelector('[role="dialog"], .drawer.open, .modal.show, .modal.active, [contenteditable="true"]')) ||
    Boolean(document.activeElement?.matches?.('input,textarea,select,[contenteditable]'));
  const allowed = () => document.visibilityState === 'visible' &&
    navigator.onLine !== false && VIEWS.has(activeView()) && !editing();
  async function refresh(force = false) {
    if (busy) { pending = true; return false; }
    if (!allowed() || !window.KunSectionReloadV57?.reload) return false;
    const now = Date.now();
    if (!force && now - lastRefresh < MIN_REFRESH_GAP_MS) return false;
    busy = true;
    lastRefresh = now;
    try {
      await window.KunSectionReloadV57.reload(activeView());
      window.dispatchEvent(new CustomEvent('kun:orders-auto-refreshed', {detail: {at: new Date().toISOString()}}));
      return true;
    } catch (_) {
      // Keep existing orders and retry next tick/focus. Never report a sync success.
      return false;
    } finally {
      busy = false;
      if (pending) {
        pending = false;
        // Honor rate limit even after a burst of events.
      }
    }
  }
  const onResume = () => { if (allowed()) void refresh(); };
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('online', onResume);
  window.addEventListener('kun:order-workflow-updated', () => {
    if (channel) channel.postMessage({type: 'orders-updated'});
    // The source tab already updated the affected order; refresh other tabs.
  });
  if (channel) channel.onmessage = event => {
    if (event?.data?.type === 'orders-updated') void refresh();
  };
  const interval = setInterval(onResume, TICK_MS);
  window.addEventListener('pagehide', () => { clearInterval(interval); channel?.close(); }, {once:true});
  window.KunOrderFreshnessV161 = {refresh, version: '161.0'};
})();
