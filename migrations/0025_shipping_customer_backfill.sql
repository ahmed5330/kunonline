-- Preview-only customer backfill from orders that have entered the shipping lifecycle.
-- Scope requested: preparing / shipped / signed / collected / returned.
-- Pending, confirmed, deferred and cancelled orders are deliberately excluded.
-- Existing customer records are preserved; only missing customers/links are filled.

-- 1) Create one Customer 360 record for every unique client/store/phone that already
--    has at least one order in the shipping lifecycle. The latest qualifying order is
--    used as the source for name/governorate/address.
INSERT INTO customers (
  id, client_id, store_id, name, phone, gov, address, tags, note, created_at
)
SELECT
  'CUS-' || UPPER(SUBSTR(HEX(RANDOMBLOB(8)), 1, 8)),
  ranked.client_id,
  ranked.store_id,
  COALESCE(ranked.name, ''),
  ranked.phone,
  COALESCE(ranked.gov, ''),
  COALESCE(ranked.address, ''),
  '[]',
  '',
  COALESCE(ranked.created_at, CURRENT_TIMESTAMP)
FROM (
  SELECT
    o.client_id,
    o.store_id,
    TRIM(o.phone) AS phone,
    o.name,
    o.gov,
    o.address,
    o.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY o.client_id, o.store_id, TRIM(o.phone)
      ORDER BY COALESCE(o.date, o.created_at) DESC, o.created_at DESC, o.id DESC
    ) AS rn
  FROM orders o
  WHERE o.state IN ('preparing','shipped','signed','collected','returned')
    AND TRIM(COALESCE(o.phone, '')) <> ''
) AS ranked
WHERE ranked.rn = 1
  AND NOT EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.client_id = ranked.client_id
      AND c.store_id IS ranked.store_id
      AND c.phone = ranked.phone
  );

-- 2) Complete missing customer profile fields from the latest qualifying shipping order,
--    without overwriting manually curated customer data that is already present.
UPDATE customers
SET
  name = CASE
    WHEN TRIM(COALESCE(customers.name, '')) = '' THEN COALESCE((
      SELECT o.name FROM orders o
      WHERE o.client_id = customers.client_id
        AND o.store_id IS customers.store_id
        AND TRIM(o.phone) = customers.phone
        AND o.state IN ('preparing','shipped','signed','collected','returned')
        AND TRIM(COALESCE(o.name, '')) <> ''
      ORDER BY COALESCE(o.date, o.created_at) DESC, o.created_at DESC, o.id DESC
      LIMIT 1
    ), customers.name)
    ELSE customers.name
  END,
  gov = CASE
    WHEN TRIM(COALESCE(customers.gov, '')) = '' THEN COALESCE((
      SELECT o.gov FROM orders o
      WHERE o.client_id = customers.client_id
        AND o.store_id IS customers.store_id
        AND TRIM(o.phone) = customers.phone
        AND o.state IN ('preparing','shipped','signed','collected','returned')
        AND TRIM(COALESCE(o.gov, '')) <> ''
      ORDER BY COALESCE(o.date, o.created_at) DESC, o.created_at DESC, o.id DESC
      LIMIT 1
    ), customers.gov)
    ELSE customers.gov
  END,
  address = CASE
    WHEN TRIM(COALESCE(customers.address, '')) = '' THEN COALESCE((
      SELECT o.address FROM orders o
      WHERE o.client_id = customers.client_id
        AND o.store_id IS customers.store_id
        AND TRIM(o.phone) = customers.phone
        AND o.state IN ('preparing','shipped','signed','collected','returned')
        AND TRIM(COALESCE(o.address, '')) <> ''
      ORDER BY COALESCE(o.date, o.created_at) DESC, o.created_at DESC, o.id DESC
      LIMIT 1
    ), customers.address)
    ELSE customers.address
  END
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.client_id = customers.client_id
    AND o.store_id IS customers.store_id
    AND TRIM(o.phone) = customers.phone
    AND o.state IN ('preparing','shipped','signed','collected','returned')
);

-- 3) Link every qualifying historical shipping order to its Customer 360 record.
UPDATE orders
SET customer_id = (
  SELECT c.id
  FROM customers c
  WHERE c.client_id = orders.client_id
    AND c.store_id IS orders.store_id
    AND c.phone = TRIM(orders.phone)
  LIMIT 1
)
WHERE orders.state IN ('preparing','shipped','signed','collected','returned')
  AND TRIM(COALESCE(orders.phone, '')) <> ''
  AND orders.customer_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.client_id = orders.client_id
      AND c.store_id IS orders.store_id
      AND c.phone = TRIM(orders.phone)
  );

CREATE INDEX IF NOT EXISTS idx_orders_shipping_customer_backfill
  ON orders(client_id, store_id, state, phone, customer_id);
