-- receipt_no now identifies a RECEIPT, not a single row — a payment split
-- across several invoices shares one number across the several order_payments
-- rows it creates, the same way a Sale Return voucher shares return_no.
ALTER TABLE public.order_payments DROP CONSTRAINT IF EXISTS order_payments_receipt_no_key;
CREATE INDEX IF NOT EXISTS order_payments_receipt_no_idx ON public.order_payments (receipt_no);

CREATE OR REPLACE FUNCTION public.next_order_receipt_no() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.nlh_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN public.next_receipt_no('OR', 'HO', extract(year from now())::int);
END $$;
GRANT EXECUTE ON FUNCTION public.next_order_receipt_no() TO authenticated;
