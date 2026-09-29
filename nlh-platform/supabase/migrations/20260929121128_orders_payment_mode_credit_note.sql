ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_mode_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_mode_check
  CHECK (payment_mode = ANY (ARRAY['upi','neft','cash','cheque','razorpay','other','credit_note']));
