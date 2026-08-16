/**
 * كن أونلاين — Cloudflare Worker
 * ---------------------------------------------------------------------------
 * بيعمل ٤ حاجات:
 *   1. بيقدّم الداشبورد من مجلد public
 *   2. API محمي بجلسة — كل عميل بيشوف بياناته هو بس
 *   3. بيستقبل ويبهوك إيزي أوردرز والتتبع
 *   4. كل ساعتين بيحدّث حالة شحنات J&T
 *
 * الدخول بإيميل وكلمة مرور — الاتنين بيتطابقوا مع جدول users في قاعدة البيانات.
 * كلمة المرور متخزّنة مشفّرة بـ PBKDF2-SHA256 (١٠٠ ألف تكرار + ملح عشوائي).
 *
 * الأسرار بتتحط من لوحة Cloudflare مش في الكود:
 *   SESSION_SECRET · EASYORDERS_WEBHOOK_SECRET · TRACKING_API_KEY · TRACKING_PROVIDER
 * ---------------------------------------------------------------------------
 */

const COOKIE = 'ko_session';
const WEEK = 60 * 60 * 24 * 7;

/* ---------- أدوات ---------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });

const b64url = {
  enc: s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))
};

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** المقارنة بتاخد نفس الوقت دايماً — بتمنع تخمين التوكن بقياس زمن الرد */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- تشفير كلمات المرور ---------- */
const PBKDF2_ITERATIONS = 100000;
const MIN_PASSWORD = 8;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

/** بيرجّع نص واحد فيه الخوارزمية والتكرارات والملح والبصمة */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/** المقارنة بتاخد نفس الوقت دايماً — ما بتسربش معلومة من زمن الرد */
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!iterations || iterations > 500000) return false;
  try {
    const hash = await derive(password, fromB64(parts[2]), iterations);
    return safeEqual(toB64(hash), parts[3]);
  } catch { return false; }
}

/* ---------- قفل الحساب بعد محاولات فاشلة ---------- */
async function checkLock(env, email) {
  const row = await env.DB.prepare('SELECT fails, locked_until FROM login_attempts WHERE email = ?')
    .bind(email).first();
  if (!row || !row.locked_until) return null;
  const until = new Date(row.locked_until);
  if (until > new Date()) return Math.ceil((until - new Date()) / 60000);
  return null;
}

async function recordFail(env, email) {
  const row = await env.DB.prepare('SELECT fails FROM login_attempts WHERE email = ?').bind(email).first();
  const fails = ((row && row.fails) || 0) + 1;
  const locked = fails >= MAX_FAILS
    ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
    : null;
  await env.DB.prepare(
    `INSERT INTO login_attempts (email, fails, locked_until) VALUES (?,?,?)
     ON CONFLICT(email) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until`
  ).bind(email, locked ? 0 : fails, locked).run();
  return MAX_FAILS - fails;
}

const clearFails = (env, email) =>
  env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();

/* ---------- تطبيع أرقام التليفونات ---------- */
/** بيرجّع رقم مصري (01xxxxxxxxx) أو سعودي (05xxxxxxxx) نضيف، أو null لو الشكل غلط */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (d.startsWith('0020')) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  else if (d.startsWith('00966')) d = '0' + d.slice(5);
  else if (d.startsWith('966') && d.length === 12) d = '0' + d.slice(3);
  if (/^01[0-9]{9}$/.test(d)) return d;   // مصر: ١١ رقم
  if (/^05[0-9]{8}$/.test(d)) return d;   // السعودية: ١٠ أرقام
  return null;
}

/* ---------- الأدوار والصلاحيات ---------- */
/* كل دور بياخد أقل صلاحيات تكفّي شغله — مش أكتر */
const ROLES = {
  admin:      { label:'مدير',          perms:['orders','entries','finance','clients','users','settings'] },
  ops:        { label:'تشغيل وشحن',    perms:['orders','entries'] },
  support:    { label:'خدمة عملاء',    perms:['orders'] },
  accountant: { label:'محاسب',         perms:['finance','orders_view'] },
  client:     { label:'عميل',          perms:[] }
};
const permsOf = role => (ROLES[role] || ROLES.client).perms;
const can = (user, perm) => permsOf(user.role).includes(perm);
const isStaff = user => user.role !== 'client';

/* ---------- جدول الحسابات ---------- */
const publicUser = u => ({
  id: u.id, email: u.email, role: u.role, clientId: u.client_id,
  status: u.status, lastLogin: u.last_login
});

const findUserByEmail = (env, email) =>
  env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

async function countUsers(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return (r && r.n) || 0;
}

async function makeSession(payload, secret) {
  const body = b64url.enc(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + WEEK }));
  return `${body}.${await hmac(body, secret)}`;
}

async function readSession(request, secret) {
  const raw = (request.headers.get('Cookie') || '')
    .split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmac(body, secret))) return null;
  try {
    const p = JSON.parse(b64url.dec(body));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

/* ---------- تشفير توكنز التكامل (Meta / EasyOrders / كلمة سر الإيميل) ----------
   AES-GCM بمفتاح مشتق من TOKEN_ENC_KEY. القيم دي بتتخزّن مشفّرة في state
   وبترجع نص عادي بس جوه الـ Worker وقت الاستخدام — أبداً للمتصفح */
async function encKeyFrom(env) {
  if (!env.TOKEN_ENC_KEY) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TOKEN_ENC_KEY));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSecret(plain, env) {
  if (!plain) return plain;
  const key = await encKeyFrom(env);
  if (!key) return plain; /* المفتاح مش متظبط لسه — نسيبها زي ما هي بدل ما نفشل الحفظ */
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return 'enc$' + toB64(iv) + '$' + toB64(new Uint8Array(buf));
}

async function decryptSecret(value, env) {
  if (!value || !String(value).startsWith('enc$')) return value; /* مش مشفّرة (أو المفتاح ناقص) */
  const parts = String(value).split('$');
  if (parts.length !== 3) return null;
  const key = await encKeyFrom(env);
  if (!key) return null;
  try {
    const iv = fromB64(parts[1]);
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64(parts[2]));
    return new TextDecoder().decode(buf);
  } catch { return null; }
}

/** آخر ٤ حروف بس — كفاية للعميل يتأكد إنه سجّل التوكن الصح من غير ما نعرضه كامل */
const maskTail = s => s ? '••••' + String(s).slice(-4) : '';

const SECRET_FIELDS = ['metaToken', 'easyOrdersToken', 'emailPassword'];

/** لأي حالة عندها clients: بتشفّر كل حقل سري قبل التخزين */
async function encryptClientSecrets(state, env) {
  for (const c of (state.clients || [])) {
    for (const f of SECRET_FIELDS) {
      if (c[f] && !String(c[f]).startsWith('enc$')) c[f] = await encryptSecret(c[f], env);
    }
  }
  return state;
}

/** بيرجّع الحقول السرية لنص عادي — يُستخدم جوه الـ Worker بس بعد القراءة من القاعدة */
async function decryptClientSecrets(state, env) {
  for (const c of (state.clients || [])) {
    for (const f of SECRET_FIELDS) {
      if (c[f]) c[f] = await decryptSecret(c[f], env);
    }
  }
  return state;
}

/** نسخة آمنة للمتصفح — الحقول السرية بتتشال وبيتحط مكانها Set:true/false + آخر ٤ حروف */
function maskClientSecrets(state) {
  const clone = JSON.parse(JSON.stringify(state));
  (clone.clients || []).forEach(c => {
    for (const f of SECRET_FIELDS) {
      const had = !!c[f];
      const tail = had ? maskTail(c[f]) : '';
      delete c[f];
      c[f + 'Set'] = had;
      if (had) c[f + 'Tail'] = tail;
    }
  });
  return clone;
}

/** لو المتصفح ما بعتش قيمة جديدة لحقل سري (سايبه فاضي)، نرجّع القديم بدل ما نمسحه */
function preserveUntouchedSecrets(newState, oldState) {
  const oldById = new Map((oldState.clients || []).map(c => [c.id, c]));
  (newState.clients || []).forEach(c => {
    const old = oldById.get(c.id);
    if (!old) return;
    for (const f of SECRET_FIELDS) {
      if (c[f] === undefined || c[f] === null) {
        if (old[f] !== undefined) c[f] = old[f];
      } else if (c[f] === '') {
        delete c[f]; /* فاضي صريح = امسح التوكن */
      }
    }
  });
  return newState;
}

/* ---------- قاعدة البيانات ---------- */
const EMPTY_STATE = agencyEmail => ({
  agency: { name: 'كن أونلاين', adminEmail: agencyEmail },
  clients: [], entries: [], funding: []
});

async function loadState(env) {
  const row = await env.DB.prepare('SELECT json FROM state WHERE id = 1').first();
  if (row && row.json) return decryptClientSecrets(JSON.parse(row.json), env);
  const fresh = EMPTY_STATE('');
  await saveState(env, fresh);
  return fresh;
}

