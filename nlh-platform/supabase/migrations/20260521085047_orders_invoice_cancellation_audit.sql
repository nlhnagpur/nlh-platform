
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_cancelled_by text;
