-- Cloudflare D1 free-tier protection indexes.
-- Additive only: no data mutation or destructive schema changes.

-- Easy Orders recovery / recent-order reads.
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_recovery
  ON orders(client_id, source, created_at DESC);

-- Targeted provider-id / reference matching inside a tenant/store.
CREATE INDEX IF NOT EXISTS idx_orders_scope_ref
  ON orders(client_id, store_id, ref);

-- Deferred-order wake-up checks should not scan the whole orders table.
CREATE INDEX IF NOT EXISTS idx_orders_deferred_due
  ON orders(state, defer_until)
  WHERE state='deferred' AND defer_until IS NOT NULL;

-- Dashboard date-range queries use this exact expression repeatedly.
CREATE INDEX IF NOT EXISTS idx_orders_scope_effective_date
  ON orders(client_id, store_id, date(COALESCE(date, created_at)));

CREATE INDEX IF NOT EXISTS idx_transactions_scope_effective_date
  ON transactions(client_id, store_id, date(COALESCE(date, created_at)));

-- Price sync performs case-insensitive SKU lookups.
CREATE INDEX IF NOT EXISTS idx_products_scope_sku_nocase
  ON products(client_id, store_id, sku COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_variants_scope_sku_nocase
  ON product_variants(client_id, store_id, product_id, sku COLLATE NOCASE);

-- Scheduled integration discovery is provider/status ordered by freshness.
CREATE INDEX IF NOT EXISTS idx_store_connections_provider_status_updated
  ON store_connections(provider, status, updated_at DESC, client_id);
