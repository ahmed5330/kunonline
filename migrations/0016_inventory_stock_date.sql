-- Preview-only additive migration: explicit business date for inventory additions/adjustments.
ALTER TABLE stock_log ADD COLUMN stock_date TEXT;

-- Existing movements keep their original business date based on creation timestamp.
UPDATE stock_log
SET stock_date = substr(created_at,1,10)
WHERE stock_date IS NULL OR trim(stock_date)='';

CREATE INDEX IF NOT EXISTS idx_stocklog_stock_date
ON stock_log (client_id, store_id, stock_date);

-- Backward-compatible default for older stock-writing routes that do not yet pass stock_date.
CREATE TRIGGER IF NOT EXISTS trg_stock_log_default_stock_date
AFTER INSERT ON stock_log
WHEN NEW.stock_date IS NULL OR trim(NEW.stock_date)=''
BEGIN
  UPDATE stock_log
  SET stock_date = substr(NEW.created_at,1,10)
  WHERE id = NEW.id;
END;
