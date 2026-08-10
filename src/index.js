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

/* ---------- قاعدة البيانات ---------- */
const EMPTY_STATE = agencyEmail => ({
  agency: { name: 'كن أونلاين', adminEmail: agencyEmail },
  clients: [], entries: [], funding: []
});

async function loadState(env) {
  const row = await env.DB.prepare('SELECT json FROM state WHERE id = 1').first();
  if (row && row.json) return JSON.parse(row.json);
  const fresh = EMPTY_STATE('');
  await saveState(env, fresh);
  return fresh;
}

async function saveState(env, state) {
  await env.DB.prepare(
    `INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(state), new Date().toISOString()).run();
}

const ORDER_COLS = 'id, client_id, date, name, phone, gov, address, product, qty, total, source, note, awb, state, checkpoint, created_at';

const rowToOrder = r => ({
  id: r.id, clientId: r.client_id, date: r.date, name: r.name, phone: r.phone,
  gov: r.gov, address: r.address, product: r.product, qty: r.qty, total: r.total,
  source: r.source, note: r.note, awb: r.awb, state: r.state, checkpoint: r.checkpoint
});

async function listOrders(env, clientId) {
  const q = clientId
    ? env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE client_id = ? ORDER BY date DESC LIMIT 2000`).bind(clientId)
    : env.DB.prepare(`SELECT ${ORDER_COLS} FROM orders ORDER BY date DESC LIMIT 2000`);
  const { results } = await q.all();
  return (results || []).map(rowToOrder);
}

async function insertOrder(env, o) {
  await env.DB.prepare(
    `INSERT INTO orders (${ORDER_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       state = excluded.state, checkpoint = excluded.checkpoint, awb = COALESCE(excluded.awb, orders.awb)`
  ).bind(
    o.id, o.clientId, o.date, o.name || '', o.phone || '', o.gov || '', o.address || '',
    o.product || '', o.qty || 1, o.total || 0, o.source || '', o.note || '',
    o.awb || null, o.state || 'new', o.checkpoint || '', new Date().toISOString()
  ).run();
  return o;
}

/* ---------- توحيد الحالات ---------- */
const ORDER_STATES = ['pending','confirmed','preparing','shipped','collected','returned','cancelled'];
const STATE_TEXT = {
  pending:   'جاري التأكيد',
  confirmed: 'تم تأكيد الطلب',
  preparing: 'جاري الشحن',
  shipped:   'تم الشحن',
  collected: 'تم التحصيل',
  returned:  'مرتجع',
  cancelled: 'تم إلغاء الطلب'
};
const FINAL = ['collected', 'returned', 'cancelled'];

function mapEasyOrdersStatus(s) {
  const k = String(s || '').toLowerCase().trim();
  const t = {
    pending: 'pending', new: 'pending',
    confirmed: 'confirmed', paid: 'confirmed', processing: 'preparing',
    shipped: 'shipped', shipping: 'shipped',
    delivered: 'collected', completed: 'collected',
    returned: 'returned', refunded: 'returned', 'مرتجع': 'returned',
    cancelled: 'cancelled', canceled: 'cancelled', rejected: 'cancelled', 'ملغي': 'cancelled'
  };
  return t[k] || 'pending';
}

function mapJTStatus(raw) {
  const t = String(raw || '').toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('delivered', 'signed', 'تم التسليم', 'تم الاستلام')) return 'collected';
  if (has('returned', 'return', 'rts', 'مرتجع', 'راجع', 'إرجاع')) return 'returned';
  if (has('cancel', 'ملغي', 'ملغاة')) return 'cancelled';
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

async function syncShipments(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, awb, state FROM orders
     WHERE awb IS NOT NULL AND state NOT IN ('collected','returned','cancelled') LIMIT 300`
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
function scopeForClient(state, orders, clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return null;
  const safe = { ...client };
  delete safe.code;
  return {
    agency: { name: state.agency.name },
    clients: [safe],
    entries: state.entries.filter(e => e.clientId === clientId),
    funding: state.funding.filter(f => f.clientId === clientId),
    orders: orders.filter(o => o.clientId === clientId)
  };
}

/* ---------- المسارات ---------- */
async function handleApi(request, env, url, path) {
  const secret = env.SESSION_SECRET;
  if (!secret) return json({ error: 'SESSION_SECRET مش متظبط في إعدادات Cloudflare' }, 500);

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
      return json({ ...state, orders: await listOrders(env), roles: ROLES });
    }
    const scoped = scopeForClient(state, await listOrders(env, me.clientId), me.clientId);
    return scoped ? json(scoped) : json({ error: 'الحساب مش موجود' }, 404);
  }

  /* حفظ البيانات — الإدارة بس */
  if (path === '/api/state' && request.method === 'PUT') {
    const body = await request.json();
    delete body.orders; delete body.roles;
    (body.clients || []).forEach(c => { delete c.password; delete c.code; });

    if (can(user, 'settings')) {           /* المدير بيحفظ كل حاجة */
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
    o.id = o.id || 'MN-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    o.state = ORDER_STATES.includes(o.state) ? o.state : 'pending';
    o.checkpoint = o.checkpoint || STATE_TEXT.new;
    await insertOrder(env, o);
    return json({ ok: true, order: o });
  }

  /* تعديل حالة أو بوليصة — الإدارة بس */
  const m = path.match(/^\/api\/orders\/([^/]+)$/);
  if (m && isStaff(user) && can(user, 'orders')) {
    const id = decodeURIComponent(m[1]);
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (request.method === 'PATCH') {
      const p = await request.json();
      const cur = await env.DB.prepare('SELECT state, awb FROM orders WHERE id = ?').bind(id).first();
      if (!cur) return json({ error: 'أوردر غير موجود' }, 404);
      let st = p.state || cur.state;
      const awb = p.awb !== undefined ? (p.awb || null) : cur.awb;
      if (p.awb && (cur.state === 'pending' || cur.state === 'confirmed' || cur.state === 'preparing') && !p.state) st = 'shipped';
      if (!ORDER_STATES.includes(st)) return json({ error: 'حالة غير معروفة' }, 400);
      await env.DB.prepare('UPDATE orders SET state = ?, awb = ?, checkpoint = ? WHERE id = ?')
        .bind(st, awb, STATE_TEXT[st] || '', id).run();
      return json({ ok: true, state: st });
    }
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

  /* ---------- الحسابات: المصاريف والتحصيلات ---------- */
  const TX_COLS = 'id, type, date, category, amount, currency, method, client_id, note, created_by, created_at';
  const rowToTx = r => ({
    id:r.id, type:r.type, date:r.date, category:r.category, amount:r.amount,
    currency:r.currency, method:r.method, clientId:r.client_id, note:r.note,
    createdBy:r.created_by
  });

  if (path === '/api/transactions') {
    if (!can(user, 'finance')) return json({ error: 'مش مسموح' }, 403);

    if (request.method === 'GET') {
      const from = url.searchParams.get('from') || '1900-01-01';
      const to   = url.searchParams.get('to')   || '2999-12-31';
      const { results } = await env.DB.prepare(
        `SELECT ${TX_COLS} FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 2000`
      ).bind(from, to).all();
      return json((results || []).map(rowToTx));
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
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
        b.currency || 'EGP', b.method || '', b.clientId || null, b.note || '',
        me.email, new Date().toISOString()).run();
      return json({ ok: true, id });
    }
  }

  const tm = path.match(/^\/api\/transactions\/([^/]+)$/);
  if (tm && can(user, 'finance') && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(decodeURIComponent(tm[1])).run();
    return json({ ok: true });
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
  }
};
