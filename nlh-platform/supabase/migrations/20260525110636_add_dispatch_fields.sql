
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dispatch_date     date,
  ADD COLUMN IF NOT EXISTS dispatch_weight   numeric(8,3),
  ADD COLUMN IF NOT EXISTS dispatch_freight  integer DEFAULT 0;
