/* Transport-only deltas. Always authorize/read through the existing source route.
 * No migrations, mutation hooks, cached authorization, or unsafe timestamp cursors.
 * This reduces mobile requests/bytes; it does NOT eliminate source D1 reads.
 */
const ROUTES = new Map([
  ['/api/mobile/state-sync', '/api/state'],
  ['/api/mobile/board-sync', '/api/customer-service'],
]);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization'},
});

export function createMobileSync({maxBytes = 8 * 1024 * 1024, ttlMs = 120_000, clock = Date.now} = {}) {
  const snapshots = new Map();
  let bytes = 0;
  const remove = key => { const entry = snapshots.get(key); if (entry) bytes -= entry.bytes; snapshots.delete(key); };
  const prune = () => { for (const [key, entry] of snapshots) if (entry.expires <= clock()) remove(key); };
  return async function handle({request, load}) {
    const url = new URL(request.url), source = ROUTES.get(url.pathname);
    if (!source) return null;
    if (request.method !== 'GET') return json({error: 'Method not allowed'}, 405);
    const cursor = url.searchParams.get('cursor') || '';
    url.pathname = source;
    url.searchParams.delete('cursor');
    url.searchParams.sort();
    const sourceRequest = new Request(url, {method: 'GET', headers: request.headers});
    // Do this on every poll, BEFORE looking up a baseline: revocation and tenant
    // filtering remain authoritative even when the client has an old cursor.
    const response = await load(sourceRequest);
    if (!response.ok) return response;
    const state = await response.json();
    if (!state || Array.isArray(state) || typeof state !== 'object') return json({error: 'Invalid sync source'}, 502);
    const serialized = JSON.stringify(state);
    const scopeInput = JSON.stringify([url.toString(), request.headers.get('Cookie'), request.headers.get('Authorization'), request.headers.get('X-Kun-Store-Id')]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scopeInput));
    const scope = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    prune();
    const old = snapshots.get(cursor);
    const previous = old?.scope === scope ? old : null;
    if (previous?.serialized === serialized) {
      previous.expires = clock() + ttlMs;
      return json({protocol: 1, mode: 'unchanged', cursor});
    }
    const nextCursor = crypto.randomUUID();
    let payload = {protocol: 1, mode: 'reset', cursor: nextCursor, state};
    if (previous) {
      const before = JSON.parse(previous.serialized);
      const beforeOrders = Array.isArray(before.orders) ? before.orders : [];
      const afterOrders = Array.isArray(state.orders) ? state.orders : [];
      const valid = rows => rows.every(o => o && typeof o.id === 'string' && o.id) && new Set(rows.map(o => o.id)).size === rows.length;
      if (valid(beforeOrders) && valid(afterOrders)) {
        const byId = new Map(beforeOrders.map(o => [o.id, JSON.stringify(o)]));
        const nextIds = new Set(afterOrders.map(o => o.id));
        const fields = Object.fromEntries(Object.entries(state).filter(([key, value]) => key !== 'orders' && JSON.stringify(before[key]) !== JSON.stringify(value)));
        const removedFields = Object.keys(before).filter(key => key !== 'orders' && !(key in state));
        payload = {protocol: 1, mode: 'delta', cursor: nextCursor, fields, removedFields,
          orders: {
            upsert: afterOrders.filter(o => byId.get(o.id) !== JSON.stringify(o)),
            removed: beforeOrders.filter(o => !nextIds.has(o.id)).map(o => o.id),
            ids: afterOrders.map(o => o.id),
          }};
      }
    }
    // Bounded, short-lived per-isolate baselines. Eviction/restarts simply cause
    // a reset; correctness never depends on sticky routing or cached auth.
    const size = serialized.length * 2;
    if (size <= maxBytes) {
      while (bytes + size > maxBytes && snapshots.size) remove(snapshots.keys().next().value);
      snapshots.set(nextCursor, {scope, serialized, bytes: size, expires: clock() + ttlMs});
      bytes += size;
    }
    return json(payload);
  };
}
export const handleMobileSync = createMobileSync();
