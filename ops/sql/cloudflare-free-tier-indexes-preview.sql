-- Kun Online Preview — Cloudflare D1 free-tier protection indexes.
-- MANUAL MAINTENANCE ONLY. Do not run automatically from CI.
-- Apply only when the D1 daily write quota has reset and while monitoring usage.
-- Additive only: no deletes, backfills, resets, or destructive schema changes.
-- Prefer applying one statement at a time so index construction itself cannot consume the whole free-tier write budget unexpectedly.

-- P0: Easy Orders recovery / recent-order reads.
CREATE INDEX IF NOT EXISTS idx_orders_easyorders_recovery
  ON orders(client_id, source, created_at DESC);

-- P0: Targeted provider-id / reference matching inside a tenant/store.
CREATE INDEX IF NOT EXISTS idx_orders_scope_ref
  ON orders(client_id, store_id, ref);

-- P0: Deferred-order wake-up checks should not scan the whole orders table.
CREATE INDEX IF NOT EXISTS idx_orders_deferred_due
  ON orders(state, defer_until)
  WHERE state='deferred' AND defer_until IS NOT NULL;

-- P1: Dashboard date-range queries use this exact expression repeatedly.
CREATE INDEX IF NOT EXISTS idx_orders_scope_effective_date
  ON orders(client_id, store_id, date(COALESCE(date, created_at)));

CREATE INDEX IF NOT EXISTS idx_transactions_scope_effective_date
  ON transactions(client_id, store_id, date(COALESCE(date, created_at)));

-- P1: Price sync performs case-insensitive SKU lookups.
CREATE INDEX IF NOT EXISTS idx_products_scope_sku_nocase
  ON products(client_id, store_id, sku COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_variants_scope_sku_nocase
  ON product_variants(client_id, store_id, product_id, sku COLLATE NOCASE);

-- P1: Scheduled integration discovery is provider/status ordered by freshness.
CREATE INDEX IF NOT EXISTS idx_store_connections_provider_status_updated
  ON store_connections(provider, status, updated_at DESC, client_id);
