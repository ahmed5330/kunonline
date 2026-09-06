-- Kun Online Production — approval-only additive D1 indexes.
-- DO NOT run from CI or against Production without explicit approval.
-- No resets, deletes, backfills, or destructive changes.
-- Apply one statement at a time after checking D1 usage.

CREATE INDEX IF NOT EXISTS idx_orders_easyorders_recovery
  ON orders(client_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_deferred_due
  ON orders(state, defer_until)
  WHERE state='deferred' AND defer_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_client_sku_nocase
  ON products(client_id, sku COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_variants_client_product_sku_nocase
  ON product_variants(client_id, product_id, sku COLLATE NOCASE);
