
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_to_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_to       text;
