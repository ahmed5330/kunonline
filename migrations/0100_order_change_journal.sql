-- REVIEW-ONLY migration 0100. DO NOT run against Production or Preview D1
-- until signed-off schema inventory, backup, isolated QA, and rollback plan.
-- Database-level triggers capture ALL order write paths, including provider
-- webhooks/imports/shipping, not just individual application handlers.
-- No customer PII or order payload is stored in this journal.
CREATE TABLE IF NOT EXISTS order_change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  store_id TEXT,
  order_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert','remove')),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_order_change_log_scope
  ON order_change_log(client_id,store_id,seq);

CREATE TRIGGER IF NOT EXISTS trg_order_changelog_insert
AFTER INSERT ON orders BEGIN
  INSERT INTO order_change_log(client_id,store_id,order_id,operation)
    VALUES(NEW.client_id,NEW.store_id,NEW.id,'upsert');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_changelog_delete
AFTER DELETE ON orders BEGIN
  INSERT INTO order_change_log(client_id,store_id,order_id,operation)
    VALUES(OLD.client_id,OLD.store_id,OLD.id,'remove');
END;

-- Store/tenant transfers generate a tombstone for the old scope, and an
-- upsert for the new scope. Both run inside the same order UPDATE transaction.
-- No-op updates must NOT generate redundant events. Watch every schema-defined
-- order column, including late-added contact claims, J&T address and finance.
CREATE TRIGGER IF NOT EXISTS trg_order_changelog_update
AFTER UPDATE ON orders
WHEN OLD.id IS NOT NEW.id
    OR OLD.client_id IS NOT NEW.client_id
    OR OLD.store_id IS NOT NEW.store_id
    OR OLD.ref IS NOT NEW.ref
    OR OLD.customer_id IS NOT NEW.customer_id
    OR OLD.date IS NOT NEW.date
    OR OLD.name IS NOT NEW.name
    OR OLD.phone IS NOT NEW.phone
    OR OLD.gov IS NOT NEW.gov
    OR OLD.address IS NOT NEW.address
    OR OLD.product IS NOT NEW.product
    OR OLD.product_id IS NOT NEW.product_id
    OR OLD.variant_id IS NOT NEW.variant_id
    OR OLD.product_note IS NOT NEW.product_note
    OR OLD.unit_price IS NOT NEW.unit_price
    OR OLD.qty IS NOT NEW.qty
    OR OLD.total IS NOT NEW.total
    OR OLD.discount_amount IS NOT NEW.discount_amount
    OR OLD.coupon_code IS NOT NEW.coupon_code
    OR OLD.product_cost IS NOT NEW.product_cost
    OR OLD.shipping_cost IS NOT NEW.shipping_cost
    OR OLD.other_cost IS NOT NEW.other_cost
    OR OLD.source IS NOT NEW.source
    OR OLD.note IS NOT NEW.note
    OR OLD.awb IS NOT NEW.awb
    OR OLD.state IS NOT NEW.state
    OR OLD.checkpoint IS NOT NEW.checkpoint
    OR OLD.signed_at IS NOT NEW.signed_at
    OR OLD.collected_at IS NOT NEW.collected_at
    OR OLD.defer_until IS NOT NEW.defer_until
    OR OLD.refund_amount IS NOT NEW.refund_amount
    OR OLD.return_type IS NOT NEW.return_type
    OR OLD.restocked IS NOT NEW.restocked
    OR OLD.contact_log IS NOT NEW.contact_log
    OR OLD.history IS NOT NEW.history
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.collected_amount IS NOT NEW.collected_amount
    OR OLD.product_subtotal IS NOT NEW.product_subtotal
    OR OLD.customer_shipping_charge IS NOT NEW.customer_shipping_charge
    OR OLD.carrier_shipping_cost IS NOT NEW.carrier_shipping_cost
    OR OLD.business_shipping_cost IS NOT NEW.business_shipping_cost
    OR OLD.shipping_finance_mode IS NOT NEW.shipping_finance_mode
    OR OLD.shipping_finance_source IS NOT NEW.shipping_finance_source
    OR OLD.contact_claim_user_id IS NOT NEW.contact_claim_user_id
    OR OLD.contact_claim_name IS NOT NEW.contact_claim_name
    OR OLD.contact_claimed_at IS NOT NEW.contact_claimed_at
    OR OLD.jnt_province IS NOT NEW.jnt_province
    OR OLD.jnt_city IS NOT NEW.jnt_city
    OR OLD.jnt_area IS NOT NEW.jnt_area
    OR OLD.jnt_street IS NOT NEW.jnt_street
    OR OLD.jnt_province_code IS NOT NEW.jnt_province_code
    OR OLD.jnt_city_code IS NOT NEW.jnt_city_code
    OR OLD.jnt_district_code IS NOT NEW.jnt_district_code
    OR OLD.jnt_country_code IS NOT NEW.jnt_country_code
BEGIN
  INSERT INTO order_change_log(client_id,store_id,order_id,operation)
    SELECT OLD.client_id,OLD.store_id,OLD.id,'remove'
    WHERE OLD.id IS NOT NEW.id
       OR OLD.client_id IS NOT NEW.client_id
       OR OLD.store_id IS NOT NEW.store_id;
  INSERT INTO order_change_log(client_id,store_id,order_id,operation)
    VALUES(NEW.client_id,NEW.store_id,NEW.id,'upsert');
END;
