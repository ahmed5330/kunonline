-- Preview-only idempotent schema bootstrap.
-- This migration is applied only by wrangler.preview.toml to kunonline-preview.
-- Production workflows never run D1 commands.

-- هيكل قاعدة بيانات كن أونلاين (Cloudflare D1)

-- حسابات الدخول — كلمة المرور متخزّنة مشفّرة بـ PBKDF2 مش نص عادي
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,   -- حروف صغيرة دايماً
  name          TEXT,                   -- اسم صاحب الحساب المعروض
  password      TEXT NOT NULL,          -- pbkdf2$تكرارات$ملح$بصمة
  role          TEXT NOT NULL,          -- admin أو client
  client_id     TEXT,                   -- للعميل: أي عميل في النظام
  status        TEXT DEFAULT 'active',
  created_at    TEXT,
  last_login    TEXT,
  chat_last_seen TEXT                   -- آخر مرة فتح فيها الشات الداخلي (لعدّاد الإشعارات)
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
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  ref           TEXT,                   -- كود الأوردر الأصلي (إيزي أوردرز مثلاً) قبل ما يتحوّل لكود داخلي
  customer_id   TEXT,                   -- ربط تلقائي بملف العميل (customers) حسب رقم التليفون
  date          TEXT NOT NULL,
  name          TEXT,
  phone         TEXT,
  gov           TEXT,
  address       TEXT,
  product       TEXT,
  product_id    TEXT,
  variant_id    TEXT,                    -- لو الأوردر على متغير معيّن (لون/مقاس) بدل المنتج العام
  product_note  TEXT,                   -- ملاحظات المنتج (لون/مقاس/اختيارات) — تيجي تلقائي من إيزي أوردرز أو تتكتب يدوي
  unit_price    REAL DEFAULT 0,
  qty           INTEGER DEFAULT 1,
  total         REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,        -- قيمة الخصم اللي اتطبقت (مش بتغيّر total، بس بتتسجل لتقارير الربح)
  coupon_code   TEXT,                    -- كود الكوبون لو العميل استخدم واحد
  product_cost  REAL DEFAULT 0,
  shipping_cost REAL,
  other_cost    REAL,
  source        TEXT,
  note          TEXT,
  awb           TEXT,
  state         TEXT DEFAULT 'pending',
  checkpoint    TEXT,
  signed_at     TEXT,
  collected_at  TEXT,
  defer_until   TEXT,                   -- تاريخ رجوع الأوردر المؤجل — لما حالته deferred
  refund_amount REAL,                   -- المبلغ اللي فعلاً رجع للعميل — مختلف عن total (ممكن يكون جزء بس)
  return_type   TEXT,                   -- full / partial / exchange — لما الحالة تبقى returned
  restocked     INTEGER DEFAULT 0,      -- 1 لو المنتج رجع للمخزون بالفعل (عشان ميتزودش مرتين)
  contact_log   TEXT DEFAULT '[]',      -- JSON: مواعيد محاولات التواصل مع العميل
  history       TEXT DEFAULT '[]',      -- JSON: سجل تغييرات الحالة [{state, at}]
  created_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_client ON orders (client_id, date);
CREATE INDEX IF NOT EXISTS idx_orders_awb    ON orders (awb);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);

-- ملف العميل (Customer 360) — بيتربط تلقائي بالأوردر حسب رقم التليفون لكل متجر
-- إجمالي المصروف وعدد الأوردرات بيتحسبوا لايف من جدول orders، مش متخزّنين هنا عشان ميحصلش تعارض
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  name        TEXT,
  phone       TEXT NOT NULL,
  gov         TEXT,
  address     TEXT,
  tags        TEXT DEFAULT '[]',        -- JSON: ["VIP", "بيرجع كتير"]
  note        TEXT,
  created_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_client_phone ON customers (client_id, phone);

