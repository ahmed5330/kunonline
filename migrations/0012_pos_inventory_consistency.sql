-- Preview-only POS inventory consistency guard.
-- A temporary CHECK row makes an insufficient concurrent sale fail the whole
-- D1 batch, so the sale, item rows, stock decrement and stock log stay atomic.
CREATE TABLE IF NOT EXISTS pos_stock_guards (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  qty_after INTEGER NOT NULL CHECK (qty_after >= 0)
);
CREATE INDEX IF NOT EXISTS idx_pos_stock_guards_sale ON pos_stock_guards(sale_id);
