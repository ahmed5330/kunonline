-- Preview operational workflow additions: concurrent Customer Service contact claims
-- plus structured J&T Egypt address data for manually created orders.
-- Additive only: no existing rows are changed or deleted.

ALTER TABLE orders ADD COLUMN contact_claim_user_id TEXT;
ALTER TABLE orders ADD COLUMN contact_claim_name TEXT;
ALTER TABLE orders ADD COLUMN contact_claimed_at TEXT;

ALTER TABLE orders ADD COLUMN jnt_province TEXT;
ALTER TABLE orders ADD COLUMN jnt_city TEXT;
ALTER TABLE orders ADD COLUMN jnt_area TEXT;
ALTER TABLE orders ADD COLUMN jnt_street TEXT;
ALTER TABLE orders ADD COLUMN jnt_province_code TEXT;
ALTER TABLE orders ADD COLUMN jnt_city_code TEXT;
ALTER TABLE orders ADD COLUMN jnt_district_code TEXT;
ALTER TABLE orders ADD COLUMN jnt_country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_contact_claim ON orders(client_id,store_id,contact_claim_user_id,contact_claimed_at);
CREATE INDEX IF NOT EXISTS idx_orders_jnt_location ON orders(client_id,store_id,jnt_province,jnt_city,jnt_area);
