
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS sell_price integer NOT NULL DEFAULT 0;   -- price when sold separately (₹); kit-bundled = free
;
