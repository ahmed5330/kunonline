-- Detailed product catalog and variant-level inventory for Preview.
ALTER TABLE products ADD COLUMN slug TEXT;
ALTER TABLE products ADD COLUMN description TEXT;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN compare_at_price REAL;
ALTER TABLE products ADD COLUMN weight REAL;
ALTER TABLE products ADD COLUMN weight_unit TEXT DEFAULT 'kg';
ALTER TABLE products ADD COLUMN images_json TEXT DEFAULT '[]';
ALTER TABLE products ADD COLUMN options_json TEXT DEFAULT '[]';
ALTER TABLE products ADD COLUMN seo_title TEXT;
ALTER TABLE products ADD COLUMN seo_description TEXT;
ALTER TABLE products ADD COLUMN updated_at TEXT;

ALTER TABLE product_variants ADD COLUMN option_values_json TEXT DEFAULT '{}';
ALTER TABLE product_variants ADD COLUMN barcode TEXT;
ALTER TABLE product_variants ADD COLUMN cost REAL;
ALTER TABLE product_variants ADD COLUMN compare_at_price REAL;
ALTER TABLE product_variants ADD COLUMN image TEXT;
ALTER TABLE product_variants ADD COLUMN weight REAL;
ALTER TABLE product_variants ADD COLUMN weight_unit TEXT DEFAULT 'kg';
ALTER TABLE product_variants ADD COLUMN low_stock_threshold INTEGER DEFAULT 5;
ALTER TABLE product_variants ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_products_catalog_scope ON products(client_id,store_id,active,name);
CREATE INDEX IF NOT EXISTS idx_variants_inventory_scope ON product_variants(client_id,store_id,product_id,active,stock);