async function saveState(env, state) {
  const toStore = await encryptClientSecrets(JSON.parse(JSON.stringify(state)), env);
  await env.DB.prepare(
    `INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(toStore), new Date().toISOString()).run();
}

const ORDER_COLS = 'id, client_id, ref, date, name, phone, gov, address, product, product_id, unit_price, qty, total, product_cost, shipping_cost, other_cost, source, note, awb, state, checkpoint, signed_at, collected_at, contact_log, history, created_at';

const parseJsonArr = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

const rowToOrder = r => ({
  id: r.id, clientId: r.client_id, ref: r.ref, date: r.date, name: r.name, phone: r.phone,
  gov: r.gov, address: r.address, product: r.product, productId: r.product_id,
  unitPrice: r.unit_price, qty: r.qty, total: r.total,
  productCost: r.product_cost || 0, shippingCost: r.shipping_cost, otherCost: r.other_cost,
  source: r.source, note: r.note, awb: r.awb, state: r.state,
  checkpoint: r.checkpoint, signedAt: r.signed_at, collectedAt: r.collected_at,
  contactLog: parseJsonArr(r.contact_log), history: parseJsonArr(r.history)
});

async function listOrders(env, clientId) {
  const q = clientId
    ? env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE client_id = ? ORDER BY date DESC LIMIT 2000`).bind(clientId)
    : env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders ORDER BY date DESC LIMIT 2000`);
  const { results } = await q.all();
  return (results || []).map(rowToOrder);
}

async function insertOrder(env, o) {
  const initialHistory = o.history || [{ state: o.state || 'pending', at: new Date().toISOString() }];
  await env.DB.prepare(
    `INSERT INTO orders (${ORDER_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       state = excluded.state, checkpoint = excluded.checkpoint,
       awb = COALESCE(excluded.awb, orders.awb),
       ref = COALESCE(excluded.ref, orders.ref),
       shipping_cost = COALESCE(excluded.shipping_cost, orders.shipping_cost),
       other_cost = COALESCE(excluded.other_cost, orders.other_cost),
       signed_at = COALESCE(excluded.signed_at, orders.signed_at),
       collected_at = COALESCE(excluded.collected_at, orders.collected_at)`
  ).bind(
    o.id, o.clientId, o.ref || null, o.date, o.name || '', o.phone || '', o.gov || '', o.address || '',
    o.product || '', o.productId || null, o.unitPrice || 0, o.qty || 1, o.total || 0,
    o.productCost || 0,
    o.shippingCost === undefined || o.shippingCost === null ? null : Number(o.shippingCost),
    o.otherCost === undefined || o.otherCost === null ? null : Number(o.otherCost),
    o.source || '', o.note || '', o.awb || null, o.state || 'pending', o.checkpoint || '',
    o.signedAt || null, o.collectedAt || null,
    JSON.stringify(o.contactLog || []), JSON.stringify(initialHistory), new Date().toISOString()
  ).run();
  return o;
}

/** أول ٣ حروف من الاسم + رقم تسلسلي عالمي يبدأ من ٢٠٠ — لكود الأوردر اليدوي */
function orderNamePrefix(name) {
  const letters = String(name || '').replace(/[^\p{L}]/gu, '').toUpperCase().slice(0, 3);
  return (letters || 'ORD').padEnd(3, 'X');
}
async function nextOrderCode(env, name) {
  const state = await loadState(env);
  state.orderCodeCounter = (Number(state.orderCodeCounter) || 199) + 1;
  await saveState(env, state);
  return orderNamePrefix(name) + state.orderCodeCounter;
}

/* ---------- المنتجات ---------- */
const PRODUCT_COLS = 'id, client_id, name, sku, price, cost, active, created_at';
const TX_COLS = 'id, type, date, category, amount, currency, method, client_id, note, created_by, created_at';
const rowToProduct = r => ({
  id: r.id, clientId: r.client_id, name: r.name, sku: r.sku,
  price: r.price, cost: r.cost, active: r.active
});

async function listProducts(env, clientId) {
  const q = clientId
    ? env.DB.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE client_id = ? ORDER BY name`).bind(clientId)
    : env.DB.prepare(`SELECT ${PRODUCT_COLS} FROM products ORDER BY client_id, name`);
  const { results } = await q.all();
  return (results || []).map(rowToProduct);
}

/** منتجات إيزي أوردرز — لو مش موجودة في كتالوج المتجر، تتسجّل تلقائي (بدون تكلفة، الإدارة تحطها بعدين) */
async function ensureProductsFromCart(env, clientId, cartItems) {
  const existing = await listProducts(env, clientId);
  const byName = new Map(existing.map(p => [String(p.name || '').trim().toLowerCase(), p]));
  for (const item of (cartItems || [])) {
    const name = item.product && item.product.name ? String(item.product.name).trim() : '';
    if (!name || byName.has(name.toLowerCase())) continue;
    const price = Number(item.product.price ?? item.unit_price ?? item.price) || 0;
    const id = 'P-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    await env.DB.prepare(
      `INSERT INTO products (${PRODUCT_COLS}) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(id, clientId, name, '', price, 0, 1, new Date().toISOString()).run();
    byName.set(name.toLowerCase(), { id, name });
  }
}

/* ---------- توحيد الحالات ---------- */
const ORDER_STATES = ['pending','confirmed','preparing','shipped','signed','collected','returned','cancelled'];
const STATE_TEXT = {
  pending:   'جاري التأكيد',
  confirmed: 'تم تأكيد الطلب',
  preparing: 'جاري الشحن',
  shipped:   'تم الشحن',
  signed:    'تم التسليم — تحصيل منتظر',
  collected: 'تم التحصيل',
  returned:  'مرتجع',
  cancelled: 'تم إلغاء الطلب'
};
/* signed مش نهائية: J&T سلّم الشحنة بس الفلوس لسه ما وصلتش */
const FINAL = ['collected', 'returned', 'cancelled'];

function mapEasyOrdersStatus(s) {
  const k = String(s || '').toLowerCase().trim();
  const t = {
    pending: 'pending', new: 'pending',
    confirmed: 'confirmed', paid: 'confirmed', processing: 'preparing',
    shipped: 'shipped', shipping: 'shipped',
    delivered: 'signed', completed: 'signed',
    returned: 'returned', refunded: 'returned', 'مرتجع': 'returned',
    cancelled: 'cancelled', canceled: 'cancelled', rejected: 'cancelled', 'ملغي': 'cancelled'
  };
  return t[k] || 'pending';
}

function mapJTStatus(raw) {
  const t = String(raw || '').toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  /* الترتيب مهم: "Return Sign" فيها كلمة sign، فلازم نفحص المرتجع الأول */
  if (has('return', 'rts', 'reject', 'مرتجع', 'راجع', 'إرجاع', 'مرفوض')) return 'returned';
  if (has('cancel', 'ملغي', 'ملغاة')) return 'cancelled';
  if (has('sign', 'delivered', 'تم التسليم', 'تم الاستلام', 'وقّع')) return 'signed';
  return 'shipped';
}

/* ---------- التتبع ---------- */
async function fetchTracking(env, awbs) {
  if (!awbs.length || !env.TRACKING_API_KEY) return [];
  if (env.TRACKING_PROVIDER === 'trackingmore') {
    const q = awbs.map(n => `${encodeURIComponent(n)}:j-t-express-eg`).join(',');
    const r = await fetch(`https://api.trackingmore.com/v4/trackings/get?tracking_numbers=${q}`, {
      headers: { 'Tracking-Api-Key': env.TRACKING_API_KEY, 'Content-Type': 'application/json' }
    });
    if (!r.ok) throw new Error('trackingmore ' + r.status);
    const j = await r.json();
    return (j.data || []).map(it => ({ awb: it.tracking_number, raw: it.substatus || it.delivery_status || '' }));
  }
  const r = await fetch('https://api.track123.com/gateway/open-api/tk/v2/track/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Track123-Api-Secret': env.TRACKING_API_KEY },
    body: JSON.stringify({ trackNos: awbs })
  });
  if (!r.ok) throw new Error('track123 ' + r.status);
  const j = await r.json();
  const items = (j.data && (j.data.accepted || j.data.content)) || [];
  return items.map(it => ({ awb: it.trackNo, raw: it.latestEvent || it.trackStatus || '' }));
}

/** استيراد تتبع J&T — مشتركة بين شاشة الإدارة والإيجنت.
    كل صف ممكن يجيب clientId بتاعه هو (لو المصدر بيفلتر حسب Sender Name)،
    أو يرجع لعميل واحد ثابت جاي من الطلب نفسه */
async function runTrackingImport(env, rows) {
  let matched = 0, collected = 0, signedCount = 0, byRef = 0, returnedCount = 0;
  const unmatched = [];
  for (const r of rows) {
    const awb = String(r.awb || '').trim();
    const ref = String(r.ref || '').trim();
    if (!awb && !ref) continue;

    let o = awb ? await env.DB.prepare(
      'SELECT id, state, other_cost, awb FROM orders WHERE awb = ?'
    ).bind(awb).first() : null;

    if (!o && ref && r.clientId) {
      o = await env.DB.prepare(
        'SELECT id, state, other_cost, awb FROM orders WHERE ref = ? AND client_id = ?'
      ).bind(ref, r.clientId).first();
      if (o) byRef++;
    }
    if (!o) { unmatched.push(awb || ('طلب ' + ref)); continue; }

    const st = r.state && ORDER_STATES.includes(r.state) ? r.state : mapJTStatus(r.status);
    const num = v => (v === undefined || v === null || v === '') ? null : Number(v);
    const ship = num(r.shippingCost);
    const other = num(r.otherCost);

    if ((st === 'signed' || st === 'collected') && (ship === null || isNaN(ship))) {
      await env.DB.prepare('UPDATE orders SET state = ?, checkpoint = ?, awb = COALESCE(?, awb) WHERE id = ?')
        .bind('shipped', 'تم الشحن — ناقص سعر الشحن', awb || null, o.id).run();
      matched++;
      continue;
    }
    const finalOther = other !== null && !isNaN(other)
      ? other
      : (o.other_cost === null || o.other_cost === undefined ? 0 : o.other_cost);

    await env.DB.prepare(
      `UPDATE orders SET state = ?, checkpoint = ?, awb = COALESCE(?, awb),
         shipping_cost = COALESCE(?, shipping_cost), other_cost = ?,
         signed_at = ?, collected_at = ?
       WHERE id = ?`
    ).bind(st, r.status || STATE_TEXT[st] || '', awb || null, ship, finalOther,
      (st === 'signed' || st === 'collected') ? (r.date || new Date().toISOString().slice(0, 10)) : null,
      st === 'collected' ? (r.date || new Date().toISOString().slice(0, 10)) : null, o.id).run();
    matched++;
    if (st === 'returned') returnedCount++;
    if (st === 'signed') signedCount++;
    if (st === 'collected') collected++;
  }
  return { matched, collected, signed: signedCount, returned: returnedCount, byRef,
    unmatched: unmatched.slice(0, 50), unmatchedCount: unmatched.length };
}

