ALTER TABLE public.order_payments DROP CONSTRAINT IF EXISTS order_payments_mode_check;
ALTER TABLE public.order_payments ADD CONSTRAINT order_payments_mode_check
  CHECK (mode = ANY (ARRAY['upi','neft','cash','cheque','razorpay','other','credit_note']));

ALTER TABLE public.franchisee_stock_returns
  ADD COLUMN IF NOT EXISTS applied_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_order_payment_id uuid REFERENCES public.order_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_amount integer;
