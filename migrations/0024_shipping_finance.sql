-- Separate customer-paid shipping from the shipping cost borne by the business.
ALTER TABLE orders ADD COLUMN product_subtotal REAL;
ALTER TABLE orders ADD COLUMN customer_shipping_charge REAL;
ALTER TABLE orders ADD COLUMN carrier_shipping_cost REAL;
ALTER TABLE orders ADD COLUMN business_shipping_cost REAL;
ALTER TABLE orders ADD COLUMN shipping_finance_mode TEXT;
ALTER TABLE orders ADD COLUMN shipping_finance_source TEXT;

CREATE TABLE IF NOT EXISTS shipping_financial_settings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  store_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL,
  customer_shipping_amount REAL NOT NULL DEFAULT 0,
  business_shipping_amount REAL NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_financial_settings_scope ON shipping_financial_settings(client_id,store_id);