-- كوبونات الخصم — كود واحد بيتكرر استخدامه على أوردرات كتير، لكل متجر كوباناته الخاصة
CREATE TABLE IF NOT EXISTS coupons (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  code        TEXT NOT NULL,             -- بيتخزن بحروف كبيرة (UPPER) عشان المطابقة تبقى موحّدة
  type        TEXT NOT NULL DEFAULT 'fixed',  -- fixed (قيمة ثابتة) أو percent (نسبة من الإجمالي)
  value       REAL NOT NULL DEFAULT 0,
  active      INTEGER DEFAULT 1,
  expires_at  TEXT,                      -- تاريخ انتهاء اختياري (YYYY-MM-DD)
  note        TEXT,
  created_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_client_code ON coupons (client_id, code);

-- كتالوج المنتجات لكل عميل — بما فيه إدارة المخزون (الكمية المتاحة وحد التنبيه)
CREATE TABLE IF NOT EXISTS products (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  name                 TEXT NOT NULL,
  sku                  TEXT,
  category             TEXT,                  -- تصنيف حر (تيشيرتات، إكسسوارات...) لتصفية المنتجات والتقارير
  price                REAL DEFAULT 0,
  cost                 REAL DEFAULT 0,
  active               INTEGER DEFAULT 1,
  stock                INTEGER DEFAULT 0,     -- الكمية المتاحة حاليًا — لو المنتج له متغيرات (variants)، الرقم ده بيبقى إجمالي تقريبي بس، والدقيق في جدول المتغيرات
  low_stock_threshold  INTEGER DEFAULT 5,     -- تحت الرقم ده يظهر تنبيه "قرب يخلص"
  created_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_client ON products (client_id);

-- متغيرات المنتج (لون/مقاس) — كل متغير له مخزون وSKU مستقل، وسعر اختياري يختلف عن المنتج الأصلي
CREATE TABLE IF NOT EXISTS product_variants (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  name        TEXT NOT NULL,               -- مثال: "أحمر — مقاس L"
  sku         TEXT,
  stock       INTEGER DEFAULT 0,
  price       REAL,                        -- NULL = يستخدم سعر المنتج الأصلي
  active      INTEGER DEFAULT 1,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_client ON product_variants (client_id);

-- الحركات المالية العامة (مصاريف وإيرادات مش مرتبطة بأوردر بعينه)
CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,        -- expense أو income
  date        TEXT NOT NULL,
  category    TEXT,
  amount      REAL NOT NULL,
  currency    TEXT DEFAULT 'EGP',
  method      TEXT,
  client_id   TEXT,                 -- فاضي = حركة عامة للإيجنسي كلها
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_client ON transactions (client_id, date);

-- طابور رسائل الواتساب التلقائية (تأكيد الطلب + تنبيهات تغيير الحالة) — بينتظر أجنت الواتساب يرسلها
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  order_id    TEXT NOT NULL,
  phone       TEXT NOT NULL,
  message     TEXT NOT NULL,
  kind        TEXT,                 -- confirm أو shipping أو غيرها لاحقاً
  status      TEXT DEFAULT 'pending', -- pending أو sent أو failed
  created_at  TEXT,
  sent_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_status ON whatsapp_outbox (status, created_at);

-- سجل إضافات المخزون — كل مرة حد يضيف كمية جديدة لمنتج
-- supplier_id/supplier_name اختياريين: التوريد ممكن يتسجّل من غير ما يتربط بمورد محدد
CREATE TABLE IF NOT EXISTS stock_log (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  variant_id    TEXT,                   -- لو التوريد/التصحيح كان على متغير معيّن بدل المنتج العام
  product_name  TEXT,
  delta         INTEGER NOT NULL,
  new_stock     INTEGER,
  note          TEXT,
  supplier_id   TEXT,
  supplier_name TEXT,
  created_at    TEXT,
  created_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_stocklog_client ON stock_log (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stocklog_supplier ON stock_log (supplier_id);
CREATE INDEX IF NOT EXISTS idx_stocklog_variant ON stock_log (variant_id);

-- الموردين — كل مورد بيوصل بضاعة لعميل معيّن (المتجر)
CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT,
  note        TEXT,
  active      INTEGER DEFAULT 1,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_suppliers_client ON suppliers (client_id);

-- محفظة الاشتراك — سجل كل شحن رصيد وكل خصم تلقائي لكل أوردر
CREATE TABLE IF NOT EXISTS wallet_log (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  type          TEXT NOT NULL,       -- topup أو deduct
  amount        REAL NOT NULL,
  balance_after REAL,
  note          TEXT,
  created_at    TEXT,
  created_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_wallet_client ON wallet_log (client_id, created_at);

-- الشات الداخلي للفريق (الإدارة والموظفين بس — مفيش وصول للعملاء)
-- client_id فاضي = القناة العامة للإيجنسي كلها. لو متحدد = قناة خاصة بفريق العميل ده
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  client_id   TEXT,
  author_id   TEXT NOT NULL,
  author_name TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages (client_id, created_at);

-- تاسكات الفريق — أي موظف يقدر يوكّل تاسك لزميل
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  assigned_to  TEXT,                    -- user id
  assigned_by  TEXT,                    -- user id
  status       TEXT DEFAULT 'open',     -- open أو done
  created_at   TEXT,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assigned_to, status);

-- kun online Commerce OS foundation migration
-- Safe additive tables for procurement, automation, audit and channel attribution.

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft/sent/partial/received/cancelled
  order_date TEXT NOT NULL,
  expected_date TEXT,
  currency TEXT DEFAULT 'EGP',
  subtotal REAL DEFAULT 0,
  shipping_cost REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_client_date ON purchase_orders(client_id, order_date);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  product_name TEXT,
  sku TEXT,
  qty_ordered INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  supplier_id TEXT,
  received_at TEXT NOT NULL,
  received_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_po ON goods_receipts(purchase_order_id, received_at);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  purchase_order_item_id TEXT,
  product_id TEXT,
  variant_id TEXT,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON goods_receipt_items(receipt_id);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  definition_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflows_client ON workflows(client_id, active);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  trigger_entity_type TEXT,
  trigger_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  log_json TEXT DEFAULT '[]',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_client ON workflow_runs(client_id, started_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_client_time ON audit_log(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS marketing_touchpoints (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  customer_id TEXT,
  order_id TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  adset TEXT,
  ad TEXT,
  platform TEXT,
  click_id TEXT,
  session_id TEXT,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_touch_client_time ON marketing_touchpoints(client_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_touch_order ON marketing_touchpoints(order_id);
CREATE INDEX IF NOT EXISTS idx_touch_customer ON marketing_touchpoints(customer_id, occurred_at);
