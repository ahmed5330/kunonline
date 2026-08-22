-- ميجريشن التصنيفات والمتغيرات (رقم 4) — آمنة على قاعدة شغالة
-- شغّلها على قاعدة kunonline (مش konline) بعد ما تتأكد إنك جوه فولدر المشروع
-- ملحوظة: لو سبق ورفعت جزء من الميجريشن ده قبل كده هتاخد "duplicate column"، ده طبيعي ومش خطر

ALTER TABLE orders ADD COLUMN variant_id TEXT;

ALTER TABLE products ADD COLUMN category TEXT;

CREATE TABLE IF NOT EXISTS product_variants (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  sku         TEXT,
  stock       INTEGER DEFAULT 0,
  price       REAL,
  active      INTEGER DEFAULT 1,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_client ON product_variants (client_id);

ALTER TABLE stock_log ADD COLUMN variant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_stocklog_variant ON stock_log (variant_id);
