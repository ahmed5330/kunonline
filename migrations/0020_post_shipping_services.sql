-- Manual carrier settlement recorded by the post-shipping team.
ALTER TABLE orders ADD COLUMN collected_amount REAL;
CREATE INDEX IF NOT EXISTS idx_orders_post_shipping ON orders(client_id,store_id,state,collected_at);
