-- Reserve one voucher number that several franchisee_stock_returns rows
-- (one per SKU line) can share, the same way one order groups many
-- order_items under one order_ref/invoice_no. generate_sale_return_no()
-- only assigns a number when the row arrives with return_no still null, so
-- pre-stamping every line with the same reserved number groups them.
CREATE OR REPLACE FUNCTION public.next_sale_return_no() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.nlh_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN 'SR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sale_return_seq')::text, 4, '0');
END $$;
GRANT EXECUTE ON FUNCTION public.next_sale_return_no() TO authenticated;
