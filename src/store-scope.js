const STORE_SCOPED_PREFIXES = [
  '/api/state', '/api/orders', '/api/customers', '/api/products', '/api/variants', '/api/coupons',
  '/api/suppliers', '/api/transactions', '/api/purchase-orders', '/api/procurement', '/api/performance',
  '/api/pos', '/api/campaigns', '/api/inbox', '/api/cod-reconciliation',
  '/api/finance', '/api/profit-intelligence', '/api/analytics', '/api/workflows',
  '/api/approvals', '/api/execution-jobs', '/api/notifications', '/api/audit-log',
  '/api/ai/insights', '/api/ai-actions'
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isStoreScopedPath(pathname = '') {
  return STORE_SCOPED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

export function requestedStoreId(request, body = null) {
  const url = new URL(request.url);
  return String(
    body?.storeId || body?.store_id || url.searchParams.get('storeId') ||
    request.headers.get('X-Kun-Store-Id') || ''
  ).trim() || null;
}

async function assertStore(env, clientId, storeId) {
  if (!storeId) return null;
  const store = await env.DB.prepare(
    "SELECT id,name,status FROM stores WHERE id=? AND client_id=?"
  ).bind(storeId, clientId).first();
  if (!store || store.status === 'inactive') {
    throw Object.assign(new Error('المتجر غير موجود أو غير نشط'), {
      status: 403, code: 'STORE_SCOPE_INVALID'
    });
  }
  return store;
}

export async function resolveStoreScope(env, me, clientId, storeId, options = {}) {
  const write = options.write === true;
  if (!me?.role) throw Object.assign(new Error('محتاج تسجّل دخول'), { status: 401 });
  if (!clientId) throw Object.assign(new Error('محتاج clientId'), { status: 400, code: 'CLIENT_ID_REQUIRED' });
  if (me.clientId && String(me.clientId) !== String(clientId)) {
    throw Object.assign(new Error('مش مسموح الوصول لبيانات حساب آخر'), {
      status: 403, code: 'TENANT_ISOLATION'
    });
  }

  // Global admins and tenant owners may work across all stores, or explicitly
  // select one store. Team roles are always constrained by user_store_access.
  if (me.role === 'admin' || me.role === 'client') {
    const store = await assertStore(env, clientId, storeId);
    return { clientId, storeId: store?.id || null, storeRole: 'owner', unrestricted: !store };
  }

  const { results = [] } = await env.DB.prepare(
    `SELECT a.store_id,a.role,s.name,s.status
     FROM user_store_access a
     JOIN stores s ON s.id=a.store_id AND s.client_id=a.client_id
     WHERE a.user_id=? AND a.client_id=? AND s.status='active'
     ORDER BY s.is_default DESC,s.name`
  ).bind(me.uid, clientId).all();
  if (!results.length) {
    throw Object.assign(new Error('لا توجد صلاحية فرع لهذا المستخدم'), {
      status: 403, code: 'STORE_ACCESS_REQUIRED'
    });
  }

  let access = null;
  if (storeId) access = results.find(row => String(row.store_id) === String(storeId));
  else if (results.length === 1) access = results[0];
  else {
    throw Object.assign(new Error('اختار فرعًا قبل فتح البيانات التشغيلية'), {
      status: 400, code: 'STORE_SELECTION_REQUIRED',
      stores: results.map(row => ({ id: row.store_id, name: row.name, role: row.role }))
    });
  }
  if (!access) {
    throw Object.assign(new Error('مش مسموح الوصول لبيانات هذا الفرع'), {
      status: 403, code: 'STORE_ISOLATION'
    });
  }
  if (write && access.role === 'viewer') {
    throw Object.assign(new Error('صلاحية الفرع للعرض فقط'), {
      status: 403, code: 'STORE_READ_ONLY'
    });
  }
  return { clientId, storeId: access.store_id, storeRole: access.role || 'member', unrestricted: false };
}

export async function listMyStores(env, me, clientId) {
  if (!me?.role) throw Object.assign(new Error('محتاج تسجّل دخول'), { status: 401 });
  if (me.clientId && String(me.clientId) !== String(clientId)) {
    throw Object.assign(new Error('مش مسموح الوصول لبيانات حساب آخر'), { status: 403, code: 'TENANT_ISOLATION' });
  }
  if (me.role === 'admin' || me.role === 'client') {
    const { results = [] } = await env.DB.prepare(
      "SELECT id,name,code,is_default,status,'owner' role FROM stores WHERE client_id=? AND status='active' ORDER BY is_default DESC,name"
    ).bind(clientId).all();
    return { allStores: true, stores: results };
  }
  const { results = [] } = await env.DB.prepare(
    `SELECT s.id,s.name,s.code,s.is_default,s.status,a.role
     FROM user_store_access a JOIN stores s ON s.id=a.store_id AND s.client_id=a.client_id
     WHERE a.user_id=? AND a.client_id=? AND s.status='active'
     ORDER BY s.is_default DESC,s.name`
  ).bind(me.uid, clientId).all();
  return { allStores: false, stores: results };
}

export async function scopeRequest(request, env, me, clientId) {
  const method = request.method.toUpperCase();
  const write = WRITE_METHODS.has(method);
  const body = write ? await request.clone().json().catch(() => ({})) : null;
  const scope = await resolveStoreScope(env, me, clientId, requestedStoreId(request, body), { write });
  if (!scope.storeId) return { request, scope };

  const url = new URL(request.url);
  url.searchParams.set('storeId', scope.storeId);
  const headers = new Headers(request.headers);
  headers.set('X-Kun-Store-Id', scope.storeId);
  let nextBody;
  if (write) {
    const scopedBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    scopedBody.storeId = scope.storeId;
    nextBody = JSON.stringify(scopedBody);
    headers.set('Content-Type', 'application/json');
  }
  return {
    request: new Request(url.toString(), {
      method, headers, body: write ? nextBody : undefined,
      redirect: request.redirect
    }),
    scope
  };
}
