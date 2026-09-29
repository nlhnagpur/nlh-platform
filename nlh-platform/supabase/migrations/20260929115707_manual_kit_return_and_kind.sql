-- 1) A genuine physical return (franchisee ships a kit/book back to HO) is a
--    different kind of Sale Return from the auto-generated "fulfilled by"
--    credit — it isn't fulfilling anyone else's order, so fulfills_order_id
--    must be optional for it.
ALTER TABLE public.franchisee_stock_returns ALTER COLUMN fulfills_order_id DROP NOT NULL;
ALTER TABLE public.franchisee_stock_returns ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cf_fulfillment';
ALTER TABLE public.franchisee_stock_returns DROP CONSTRAINT IF EXISTS franchisee_stock_returns_kind_check;
ALTER TABLE public.franchisee_stock_returns ADD CONSTRAINT franchisee_stock_returns_kind_check
  CHECK (kind IN ('cf_fulfillment','physical_return'));
ALTER TABLE public.franchisee_stock_returns ADD COLUMN IF NOT EXISTS note text;
