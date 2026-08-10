-- هيكل قاعدة بيانات كن أونلاين (Cloudflare D1)

-- حسابات الدخول — كلمة المرور متخزّنة مشفّرة بـ PBKDF2 مش نص عادي
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,   -- حروف صغيرة دايماً
  password      TEXT NOT NULL,          -- pbkdf2$تكرارات$ملح$بصمة
  role          TEXT NOT NULL,          -- admin أو client
  client_id     TEXT,                   -- للعميل: أي عميل في النظام
  status        TEXT DEFAULT 'active',
  created_at    TEXT,
  last_login    TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_client ON users (client_id);

-- محاولات الدخول الفاشلة — لقفل الحساب مؤقتاً بعد تكرار الخطأ
CREATE TABLE IF NOT EXISTS login_attempts (
  email         TEXT PRIMARY KEY,
  fails         INTEGER DEFAULT 0,
  locked_until  TEXT
);

-- إعدادات النظام في صف واحد: العملاء، الإدخال اليومي، التمويلات
CREATE TABLE IF NOT EXISTS state (
  id          INTEGER PRIMARY KEY,
  json        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- الأوردرات في صفوف مستقلة عشان الويبهوك يكتب فيها من غير تعارض
CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  date        TEXT NOT NULL,
  name        TEXT,
  phone       TEXT,
  gov         TEXT,
  address     TEXT,
  product     TEXT,
  qty         INTEGER DEFAULT 1,
  total       REAL DEFAULT 0,
  source      TEXT,
  note        TEXT,
  awb         TEXT,
  state       TEXT DEFAULT 'new',
  checkpoint  TEXT,
  created_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_client ON orders (client_id, date);
CREATE INDEX IF NOT EXISTS idx_orders_awb    ON orders (awb);