async function syncShipments(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, awb, state FROM orders
     WHERE awb IS NOT NULL AND state NOT IN ('signed','collected','returned','cancelled') LIMIT 300`
  ).all();
  const open = results || [];
  let changed = 0;
  for (let i = 0; i < open.length; i += 100) {
    const batch = open.slice(i, i + 100);
    let res = [];
    try { res = await fetchTracking(env, batch.map(o => o.awb)); }
    catch (e) { console.error('tracking:', e.message); continue; }
    for (const r of res) {
      const o = batch.find(x => x.awb === r.awb);
      if (!o) continue;
      const st = mapJTStatus(r.raw);
      if (st === o.state) continue;
      await env.DB.prepare('UPDATE orders SET state = ?, checkpoint = ? WHERE id = ?')
        .bind(st, r.raw || STATE_TEXT[st], o.id).run();
      changed++;
    }
  }
  return changed;
}

/* ---------- الصلاحيات ---------- */
/** العميل بياخد بياناته هو بس — الفلترة هنا على السيرفر مش في المتصفح */
/* ---------- الربح والخسارة لكل عميل ----------
   نسبة التسليم: تلقائي = مُسلَّم ÷ (مُسلَّم + مرتجع) من سجل الحالات الفعلي، أو نسبة يدوية يحطها العميل.
   ربح الأوردر = الإيراد − تكلفة المنتج − الشحن − مصاريف تانية − مبلغ الإدارة الثابت (تحدده الإدارة لكل متجر).
   منتظرة = وصلت (signed) ولسه ما اتحصّلتش. محصّلة = اتحصّلت فعلاً (collected).
   متوقعة = أرباح كل الأوردرات المرفوعة (غير الملغاة/المرتجعة) × نسبة التسليم. */
/** تكلفة الشحن المتوقعة لأوردر لسه ما اتسجّلش له تكلفة شحن حقيقية — من إعدادات المتجر */
function estimateShipping(client, gov) {
  if (client.shippingMode === 'byGov') {
    const table = client.shippingByGov || {};
    const g = String(gov || '').trim();
    if (g && table[g] != null) return Number(table[g]) || 0;
    const vals = Object.values(table).map(Number).filter(Number.isFinite);
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  }
  return Number(client.shippingFixed) || 0;
}

function computeFinance(state, orders, clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return null;
  const co = orders.filter(o => o.clientId === clientId);
  const adminFee = Number(client.adminFee) || 0;

  const delivered = co.filter(o => o.state === 'signed' || o.state === 'collected');
  const returned = co.filter(o => o.state === 'returned');
  const collected = co.filter(o => o.state === 'collected');
  const pendingCollection = co.filter(o => o.state === 'signed');
  const nonCancelled = co.filter(o => o.state !== 'cancelled');

  let deliveryRate;
  if (client.deliveryRateMode === 'manual' && client.deliveryRateManual != null) {
    deliveryRate = Math.max(0, Math.min(100, Number(client.deliveryRateManual) || 0));
  } else {
    const finalCount = delivered.length + returned.length;
    deliveryRate = finalCount > 0 ? Math.round((delivered.length / finalCount) * 1000) / 10 : 0;
  }

  const profitOf = o => (Number(o.total) || 0) - (Number(o.productCost) || 0)
    - (Number(o.shippingCost) || 0) - (Number(o.otherCost) || 0) - adminFee;
  /* لأوردرات لسه في الطريق (شحن حقيقي مش متسجّل)، نستخدم تقدير من إعدادات المتجر بدل ما نحسبها صفر */
  const profitOfEstimated = o => (Number(o.total) || 0) - (Number(o.productCost) || 0)
    - (o.shippingCost != null ? Number(o.shippingCost) : estimateShipping(client, o.gov))
    - (Number(o.otherCost) || 0) - adminFee;

  const adSpend = round2(state.entries.filter(e => e.clientId === clientId)
    .reduce((s, e) => s + (Number(e.adSpend) || 0), 0));
  const uploaded = nonCancelled.length;
  const cpaBeforeRate = uploaded > 0 ? round2(adSpend / uploaded) : 0;
  const expectedDelivered = uploaded * (deliveryRate / 100);
  const cpaAfterRate = expectedDelivered > 0 ? round2(adSpend / expectedDelivered) : 0;

  const pipeline = nonCancelled.filter(o => o.state !== 'returned');
  const revenueExpected = round2(pipeline.reduce((s, o) => s + (Number(o.total) || 0), 0) * (deliveryRate / 100));
  const profitExpected = round2(pipeline.reduce((s, o) => s + profitOfEstimated(o), 0) * (deliveryRate / 100));

  const today = new Date().toISOString().slice(0, 10);
  const ordersToday = co.filter(o => String(o.date || '').slice(0, 10) === today).length;

  return {
    deliveryRatePct: deliveryRate, deliveryRateMode: client.deliveryRateMode || 'auto',
    ordersToday, adminFee, adSpend, cpaBeforeRate, cpaAfterRate, revenueExpected,
    profitPending: round2(pendingCollection.reduce((s, o) => s + profitOf(o), 0)),
    profitCollected: round2(collected.reduce((s, o) => s + profitOf(o), 0)),
    profitExpected,
    counts: { delivered: delivered.length, returned: returned.length, collected: collected.length,
      pendingCollection: pendingCollection.length, uploaded }
  };
}

function scopeForClient(state, orders, clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return null;
  const masked = maskClientSecrets({ clients: [client] }).clients[0];
  delete masked.code;

  const rate = Number(client.taxRate) || 14;
  const entries = state.entries
    .filter(e => e.clientId === clientId)
    .map(e => client.taxEnabled
      ? { ...e, adSpend: Math.round(e.adSpend * (1 + rate / 100) * 100) / 100, adSpendNet: e.adSpend, taxApplied: true, taxRate: rate }
      : { ...e, taxApplied: false });

  return {
    agency: { name: state.agency.name },
    clients: [masked],
    entries,
    funding: state.funding.filter(f => f.clientId === clientId),
    orders: orders.filter(o => o.clientId === clientId)
  };
}

/* ---------- المسارات ---------- */
async function handleApi(request, env, url, path) {
  const secret = env.SESSION_SECRET;
  if (!secret) return json({ error: 'SESSION_SECRET مش متظبط في إعدادات Cloudflare' }, 500);

  /* ---------- استقبال آلي من أنظمة خارجية (OpenClaw / سكريبت) ----------
     بتوكن مستقل مش بجلسة متصفح. التوكن ده صلاحيته محدودة جداً:
     يقرا حسابات الإعلانات، ويكتب مصروف إعلانات. مش أكتر. */
  const ingestToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const isIngest = env.INGEST_TOKEN && ingestToken && safeEqual(ingestToken, env.INGEST_TOKEN);

  if (path === '/api/ad-accounts' && request.method === 'GET' && isIngest) {
    const state = await loadState(env);
    return json((state.clients || [])
      .filter(c => c.status === 'active' && c.adAccount)
      .map(c => ({
        clientId: c.id, name: c.name, adAccount: c.adAccount, currency: c.currency,
        /* لو العميل مسطّب توكن Meta خاص بيه، الأجنت يستخدمه بدل التوكن المركزي */
        metaToken: c.metaToken || null
      })));
  }

  /* قايمة خفيفة بكل المتاجر النشطة — للإيجنتات الخارجية.
     senderName بتفيد مطابقة كشوف J&T، adAccount بتفيد مصروف الإعلانات */
  if (path === '/api/clients' && request.method === 'GET' && isIngest) {
    const state = await loadState(env);
    return json((state.clients || [])
      .filter(c => c.status === 'active')
      .map(c => ({
        id: c.id, name: c.name, senderName: c.senderName || '',
        adAccount: c.adAccount || '', currency: c.currency, market: c.market
      })));
  }

  /* كتالوج منتجات متجر معيّن — للإيجنت يطابق بيه اسم المنتج في رسالة العميل */
  if (path === '/api/products' && request.method === 'GET' && isIngest) {
    const cid = url.searchParams.get('clientId');
    if (!cid) return json({ error: 'clientId مطلوب' }, 400);
    return json(await listProducts(env, cid));
  }

  /* استيراد شحنات J&T بالتوكن — للإيجنتات الخارجية. tracking بس، مش orders —
     إنشاء الأوردرات ليها مسار مخصص (wa-order) بتحقق أدق */
  if (path === '/api/orders/bulk' && request.method === 'POST' && isIngest) {
    const b = await request.json().catch(() => ({}));
    if (b.mode !== 'tracking') return json({ error: 'التوكن ده مسموح له بشحنات J&T بس' }, 403);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [];
    if (!rows.length) return json({ error: 'مفيش صفوف' }, 400);
    const result = await runTrackingImport(env, rows);
    return json({ ok: true, ...result });
  }

  /* تسجيل أوردر جاي من جروب واتساب. بيتحقق من التليفون والمبلغ بصرامة —
     الرسائل الحرة عرضة للأخطاء أكتر من شيت منظم */
  if (path === '/api/wa-order' && request.method === 'POST' && isIngest) {
    const b = await request.json().catch(() => ({}));
    if (!b.clientId) return json({ error: 'محتاجين نعرف المتجر', field: 'clientId' }, 400);

    const state = await loadState(env);
    const client = (state.clients || []).find(c => c.id === b.clientId);
    if (!client || client.status !== 'active') return json({ error: 'المتجر مش موجود أو موقوف' }, 400);

    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'اسم المشتري مطلوب', field: 'name' }, 400);

    const phone = normalizePhone(b.phone);
    if (!phone) {
      return json({
        error: 'رقم التليفون مش صحيح — لازم يبدأ بـ 01 (مصر، 11 رقم) أو 05 (السعودية، 10 أرقام)',
        field: 'phone'
      }, 400);
    }

    const qty = Math.max(1, Number(b.qty) || 1);
    let productRow = null;
    if (b.productId) {
      productRow = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND client_id = ?')
        .bind(b.productId, b.clientId).first();
    }

    let unitPrice = productRow ? Number(productRow.price) || 0 : (Number(b.unitPrice) || 0);
    let total = Number(b.total) || (unitPrice ? unitPrice * qty : 0);
    if (!total || total <= 0) {
      return json({ error: 'محتاجين سعر الأوردر — اختار منتج من الكتالوج أو ابعت المبلغ', field: 'total' }, 400);
    }

    const id = 'WA-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    const order = {
      id, clientId: b.clientId, ref: b.ref || null,
      date: new Date().toISOString().slice(0, 10),
      name, phone, gov: String(b.gov || '').trim(), address: String(b.address || '').trim(),
      product: productRow ? productRow.name : String(b.product || '').trim(),
      productId: productRow ? productRow.id : null,
      unitPrice, qty, total,
      productCost: productRow ? (Number(productRow.cost) || 0) * qty : 0,
      source: 'واتساب', note: String(b.note || '').trim(),
      state: 'pending', checkpoint: STATE_TEXT.pending
    };
    await insertOrder(env, order);
    return json({ ok: true, id, order });
  }

  /* تعديل أوردر واتساب — بمعرّفه أو بمرجعه (ref) جوه نفس المتجر.
     مسموح بس للأوردرات اللي مصدرها واتساب ولسه في مراحلها الأولى */
  if (path === '/api/wa-order' && request.method === 'PATCH' && isIngest) {
    const b = await request.json().catch(() => ({}));
    let order = null;
    if (b.id) order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(b.id).first();
    if (!order && b.ref && b.clientId) {
      order = await env.DB.prepare('SELECT * FROM orders WHERE ref = ? AND client_id = ?')
        .bind(b.ref, b.clientId).first();
    }
    if (!order) return json({ error: 'الأوردر مش موجود — محتاجين id أو ref+clientId' }, 404);
    if (order.source !== 'واتساب') return json({ error: 'الأوردر ده مصدره مش واتساب — عدّله من لوحة الإدارة' }, 403);
    if (['collected', 'returned', 'cancelled'].includes(order.state)) {
      return json({ error: `الأوردر خلاص اتقفل (${STATE_TEXT[order.state]}) — كلّم الإدارة لو محتاج تعديل` }, 409);
    }

    const fields = {};
    if (b.name !== undefined) fields.name = String(b.name).trim();
    if (b.phone !== undefined) {
      const p = normalizePhone(b.phone);
      if (!p) return json({ error: 'رقم التليفون مش صحيح', field: 'phone' }, 400);
      fields.phone = p;
    }
    if (b.gov !== undefined) fields.gov = String(b.gov).trim();
    if (b.address !== undefined) fields.address = String(b.address).trim();
    if (b.note !== undefined) fields.note = String(b.note).trim();
    if (b.qty !== undefined) fields.qty = Math.max(1, Number(b.qty) || 1);

    if (b.productId !== undefined) {
      const pr = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND client_id = ?')
        .bind(b.productId, order.client_id).first();
      if (pr) {
        fields.product_id = pr.id; fields.product = pr.name; fields.unit_price = pr.price;
        fields.product_cost = (Number(pr.cost) || 0) * (fields.qty || order.qty);
        if (b.total === undefined) fields.total = Number(pr.price) * (fields.qty || order.qty);
      }
    }
    if (b.total !== undefined) {
      const t = Number(b.total);
      if (!t || t <= 0) return json({ error: 'السعر لازم يكون أكبر من صفر', field: 'total' }, 400);
      fields.total = t;
    }
    if (!Object.keys(fields).length) return json({ error: 'مفيش حاجة اتبعتت للتعديل' }, 400);

    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    await env.DB.prepare(`UPDATE orders SET ${sets} WHERE id = ?`)
      .bind(...Object.values(fields), order.id).run();
    return json({ ok: true, id: order.id });
  }

  if (path === '/api/wa-groups' && request.method === 'GET' && isIngest) {
    /* للأجنت (OpenClaw) — خريطة Group ID → clientId لكل الجروبات المربوطة والمفعّلة.
       ده البديل الحي لملف wa-groups.json الثابت */
    const state = await loadState(env);
    const groups = {};
    (state.clients || []).forEach(c => {
      if (c.status !== 'active') return;
      (c.whatsappGroups || []).forEach(g => { if (g.groupId) groups[g.groupId] = c.id; });
    });
    return json({ groups });
  }

  if (path === '/api/ad-spend' && request.method === 'POST') {
    /* بيقبل التوكن أو جلسة عندها صلاحية الإدخال اليومي */
    let allowed = isIngest;
    if (!allowed) {
      const sess = await readSession(request, secret);
      if (sess && sess.uid) {
        const u = await env.DB.prepare('SELECT role, status FROM users WHERE id = ?').bind(sess.uid).first();
        allowed = u && u.status === 'active' && permsOf(u.role).includes('entries');
      }
    }
    if (!allowed) return json({ error: 'مش مسموح' }, 403);

    const b = await request.json().catch(() => ({}));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))
      ? b.date : new Date().toISOString().slice(0, 10);
    const rows = Array.isArray(b.entries) ? b.entries
      : (b.clientId || b.adAccount) ? [{ clientId: b.clientId, adAccount: b.adAccount, spend: b.spend }]
      : [];
    if (!rows.length) return json({ error: 'مفيش بيانات' }, 400);

    const state = await loadState(env);
    state.entries = state.entries || [];
    const applied = [], skipped = [];

    for (const r of rows) {
      const spend = Number(r.spend);
      if (!Number.isFinite(spend) || spend < 0) { skipped.push({ ...r, why: 'مبلغ غير صالح' }); continue; }

      /* بندوّر بالعميل أو بحساب الإعلانات — OpenClaw بيعرف حساب الإعلانات بس */
      const client = r.clientId
        ? (state.clients || []).find(c => c.id === r.clientId)
        : (state.clients || []).find(c => String(c.adAccount || '').replace(/^act_/, '')
            === String(r.adAccount || '').replace(/^act_/, ''));
      if (!client) { skipped.push({ ...r, why: 'مالقيناش المتجر' }); continue; }

      if (r.balance !== undefined && Number.isFinite(Number(r.balance))) {
        client.metaBalance = round2(Number(r.balance));
        client.metaBalanceCurrency = r.balanceCurrency || client.currency || '';
        client.metaBalanceAt = new Date().toISOString();
      }

      const existing = state.entries.find(e => e.clientId === client.id && e.date === date);
      if (existing) {
        /* الإدخال اليدوي أولى — ما بنكتبش فوقه إلا لو الطلب صريح */
        if (existing.source === 'manual' && !b.overwrite) {
          skipped.push({ client: client.name, why: 'فيه إدخال يدوي لنفس اليوم' });
          continue;
        }
        existing.adSpend = spend;
        existing.source = 'auto';
        existing.syncedAt = new Date().toISOString();
      } else {
        state.entries.push({
          id: crypto.randomUUID().slice(0, 8), clientId: client.id, date,
          adSpend: spend, orders: 0, source: 'auto', syncedAt: new Date().toISOString()
        });
      }
      applied.push({ client: client.name, spend });
    }

    if (applied.length) await saveState(env, state);
    return json({ ok: true, date, applied, skipped });
  }

  /* أول تشغيل: إنشاء حساب الإدارة — متاح بس لما الجدول يكون فاضي */
  if (path === '/api/setup' && request.method === 'POST') {
    if (await countUsers(env) > 0) return json({ error: 'النظام متظبط بالفعل' }, 403);
    const { email = '', password = '' } = await request.json().catch(() => ({}));
    const mail = String(email).trim().toLowerCase();
    if (!mail.includes('@')) return json({ error: 'اكتب إيميل صحيح' }, 400);
    if (String(password).length < MIN_PASSWORD) {
      return json({ error: `كلمة المرور لازم تكون ${MIN_PASSWORD} حروف على الأقل` }, 400);
    }
    const uid = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, password, role, client_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(uid, mail, 'الإدارة', await hashPassword(password), 'admin', null, 'active',
      new Date().toISOString()).run();

    const state = await loadState(env);
    state.agency.adminEmail = mail;
    await saveState(env, state);

    const token = await makeSession({ role: 'admin', email: mail, uid }, secret);
    return json({ role: 'admin', email: mail }, 200, {
      'Set-Cookie': `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${WEEK}`
    });
  }

  /* تسجيل الدخول — الإيميل وكلمة المرور بيتطابقوا مع جدول users */
  if (path === '/api/login' && request.method === 'POST') {
    const { email = '', password = '' } = await request.json().catch(() => ({}));
    const mail = String(email).trim().toLowerCase();
    if (!mail || !password) return json({ error: 'اكتب الإيميل وكلمة المرور' }, 400);

    const lockedFor = await checkLock(env, mail);
    if (lockedFor) {
      return json({ error: `الحساب متقفل مؤقتاً. جرّب تاني بعد ${lockedFor} دقيقة.` }, 429);
    }

    const user = await findUserByEmail(env, mail);
    /* بنتحقق من كلمة المرور حتى لو الحساب مش موجود — عشان الرد ياخد نفس الوقت
       وما يبانش من السرعة إن الإيميل ده مسجّل عندنا ولا لأ */
    const ok = user
      ? await verifyPassword(password, user.password)
      : await verifyPassword(password, await hashPassword('__dummy__'));

    if (!user || !ok) {
      const left = await recordFail(env, mail);
      const hint = left > 0 && left <= 2 ? ` فاضل ${left} محاولات قبل القفل.` : '';
      return json({ error: 'الإيميل أو كلمة المرور غير صحيحة.' + hint }, 401);
    }
    if (user.status !== 'active') return json({ error: 'الحساب موقوف. كلّم فريق كن أونلاين.' }, 403);

    await clearFails(env, mail);
    await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?')
      .bind(new Date().toISOString(), user.id).run();

    const payload = user.role === 'client'
      ? { role: 'client', clientId: user.client_id, email: user.email, uid: user.id }
      : { role: 'admin', email: user.email, uid: user.id };
    const token = await makeSession(payload, secret);
    return json(payload, 200, {
      'Set-Cookie': `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${WEEK}`
    });
  }

  if (path === '/api/logout') {
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }

  const session = await readSession(request, secret);
  if (!session) {
    if (path === '/api/me') return json({ role: null, needsSetup: (await countUsers(env)) === 0 });
    return json({ error: 'محتاج تسجّل دخول' }, 401);
  }

  /* بنقرأ الحساب من قاعدة البيانات مع كل طلب — عشان لو غيّرت صلاحياته
     أو أوقفته، يتنفّذ فوراً من غير ما يستنى جلسته تنتهي */
  const user = session.uid
    ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.uid).first()
    : await findUserByEmail(env, session.email || '');
  if (!user || user.status !== 'active') {
    return json({ error: 'الحساب مش نشط. سجّل دخول تاني.' }, 401, {
      'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    });
  }
  const me = {
    role: user.role, clientId: user.client_id, email: user.email,
    name: user.name || '', uid: user.id, perms: permsOf(user.role)
  };
  if (path === '/api/me') return json(me);

  /* قراءة البيانات */
  if (path === '/api/state' && request.method === 'GET') {
    const state = await loadState(env);
    if (isStaff(user)) {
      const masked = maskClientSecrets(state);
      return json({ ...masked, orders: await listOrders(env), products: await listProducts(env), roles: ROLES });
    }
    const scoped = scopeForClient(state, await listOrders(env, me.clientId), me.clientId);
    if (scoped) scoped.products = await listProducts(env, me.clientId);
    return scoped ? json(scoped) : json({ error: 'الحساب مش موجود' }, 404);
  }

  /* حفظ البيانات — الإدارة بس */
  if (path === '/api/state' && request.method === 'PUT') {
    const body = await request.json();
    delete body.orders; delete body.roles; delete body.products;
    (body.clients || []).forEach(c => { delete c.password; delete c.code; });

    if (can(user, 'settings')) {           /* المدير بيحفظ كل حاجة */
      const current = await loadState(env);
      preserveUntouchedSecrets(body, current);
      await saveState(env, body);
      return json({ ok: true });
    }
    /* غير المدير بيعدّل الأجزاء المسموح له بيها بس — والباقي بيفضل زي ما هو */
    const current = await loadState(env);
    if (can(user, 'entries')) current.entries = body.entries || current.entries;
    if (can(user, 'finance')) current.funding = body.funding || current.funding;
    if (!can(user, 'entries') && !can(user, 'finance')) {
      return json({ error: 'مش مسموح' }, 403);
    }
    await saveState(env, current);
    return json({ ok: true });
  }

  /* تسجيل أوردر — العميل لحسابه هو، والإدارة لأي حساب */
  if (path === '/api/orders' && request.method === 'POST') {
    const o = await request.json();
    if (user.role === 'client') o.clientId = me.clientId;
    else if (!can(user, 'orders')) return json({ error: 'مش مسموح' }, 403);
    if (!o.clientId || !o.name || !o.phone) return json({ error: 'بيانات ناقصة' }, 400);
    o.id = await nextOrderCode(env, o.name);
    o.state = ORDER_STATES.includes(o.state) ? o.state : 'pending';
    o.checkpoint = o.checkpoint || STATE_TEXT.pending;
    await insertOrder(env, o);
    return json({ ok: true, order: o });
  }

  /* تعديل حالة أو بوليصة — الإدارة بس */
  const m = path !== '/api/orders/bulk' ? path.match(/^\/api\/orders\/([^/]+)$/) : null;
  if (m && isStaff(user) && can(user, 'orders')) {
    const id = decodeURIComponent(m[1]);
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (request.method === 'PATCH') {
      const p = await request.json();
      const cur = await env.DB.prepare(
        'SELECT state, awb, shipping_cost, other_cost, signed_at, history FROM orders WHERE id = ?'
      ).bind(id).first();
      if (!cur) return json({ error: 'أوردر غير موجود' }, 404);

      let st = p.state || cur.state;
      const awb = p.awb !== undefined ? (p.awb || null) : cur.awb;
      if (p.awb && ['pending','confirmed','preparing'].includes(cur.state) && !p.state) st = 'shipped';
      if (!ORDER_STATES.includes(st)) return json({ error: 'حالة غير معروفة' }, 400);

      const num = v => (v === undefined || v === null || v === '') ? null : Number(v);
      let ship  = p.shippingCost !== undefined ? num(p.shippingCost) : cur.shipping_cost;
      let other = p.otherCost    !== undefined ? num(p.otherCost)    : cur.other_cost;

      /* التحصيل ما يتسجّلش من غير تكاليفه — وإلا الربح هيطلع أعلى من الحقيقة */
      if (st === 'collected' && (ship === null || other === null || isNaN(ship) || isNaN(other))) {
        return json({ error: 'قبل ما تسجّل التحصيل لازم تحدد سعر الشحن والمصاريف الأخرى', needCosts: true }, 400);
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const collectedAt = st === 'collected' ? (p.collectedAt || stamp) : null;
      const signedAt = (st === 'signed' || st === 'collected')
        ? (p.signedAt || cur.signed_at || stamp) : null;

      const history = parseJsonArr(cur.history);
      if (st !== cur.state) history.push({ state: st, at: new Date().toISOString() });

      await env.DB.prepare(
        'UPDATE orders SET state = ?, awb = ?, checkpoint = ?, shipping_cost = ?, other_cost = ?, signed_at = ?, collected_at = ?, history = ? WHERE id = ?'
      ).bind(st, awb, STATE_TEXT[st] || '', ship, other, signedAt, collectedAt, JSON.stringify(history), id).run();
      return json({ ok: true, state: st, history });
    }
  }

  /* محاولات التواصل مع العميل — أقصى ٣ في اليوم و١٠ خلال ٣ أيام */
  const cm = path.match(/^\/api\/orders\/([^/]+)\/contact$/);
  if (cm && request.method === 'POST' && isStaff(user) && can(user, 'orders')) {
    const id = decodeURIComponent(cm[1]);
    const cur = await env.DB.prepare('SELECT contact_log, history FROM orders WHERE id = ?').bind(id).first();
    if (!cur) return json({ error: 'أوردر غير موجود' }, 404);

    const log = parseJsonArr(cur.contact_log);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const todayCount = log.filter(t => String(t).slice(0, 10) === today).length;
    const last3DaysCount = log.filter(t => new Date(t) >= threeDaysAgo).length;

    if (todayCount >= 3) {
      return json({ error: 'تجاوزت عدد مرات التواصل المسموح بها لهذا اليوم (٣ محاولات)', log }, 429);
    }
    if (last3DaysCount >= 10) {
      return json({ error: 'تجاوزت الحد الأقصى لمحاولات التواصل خلال ٣ أيام (١٠ محاولات)', log }, 429);
    }
    log.push(now.toISOString());
    const history = parseJsonArr(cur.history);
    history.push({ type: 'contact', at: now.toISOString(), by: user.email || user.role });
    await env.DB.prepare('UPDATE orders SET contact_log = ?, history = ? WHERE id = ?')
      .bind(JSON.stringify(log), JSON.stringify(history), id).run();
    return json({ ok: true, log, history, todayCount: todayCount + 1 });
  }

  /* تسجيل إرسال رسالة واتساب في تاريخ الأوردر */
  const wm = path.match(/^\/api\/orders\/([^/]+)\/whatsapp-log$/);
  if (wm && request.method === 'POST' && isStaff(user) && can(user, 'orders')) {
    const id = decodeURIComponent(wm[1]);
    const b = await request.json().catch(() => ({}));
    const cur = await env.DB.prepare('SELECT history FROM orders WHERE id = ?').bind(id).first();
    if (!cur) return json({ error: 'أوردر غير موجود' }, 404);
    const history = parseJsonArr(cur.history);
    const template = ['confirm', 'shipped', 'review'].includes(b.template) ? b.template : 'other';
    history.push({ type: 'whatsapp', template, at: new Date().toISOString(), by: user.email || user.role });
    await env.DB.prepare('UPDATE orders SET history = ? WHERE id = ?').bind(JSON.stringify(history), id).run();
    return json({ ok: true, history });
  }

  /* أي حد داخل يقدر يغيّر كلمة مروره هو */
  if (path === '/api/change-password' && request.method === 'POST') {
    const { current = '', next = '' } = await request.json().catch(() => ({}));
    if (String(next).length < MIN_PASSWORD) {
      return json({ error: `كلمة المرور الجديدة لازم تكون ${MIN_PASSWORD} حروف على الأقل` }, 400);
    }
    if (!await verifyPassword(current, user.password)) {
      return json({ error: 'كلمة المرور الحالية غير صحيحة' }, 401);
    }
    await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
      .bind(await hashPassword(next), user.id).run();
    return json({ ok: true });
  }

  /* إدارة الحسابات — الإدارة بس */
  if (path === '/api/users') {
    if (!can(user, 'users')) return json({ error: 'مش مسموح' }, 403);

    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, email, name, role, client_id, status, last_login FROM users ORDER BY role, email'
      ).all();
      return json((results || []).map(publicUser));
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const mail = String(b.email || '').trim().toLowerCase();
      const role = ROLES[b.role] ? b.role : 'client';
      if (!mail.includes('@')) return json({ error: 'اكتب إيميل صحيح' }, 400);
      if (b.password && String(b.password).length < MIN_PASSWORD) {
        return json({ error: `كلمة المرور لازم تكون ${MIN_PASSWORD} حروف على الأقل` }, 400);
      }

      /* بندوّر بالعميل الأول عشان لو الإيميل اتغيّر نعدّل نفس الحساب مش نعمل جديد */
      let target = (role === 'client' && b.clientId)
        ? await env.DB.prepare('SELECT * FROM users WHERE client_id = ?').bind(b.clientId).first()
        : (b.id ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(b.id).first() : null);

      const byEmail = await findUserByEmail(env, mail);

      /* الإيميل لو موجود، لازم يكون بتاع نفس صاحب الحساب ونفس الدور —
         من غير الشرط ده كنت تقدر تحوّل حساب إدارة لحساب عميل بالغلط */
      if (!target && byEmail) {
        const sameOwner = (byEmail.client_id || null) === (role === 'client' ? (b.clientId || null) : null)
          && byEmail.role === role;
        if (!sameOwner) return json({ error: 'الإيميل ده مستخدم في حساب تاني' }, 409);
        target = byEmail;
      }
      if (target && byEmail && byEmail.id !== target.id) {
        return json({ error: 'الإيميل ده مستخدم في حساب تاني' }, 409);
      }

      if (target) {
        const pass = b.password ? await hashPassword(b.password) : target.password;
        /* آخر مدير ما ينفعش ينزل من الإدارة — وإلا يتقفل النظام على الكل */
        if (target.role === 'admin' && role !== 'admin') {
          const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
          if (((r && r.n) || 0) <= 1) return json({ error: 'ما ينفعش تشيل صلاحية آخر مدير' }, 400);
        }
        await env.DB.prepare(
          'UPDATE users SET email = ?, name = ?, password = ?, role = ?, client_id = ?, status = ? WHERE id = ?'
        ).bind(mail, b.name || target.name || '', pass, role,
          role === 'client' ? (b.clientId || null) : null,
          b.status || target.status, target.id).run();
        if (b.password) await clearFails(env, mail);
        return json({ ok: true, created: false });
      }

      if (!b.password) return json({ error: 'الحساب جديد — لازم تحدد كلمة مرور' }, 400);
      await env.DB.prepare(
        'INSERT INTO users (id, email, name, password, role, client_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(crypto.randomUUID(), mail, b.name || '', await hashPassword(b.password), role,
        role === 'client' ? (b.clientId || null) : null, b.status || 'active',
        new Date().toISOString()).run();
      return json({ ok: true, created: true });
    }
  }

  const um = path.match(/^\/api\/users\/([^/]+)$/);
  if (um && can(user, 'users') && request.method === 'DELETE') {
    const id = decodeURIComponent(um[1]);
    const target = await env.DB.prepare('SELECT email, role FROM users WHERE id = ?').bind(id).first();
    if (!target) return json({ error: 'الحساب مش موجود' }, 404);
    if (target.role === 'admin') {
      const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
      if (((r && r.n) || 0) <= 1) return json({ error: 'ما ينفعش تمسح آخر حساب إدارة' }, 400);
    }
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  /* ---------- منتجات المتجر ---------- */
  if (path === '/api/products') {
    if (request.method === 'GET') {
      return json(await listProducts(env, user.role === 'client' ? me.clientId : url.searchParams.get('clientId')));
    }
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const clientId = user.role === 'client' ? me.clientId : b.clientId;
      if (!clientId) return json({ error: 'اختار المتجر' }, 400);
      if (user.role !== 'client' && !can(user, 'clients') && !can(user, 'orders')) {
        return json({ error: 'مش مسموح' }, 403);
      }
      /* صاحب المتجر بيدير منتجاته هو بس — الـ clientId اتفرض فوق */
      if (!b.name) return json({ error: 'اسم المنتج مطلوب' }, 400);
      const id = b.id || 'P-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      await env.DB.prepare(
        `INSERT INTO products (${PRODUCT_COLS}) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, sku=excluded.sku, price=excluded.price,
           cost=excluded.cost, active=excluded.active`
      ).bind(id, clientId, b.name, b.sku || '', Number(b.price) || 0, Number(b.cost) || 0,
        b.active === false ? 0 : 1, new Date().toISOString()).run();
      return json({ ok: true, id });
    }
  }

  const pm = path.match(/^\/api\/products\/([^/]+)$/);
  if (pm && request.method === 'DELETE') {
    const pid = decodeURIComponent(pm[1]);
    const row = await env.DB.prepare('SELECT client_id FROM products WHERE id = ?').bind(pid).first();
    if (!row) return json({ error: 'المنتج مش موجود' }, 404);
    if (user.role === 'client' && row.client_id !== me.clientId) return json({ error: 'مش مسموح' }, 403);
    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(pid).run();
    return json({ ok: true });
  }

  /* ---------- التوكن والـ API (Meta + إيزي أوردرز) + ضريبة الـ 14% + ربط الإيميل ----------
     العميل بيدير بياناته هو بس. الإدارة بتدير أي عميل بصلاحية 'clients' أو 'settings'.
     التوكنز بترجع Set:true/false + آخر ٤ حروف بس — أبداً القيمة الكاملة */
  function integrationsView(c) {
    const masked = maskClientSecrets({ clients: [c] }).clients[0];
    return {
      clientId: c.id,
      metaAdAccountId: c.adAccount || '',
      metaTokenSet: masked.metaTokenSet, metaTokenTail: masked.metaTokenTail || '',
      metaBalance: c.metaBalance != null ? c.metaBalance : null,
      metaBalanceCurrency: c.metaBalanceCurrency || '',
      metaBalanceAt: c.metaBalanceAt || null,
      taxEnabled: !!c.taxEnabled, taxRate: Number(c.taxRate) || 14,
      easyOrdersStoreId: c.storeId || '',
      easyOrdersTokenSet: masked.easyOrdersTokenSet, easyOrdersTokenTail: masked.easyOrdersTokenTail || '',
      deliveryRateMode: c.deliveryRateMode || 'auto',
      deliveryRateManual: c.deliveryRateManual != null ? c.deliveryRateManual : null,
      adminFee: Number(c.adminFee) || 0,
      shippingMode: c.shippingMode === 'byGov' ? 'byGov' : 'fixed',
      shippingFixed: Number(c.shippingFixed) || 0,
      shippingByGov: c.shippingByGov && typeof c.shippingByGov === 'object' ? c.shippingByGov : {},
      email: {
        enabled: !!c.emailEnabled, host: c.emailHost || '', port: c.emailPort || '',
        secure: c.emailSecure !== false, user: c.emailUser || '',
        passwordSet: masked.emailPasswordSet, passwordTail: masked.emailPasswordTail || ''
      }
    };
  }

  if (path === '/api/integrations') {
    const staffAccess = isStaff(user) && (can(user, 'clients') || can(user, 'settings'));
    const qcid = url.searchParams.get('clientId');
    if (user.role === 'client' && qcid && qcid !== me.clientId) return json({ error: 'مش مسموح' }, 403);
    const targetId = user.role === 'client' ? me.clientId : qcid;
    if (user.role !== 'client' && !staffAccess) return json({ error: 'مش مسموح' }, 403);
    if (!targetId) return json({ error: 'محتاجين clientId' }, 400);

    const state = await loadState(env);
    const client = state.clients.find(c => c.id === targetId);
    if (!client) return json({ error: 'العميل مش موجود' }, 404);

    if (request.method === 'GET') return json(integrationsView(client));

    if (request.method === 'PUT') {
      const b = await request.json().catch(() => ({}));
      if (b.metaAdAccountId !== undefined) client.adAccount = String(b.metaAdAccountId).trim();
      if (b.metaToken !== undefined) {
        if (String(b.metaToken).trim() === '') delete client.metaToken;
        else client.metaToken = String(b.metaToken).trim();
      }
      if (b.easyOrdersStoreId !== undefined) client.storeId = String(b.easyOrdersStoreId).trim();
      if (b.easyOrdersToken !== undefined) {
        if (String(b.easyOrdersToken).trim() === '') delete client.easyOrdersToken;
        else client.easyOrdersToken = String(b.easyOrdersToken).trim();
      }
      if (b.taxEnabled !== undefined) client.taxEnabled = !!b.taxEnabled;
      if (b.taxRate !== undefined) {
        const r = Number(b.taxRate);
        client.taxRate = Number.isFinite(r) ? Math.max(0, Math.min(100, r)) : 14;
      }
      if (b.deliveryRateMode !== undefined) client.deliveryRateMode = b.deliveryRateMode === 'manual' ? 'manual' : 'auto';
      if (b.deliveryRateManual !== undefined) {
        const r = Number(b.deliveryRateManual);
        client.deliveryRateManual = Number.isFinite(r) ? Math.max(0, Math.min(100, r)) : null;
      }
      if (b.adminFee !== undefined && isStaff(user)) {
        const f = Number(b.adminFee);
        client.adminFee = Number.isFinite(f) ? Math.max(0, f) : 0;
      }
      if (b.shippingMode !== undefined) client.shippingMode = b.shippingMode === 'byGov' ? 'byGov' : 'fixed';
      if (b.shippingFixed !== undefined) {
        const f = Number(b.shippingFixed);
        client.shippingFixed = Number.isFinite(f) ? Math.max(0, f) : 0;
      }
      if (b.shippingByGov !== undefined && b.shippingByGov && typeof b.shippingByGov === 'object') {
        const clean = {};
        for (const [gov, rate] of Object.entries(b.shippingByGov)) {
          const r = Number(rate);
          if (String(gov).trim() && Number.isFinite(r)) clean[String(gov).trim()] = Math.max(0, r);
        }
        client.shippingByGov = clean;
      }
      if (b.emailEnabled !== undefined) client.emailEnabled = !!b.emailEnabled;
      if (b.emailHost !== undefined) client.emailHost = String(b.emailHost).trim();
      if (b.emailPort !== undefined) client.emailPort = String(b.emailPort).trim();
      if (b.emailSecure !== undefined) client.emailSecure = !!b.emailSecure;
      if (b.emailUser !== undefined) client.emailUser = String(b.emailUser).trim();
      if (b.emailPassword !== undefined) {
        if (String(b.emailPassword).trim() === '') delete client.emailPassword;
        else client.emailPassword = String(b.emailPassword).trim();
      }
      await saveState(env, state);
      return json({ ok: true, ...integrationsView(client) });
    }
  }

  /* ---------- ربط الواتساب — جروبات إضافية تحت رقم الإيجنسي، بدون حد أقصى ----------
     كل جروب بيتحط له label من العميل (أو الإدارة)، والإدارة/الأجنت هو اللي بيحط
     الـ Group ID الحقيقي (لازم وصول لواتساب المتصل عشان يجيبه) */
  const waGroupsOf = c => c.whatsappGroups || [];

  if (path === '/api/wa-groups') {
    const staffAccess = isStaff(user) && can(user, 'clients');
    const state = await loadState(env);

    if (request.method === 'GET') {
      if (user.role === 'client') {
        const client = state.clients.find(c => c.id === me.clientId);
        return json(client ? waGroupsOf(client) : []);
      }
      if (!staffAccess) return json({ error: 'مش مسموح' }, 403);
      const cid = url.searchParams.get('clientId');
      if (cid) {
        const client = state.clients.find(c => c.id === cid);
        return json(client ? waGroupsOf(client) : []);
      }
      /* بدون clientId: كل الجروبات لكل العملاء — لشاشة الإدارة العامة */
      return json(state.clients.map(c => ({ clientId: c.id, name: c.name, groups: waGroupsOf(c) })));
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const targetId = user.role === 'client' ? me.clientId : b.clientId;
      if (user.role !== 'client' && !staffAccess) return json({ error: 'مش مسموح' }, 403);
      if (!targetId) return json({ error: 'محتاجين clientId' }, 400);
      const client = state.clients.find(c => c.id === targetId);
      if (!client) return json({ error: 'العميل مش موجود' }, 404);
      const label = String(b.label || '').trim();
      if (!label) return json({ error: 'اكتب اسم/وصف الجروب' }, 400);
      const groupId = (isStaff(user) && b.groupId) ? String(b.groupId).trim() : null;
      const entry = {
        id: crypto.randomUUID().slice(0, 8), label, groupId,
        status: groupId ? 'linked' : 'pending', requestedAt: new Date().toISOString()
      };
      client.whatsappGroups = [...waGroupsOf(client), entry];
      await saveState(env, state);
      return json({ ok: true, entry });
    }
  }

  const wgm = path.match(/^\/api\/wa-groups\/([^/]+)$/);
  if (wgm) {
    const gid = decodeURIComponent(wgm[1]);
    const state = await loadState(env);
    const client = user.role === 'client'
      ? state.clients.find(c => c.id === me.clientId)
      : state.clients.find(c => waGroupsOf(c).some(g => g.id === gid));
    if (!client) return json({ error: 'مش موجود' }, 404);
    if (user.role !== 'client' && !(isStaff(user) && can(user, 'clients'))) {
      return json({ error: 'مش مسموح' }, 403);
    }
    const entry = waGroupsOf(client).find(g => g.id === gid);
    if (!entry) return json({ error: 'الجروب مش موجود' }, 404);

    if (request.method === 'PATCH') {
      if (!isStaff(user)) return json({ error: 'الإدارة بس اللي بتحط Group ID' }, 403);
      const b = await request.json().catch(() => ({}));
      if (b.groupId !== undefined) { entry.groupId = String(b.groupId).trim() || null; entry.status = entry.groupId ? 'linked' : 'pending'; }
      if (b.label !== undefined) entry.label = String(b.label).trim() || entry.label;
      await saveState(env, state);
      return json({ ok: true, entry });
    }
    if (request.method === 'DELETE') {
      client.whatsappGroups = waGroupsOf(client).filter(g => g.id !== gid);
      await saveState(env, state);
      return json({ ok: true });
    }
  }

  /* ---------- الربح والخسارة + إيداعات فيسبوك ---------- */
  if (path === '/api/finance' && request.method === 'GET') {
    const staffAccess = isStaff(user) && can(user, 'clients');
    const qcid = url.searchParams.get('clientId');
    if (user.role === 'client' && qcid && qcid !== me.clientId) return json({ error: 'مش مسموح' }, 403);
    const targetId = user.role === 'client' ? me.clientId : qcid;
    if (user.role !== 'client' && !staffAccess) return json({ error: 'مش مسموح' }, 403);
    if (!targetId) return json({ error: 'محتاجين clientId' }, 400);
    const state = await loadState(env);
    const fin = computeFinance(state, await listOrders(env), targetId);
    if (!fin) return json({ error: 'العميل مش موجود' }, 404);
    return json(fin);
  }

  /* ---------- أداء يوم/شهر معيّن — لوحة "أداء النهارده" مع مؤشر التاريخ ----------
     الأوردرات الجديدة بتتحسب بتاريخ الإنشاء (o.date). الأحداث (تحصيل/مرتجع/إلغاء)
     بتتحسب بتاريخ حدوثها الفعلي من سجل التاريخ (history) — مش تاريخ إنشاء الأوردر،
     عشان أوردر اتسجّل الأسبوع اللي فات ولسه اتحصّل النهارده يدخل في أرقام النهارده. */
  async function dayBreakdown(env, state, orders, clientId, from, to) {
    const co = orders.filter(o => o.clientId === clientId);
    const inRange = d => d >= from && d <= to;
    const newOrders = co.filter(o => inRange(String(o.date || '').slice(0, 10)));

    const byState = {};
    ORDER_STATES.forEach(s => { byState[s] = newOrders.filter(o => o.state === s).length; });

    const eventOn = st => co.filter(o => (o.history || []).some(h =>
      h.state === st && inRange(String(h.at || '').slice(0, 10))));
    const collectedEv = eventOn('collected');
    const returnedEv = eventOn('returned');
    const cancelledEv = eventOn('cancelled');

    const adSpend = round2((state.entries || [])
      .filter(e => e.clientId === clientId && inRange(String(e.date || '').slice(0, 10)))
      .reduce((s, e) => s + (Number(e.adSpend) || 0), 0));

    const { results: txRows } = await env.DB.prepare(
      `SELECT amount FROM transactions WHERE client_id = ? AND type = 'expense' AND date >= ? AND date <= ?`
    ).bind(clientId, from, to).all();
    const otherExpense = round2((txRows || []).reduce((s, t) => s + (Number(t.amount) || 0), 0));

    return {
      from, to,
      newOrders: newOrders.length, byState,
      adSpend, otherExpense, cpp: newOrders.length ? round2((adSpend + otherExpense) / newOrders.length) : 0,
      collected: { count: collectedEv.length, amount: round2(collectedEv.reduce((s, o) => s + (Number(o.total) || 0), 0)) },
      returned: returnedEv.length, cancelled: cancelledEv.length
    };
  }

  if (path === '/api/performance' && request.method === 'GET') {
    const staffAccess = isStaff(user) && can(user, 'clients');
    const qcid = url.searchParams.get('clientId');
    if (user.role === 'client' && qcid && qcid !== me.clientId) return json({ error: 'مش مسموح' }, 403);
    const targetId = user.role === 'client' ? me.clientId : qcid;
    if (user.role !== 'client' && !staffAccess) return json({ error: 'مش مسموح' }, 403);
    if (!targetId) return json({ error: 'محتاجين clientId' }, 400);

    const state = await loadState(env);
    const client = state.clients.find(c => c.id === targetId);
    if (!client) return json({ error: 'العميل مش موجود' }, 404);
    const orders = await listOrders(env, targetId);

    const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')
      ? url.searchParams.get('date') : new Date().toISOString().slice(0, 10);
    const [y, m] = dateParam.split('-').map(Number);
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);
    const last30Start = new Date(new Date(dateParam).getTime() - 29 * 86400000).toISOString().slice(0, 10);

    const today = await dayBreakdown(env, state, orders, targetId, dateParam, dateParam);
    const month = await dayBreakdown(env, state, orders, targetId, monthStart, monthEnd);

    const last30Orders = orders.filter(o => {
      const d = String(o.date || '').slice(0, 10);
      return d >= last30Start && d <= dateParam;
    });
    const l30NonCancelled = last30Orders.filter(o => o.state !== 'cancelled');
    const l30Confirmed = l30NonCancelled.filter(o => o.state !== 'pending');
    const l30Delivered = last30Orders.filter(o => o.state === 'signed' || o.state === 'collected');
    const l30Returned = last30Orders.filter(o => o.state === 'returned');
    const l30Final = l30Delivered.length + l30Returned.length;

    const fin = computeFinance(state, orders, targetId);

    return json({
      date: dateParam, today, month,
      last30ConfirmationRatePct: l30NonCancelled.length
        ? Math.round((l30Confirmed.length / l30NonCancelled.length) * 1000) / 10 : 0,
      last30DeliveryRatePct: l30Final ? Math.round((l30Delivered.length / l30Final) * 1000) / 10 : 0,
      profitExpected: fin.profitExpected, revenueExpected: fin.revenueExpected,
      shippingMode: client.shippingMode === 'byGov' ? 'byGov' : 'fixed'
    });
  }

  if (path === '/api/deposits') {
    const staffAccess = isStaff(user) && can(user, 'clients');
    const state = await loadState(env);
    state.deposits = state.deposits || [];

    if (request.method === 'GET') {
      if (user.role === 'client') {
        const qcid = url.searchParams.get('clientId');
        if (qcid && qcid !== me.clientId) return json({ error: 'مش مسموح' }, 403);
        return json(state.deposits.filter(d => d.clientId === me.clientId));
      }
      if (!staffAccess) return json({ error: 'مش مسموح' }, 403);
      const cid = url.searchParams.get('clientId');
      return json(cid ? state.deposits.filter(d => d.clientId === cid) : state.deposits);
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const targetId = user.role === 'client' ? me.clientId : b.clientId;
      if (user.role !== 'client' && !staffAccess) return json({ error: 'مش مسموح' }, 403);
      if (!targetId) return json({ error: 'محتاجين clientId' }, 400);
      const amount = Number(b.amount);
      if (!amount || amount <= 0) return json({ error: 'المبلغ لازم يكون أكبر من صفر' }, 400);
      const entry = {
        id: crypto.randomUUID().slice(0, 8), clientId: targetId,
        date: b.date || new Date().toISOString().slice(0, 10),
        amount: round2(amount), note: String(b.note || '').trim(),
        createdAt: new Date().toISOString()
      };
      state.deposits.push(entry);
      await saveState(env, state);
      return json({ ok: true, entry });
    }
  }

  const depm = path.match(/^\/api\/deposits\/([^/]+)$/);
  if (depm && request.method === 'DELETE') {
    const state = await loadState(env);
    state.deposits = state.deposits || [];
    const entry = state.deposits.find(d => d.id === depm[1]);
    if (!entry) return json({ error: 'مش موجود' }, 404);
    const allowed = (user.role === 'client' && entry.clientId === me.clientId)
      || (isStaff(user) && can(user, 'clients'));
    if (!allowed) return json({ error: 'مش مسموح' }, 403);
    state.deposits = state.deposits.filter(d => d.id !== depm[1]);
    await saveState(env, state);
    return json({ ok: true });
  }

  /* ---------- الشات الداخلي للفريق + التاسكات — الإدارة والموظفين بس ---------- */
  if (path === '/api/chat/messages') {
    if (!isStaff(user)) return json({ error: 'مش مسموح' }, 403);
    if (request.method === 'GET') {
      const after = url.searchParams.get('after');
      const q = after
        ? env.DB.prepare('SELECT id, author_id, author_name, body, created_at FROM chat_messages WHERE created_at > ? ORDER BY created_at ASC LIMIT 300').bind(after)
        : env.DB.prepare('SELECT id, author_id, author_name, body, created_at FROM chat_messages ORDER BY created_at DESC LIMIT 100');
      const { results } = await q.all();
      return json(after ? (results || []) : (results || []).reverse());
    }
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const body = String(b.text || '').trim();
      if (!body) return json({ error: 'اكتب رسالة' }, 400);
      const msg = {
        id: 'MSG-' + crypto.randomUUID().slice(0, 10).toUpperCase(),
        author_id: me.uid, author_name: me.name || me.email, body, created_at: new Date().toISOString()
      };
      await env.DB.prepare('INSERT INTO chat_messages (id, author_id, author_name, body, created_at) VALUES (?,?,?,?,?)')
        .bind(msg.id, msg.author_id, msg.author_name, msg.body, msg.created_at).run();
      return json({ ok: true, message: msg });
    }
  }

  if (path === '/api/chat/seen' && request.method === 'POST') {
    if (!isStaff(user)) return json({ error: 'مش مسموح' }, 403);
    await env.DB.prepare('UPDATE users SET chat_last_seen = ? WHERE id = ?').bind(new Date().toISOString(), me.uid).run();
    return json({ ok: true });
  }

  if (path === '/api/chat/unread' && request.method === 'GET') {
    if (!isStaff(user)) return json({ error: 'مش مسموح' }, 403);
    const row = await env.DB.prepare('SELECT chat_last_seen FROM users WHERE id = ?').bind(me.uid).first();
    const since = (row && row.chat_last_seen) || '1970-01-01T00:00:00.000Z';
    const msgCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE created_at > ? AND author_id != ?')
      .bind(since, me.uid).first();
    const taskCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assigned_to = ? AND status = 'open'")
      .bind(me.uid).first();
    return json({ unreadMessages: (msgCount && msgCount.n) || 0, openTasks: (taskCount && taskCount.n) || 0 });
  }

  if (path === '/api/tasks') {
    if (!isStaff(user)) return json({ error: 'مش مسموح' }, 403);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, title, description, assigned_to, assigned_by, status, created_at, updated_at FROM tasks ORDER BY (status = "done"), created_at DESC LIMIT 300'
      ).all();
      return json(results || []);
    }
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const title = String(b.title || '').trim();
      if (!title) return json({ error: 'اكتب عنوان التاسك' }, 400);
      const task = {
        id: 'TSK-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
        title, description: String(b.description || '').trim(),
        assigned_to: b.assignedTo || null, assigned_by: me.uid,
        status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      await env.DB.prepare(
        'INSERT INTO tasks (id, title, description, assigned_to, assigned_by, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(task.id, task.title, task.description, task.assigned_to, task.assigned_by, task.status, task.created_at, task.updated_at).run();
      return json({ ok: true, task });
    }
  }

  const tskm = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (tskm && isStaff(user)) {
    const id = decodeURIComponent(tskm[1]);
    if (request.method === 'PATCH') {
      const b = await request.json().catch(() => ({}));
      const sets = [], vals = [];
      if (b.status !== undefined) { sets.push('status = ?'); vals.push(b.status === 'done' ? 'done' : 'open'); }
      if (b.assignedTo !== undefined) { sets.push('assigned_to = ?'); vals.push(b.assignedTo || null); }
      if (b.title !== undefined) { sets.push('title = ?'); vals.push(String(b.title).trim()); }
      if (b.description !== undefined) { sets.push('description = ?'); vals.push(String(b.description).trim()); }
      if (!sets.length) return json({ error: 'مفيش حاجة تتحدث' }, 400);
      sets.push('updated_at = ?'); vals.push(new Date().toISOString());
      vals.push(id);
      await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  /* ---------- استيراد شيتات إيزي أوردرز و J&T ---------- */
  if (path === '/api/orders/bulk' && request.method === 'POST') {
    if (!can(user, 'orders')) return json({ error: 'مش مسموح' }, 403);
    const b = await request.json().catch(() => ({}));
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
    if (!rows.length) return json({ error: 'الملف فاضي' }, 400);

    /* شيت إيزي أوردرز: بينشئ أوردرات أو بيحدّثها */
    if (b.mode === 'orders') {
      if (!b.clientId) return json({ error: 'اختار المتجر' }, 400);
      let created = 0, updated = 0, costed = 0;
      const skipped = [];

      /* بنجيب كتالوج منتجات العميل مرة واحدة عشان نحسب تكلفة البضاعة —
         الشيت بيقول سعر البيع بس، والتكلفة عندنا في المنتجات */
      const catalog = await listProducts(env, b.clientId);
      const byKey = new Map();
      catalog.forEach(pr => {
        if (pr.sku)  byKey.set(String(pr.sku).trim().toLowerCase(), pr);
        if (pr.name) byKey.set(String(pr.name).trim().toLowerCase(), pr);
      });
      const findProduct = r => {
        const sku = String(r.sku || '').split(',')[0].trim().toLowerCase();
        if (sku && byKey.has(sku)) return byKey.get(sku);
        const nm = String(r.product || '').split(' — ')[0].split(' + ')[0].trim().toLowerCase();
        return nm ? byKey.get(nm) : null;
      };
      for (const r of rows) {
        if (!r.name && !r.phone && !r.id) { skipped.push('صف فاضي'); continue; }
        const id = String(r.id || '').trim() || 'IM-' + crypto.randomUUID().slice(0, 8).toUpperCase();
        const exists = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(id).first();
        const st = r.state && ORDER_STATES.includes(r.state) ? r.state : mapEasyOrdersStatus(r.status);
        const qty = Number(r.qty) || 1;
        const match = findProduct(r);
        let cost = Number(r.productCost) || 0;
        if (!cost && match) { cost = (Number(match.cost) || 0) * qty; if (cost) costed++; }
        await insertOrder(env, {
          id, clientId: b.clientId, ref: r.ref ? String(r.ref).trim() : null,
          date: (r.date || new Date().toISOString()).slice(0, 10),
          name: r.name || '', phone: String(r.phone || ''), gov: r.gov || '', address: r.address || '',
          product: r.product || '', productId: match ? match.id : null, qty,
          unitPrice: Number(r.unitPrice) || 0, total: Number(r.total) || 0,
          productCost: cost,
          shippingCost: r.shippingCost === undefined ? null : Number(r.shippingCost),
          otherCost: r.otherCost === undefined ? null : Number(r.otherCost),
          source: r.source || 'شيت إيزي أوردرز', note: r.note || '',
          awb: r.awb || null, state: st, checkpoint: STATE_TEXT[st] || ''
        });
        exists ? updated++ : created++;
      }
      return json({ ok: true, created, updated, costed, skipped: skipped.length,
        noCost: created + updated - costed });
    }

    /* شيت J&T: بيطابق برقم البوليصة أو Order NO. */
    if (b.mode === 'tracking') {
      const rows2 = rows.map(r => ({ ...r, clientId: r.clientId || b.clientId }));
      const result = await runTrackingImport(env, rows2);
      return json({ ok: true, ...result });
    }

    return json({ error: 'نوع الاستيراد غير معروف' }, 400);
  }

  /* ---------- الحسابات: المصاريف والتحصيلات ---------- */
  const rowToTx = r => ({
    id:r.id, type:r.type, date:r.date, category:r.category, amount:r.amount,
    currency:r.currency, method:r.method, clientId:r.client_id, note:r.note,
    createdBy:r.created_by
  });

  if (path === '/api/transactions') {
    const staffAccess = can(user, 'finance');
    const from = url.searchParams.get('from') || '1900-01-01';
    const to   = url.searchParams.get('to')   || '2999-12-31';

    if (request.method === 'GET') {
      if (user.role === 'client') {
        const { results } = await env.DB.prepare(
          `SELECT ${TX_COLS} FROM transactions WHERE client_id = ? AND date >= ? AND date <= ? ORDER BY date DESC LIMIT 2000`
        ).bind(me.clientId, from, to).all();
        return json((results || []).map(rowToTx));
      }
      if (!staffAccess) return json({ error: 'مش مسموح' }, 403);
      const { results } = await env.DB.prepare(
        `SELECT ${TX_COLS} FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 2000`
      ).bind(from, to).all();
      return json((results || []).map(rowToTx));
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const clientId = user.role === 'client' ? me.clientId : (b.clientId || null);
      if (user.role !== 'client' && !staffAccess) return json({ error: 'مش مسموح' }, 403);
      const amount = Number(b.amount) || 0;
      if (!['expense','income'].includes(b.type)) return json({ error: 'النوع لازم يكون مصروف أو إيراد' }, 400);
      if (amount <= 0) return json({ error: 'المبلغ لازم يكون أكبر من صفر' }, 400);
      if (!b.category) return json({ error: 'اختار البند' }, 400);
      const id = b.id || 'TX-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      await env.DB.prepare(
        `INSERT INTO transactions (${TX_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type, date=excluded.date, category=excluded.category,
           amount=excluded.amount, currency=excluded.currency, method=excluded.method,
           client_id=excluded.client_id, note=excluded.note`
      ).bind(id, b.type, b.date || new Date().toISOString().slice(0,10), b.category, amount,
        b.currency || 'EGP', b.method || '', clientId, b.note || '',
        me.email, new Date().toISOString()).run();
      return json({ ok: true, id });
    }
  }

  const tm = path.match(/^\/api\/transactions\/([^/]+)$/);
  if (tm && request.method === 'DELETE') {
    const id = decodeURIComponent(tm[1]);
    if (user.role === 'client') {
      const row = await env.DB.prepare('SELECT client_id FROM transactions WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'مش موجودة' }, 404);
      if (row.client_id !== me.clientId) return json({ error: 'مش مسموح' }, 403);
    } else if (!can(user, 'finance')) {
      return json({ error: 'مش مسموح' }, 403);
    }
    await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  /* ---------- النسخ الاحتياطي ---------- */
  /** بيجمع كل الجداول في كائن واحد. كلمات المرور بتتشال — النسخة ما تنفعش
      تسترجع الحسابات، وده مقصود: ملف نسخة مسروق ما يديش حد دخول للنظام */
  async function buildBackup(env) {
    const all = async (sql) => ((await env.DB.prepare(sql).all()).results) || [];
    return {
      version: 2,
      takenAt: new Date().toISOString(),
      state: await loadState(env),
      orders: await all(`SELECT ${ORDER_COLS} FROM orders`),
      products: await all(`SELECT ${PRODUCT_COLS} FROM products`),
      transactions: await all('SELECT * FROM transactions'),
      users: await all('SELECT id, email, name, role, client_id, status, created_at, last_login FROM users')
    };
  }

  if (path === '/api/backup' && request.method === 'GET') {
    if (!can(user, 'settings')) return json({ error: 'مش مسموح' }, 403);
    const data = await buildBackup(env);
    const name = `konline-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`
      }
    });
  }

  /* استرجاع نسخة — بيمسح الأوردرات والمنتجات والحركات ويحط اللي في الملف.
     الحسابات وكلمات المرور ما بتتلمسش نهائياً */
  if (path === '/api/restore' && request.method === 'POST') {
    if (!can(user, 'settings')) return json({ error: 'مش مسموح' }, 403);
    const b = await request.json().catch(() => null);
    if (!b || !b.state || !Array.isArray(b.orders)) {
      return json({ error: 'الملف مش نسخة صالحة' }, 400);
    }
    if (b.confirm !== 'RESTORE') {
      return json({ error: 'محتاجين تأكيد صريح قبل الاسترجاع' }, 400);
    }

    await saveState(env, b.state);
    await env.DB.prepare('DELETE FROM orders').run();
    await env.DB.prepare('DELETE FROM products').run();
    await env.DB.prepare('DELETE FROM transactions').run();

    for (const o of b.orders) await insertOrder(env, rowToOrder(o));
    for (const p of (b.products || [])) {
      await env.DB.prepare(
        `INSERT INTO products (${PRODUCT_COLS}) VALUES (?,?,?,?,?,?,?,?)`
      ).bind(p.id, p.client_id || p.clientId, p.name, p.sku || '', p.price || 0,
        p.cost || 0, p.active === false ? 0 : 1, p.created_at || new Date().toISOString()).run();
    }
    for (const t of (b.transactions || [])) {
      await env.DB.prepare(
        `INSERT INTO transactions (${TX_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(t.id, t.type, t.date, t.category, t.amount, t.currency || 'EGP',
        t.method || '', t.client_id || null, t.note || '', t.created_by || '',
        t.created_at || new Date().toISOString()).run();
    }
    return json({ ok: true, orders: b.orders.length,
      products: (b.products || []).length, transactions: (b.transactions || []).length });
  }

  /* تشغيل التتبع يدوياً */
  if (path === '/api/track-now' && can(user, 'orders')) {
    return json({ ok: true, changed: await syncShipments(env) });
  }

  return json({ error: 'مسار غير معروف' }, 404);
}

async function handleWebhook(request, env, path) {
  /* إيزي أوردرز */
  if (path === '/webhooks/easyorders') {
    if (env.EASYORDERS_WEBHOOK_SECRET) {
      const sent = request.headers.get('secret') || '';
      if (!safeEqual(sent, env.EASYORDERS_WEBHOOK_SECRET)) return json({ error: 'secret غير صحيح' }, 401);
    }
    const p = await request.json().catch(() => ({}));

    if (p.event_type === 'order-status-update') {
      const st = mapEasyOrdersStatus(p.new_status);
      await env.DB.prepare('UPDATE orders SET state = ?, checkpoint = ? WHERE id = ?')
        .bind(st, STATE_TEXT[st] || '', p.order_id).run();
      return json({ ok: true, event: 'status-update' });
    }

    if (!p.id) return json({ error: 'بايلود ناقص' }, 400);
    const state = await loadState(env);
    const client = state.clients.find(c => c.storeId === p.store_id);
    if (!client) return json({ ok: true, note: 'store_id مش مربوط بعميل — اربطه من تبويب العملاء' });

    await ensureProductsFromCart(env, client.id, p.cart_items);

    await insertOrder(env, {
      id: p.id, clientId: client.id,
      date: String(p.created_at || new Date().toISOString()).slice(0, 10),
      name: p.full_name || '', phone: p.phone || '', gov: p.government || '', address: p.address || '',
      product: (p.cart_items || []).map(c => c.product && c.product.name).filter(Boolean).join(' + '),
      qty: (p.cart_items || []).reduce((s, c) => s + (Number(c.quantity) || 1), 0) || 1,
      total: Number(p.total_cost) || 0, source: 'المتجر (إيزي أوردرز)', note: '',
      awb: null, state: mapEasyOrdersStatus(p.status), checkpoint: STATE_TEXT[mapEasyOrdersStatus(p.status)]
    });
    return json({ ok: true, event: 'order-created', id: p.id });
  }

  /* دفعات التتبع */
  if (path === '/webhooks/tracking') {
    const b = await request.json().catch(() => ({}));
    const awb = b.trackNo || b.tracking_number || (b.data && b.data.trackNo);
    const raw = b.latestEvent || b.status || (b.data && b.data.latestEvent) || '';
    if (!awb) return json({ error: 'رقم بوليصة ناقص' }, 400);
    const st = mapJTStatus(raw);
    await env.DB.prepare('UPDATE orders SET state = ?, checkpoint = ? WHERE awb = ?')
      .bind(st, raw || STATE_TEXT[st], awb).run();
    return json({ ok: true, state: st });
  }

  return json({ error: 'مسار غير معروف' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) return await handleApi(request, env, url, path);
      if (path.startsWith('/webhooks/')) {
        if (request.method !== 'POST') return json({ error: 'POST بس' }, 405);
        return await handleWebhook(request, env, path);
      }
      if (path === '/health') return json({ ok: true });
      /* أي حاجة تانية: الداشبورد نفسه */
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'حصل خطأ في السيرفر' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncShipments(env).then(n => console.log('حدّثنا ' + n + ' شحنة')));

    /* نسخة احتياطية يومية في R2 — بتشتغل لو الـ bucket مربوط بس.
       بنحتفظ بيوم واحد لكل تاريخ، فالتخزين ما بيكبرش */
    if (env.BACKUPS) {
      ctx.waitUntil((async () => {
        try {
          const all = async (sql) => ((await env.DB.prepare(sql).all()).results) || [];
          const data = {
            version: 2, takenAt: new Date().toISOString(),
            state: await loadState(env),
            orders: await all(`SELECT ${ORDER_COLS} FROM orders`),
            products: await all(`SELECT ${PRODUCT_COLS} FROM products`),
            transactions: await all('SELECT * FROM transactions'),
            users: await all('SELECT id, email, name, role, client_id, status FROM users')
          };
          const key = `backup-${new Date().toISOString().slice(0, 10)}.json`;
          await env.BACKUPS.put(key, JSON.stringify(data));
          console.log('اتحفظت نسخة: ' + key);
        } catch (e) { console.error('فشل النسخ الاحتياطي:', e.message); }
      })());
    }
  }
};
