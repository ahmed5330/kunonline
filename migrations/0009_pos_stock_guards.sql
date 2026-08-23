-- Preview-only POS stock safety guards.
-- D1 batch is atomic; these triggers make insufficient stock abort the whole sale batch.
CREATE TRIGGER IF NOT EXISTS trg_pos_item_variant_stock_guard
BEFORE INSERT ON pos_sale_items
WHEN NEW.variant_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT stock FROM product_variants WHERE id=NEW.variant_id),-1) < NEW.qty
    THEN RAISE(ABORT,'POS_INSUFFICIENT_VARIANT_STOCK')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_pos_item_product_stock_guard
BEFORE INSERT ON pos_sale_items
WHEN NEW.variant_id IS NULL
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT stock FROM products WHERE id=NEW.product_id),-1) < NEW.qty
    THEN RAISE(ABORT,'POS_INSUFFICIENT_PRODUCT_STOCK')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_pos_item_variant_stock_decrement
AFTER INSERT ON pos_sale_items
WHEN NEW.variant_id IS NOT NULL
BEGIN
  UPDATE product_variants SET stock=stock-NEW.qty WHERE id=NEW.variant_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_pos_item_product_stock_decrement
AFTER INSERT ON pos_sale_items
WHEN NEW.variant_id IS NULL
BEGIN
  UPDATE products SET stock=stock-NEW.qty WHERE id=NEW.product_id;
END;
