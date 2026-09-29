-- return_no now identifies a VOUCHER, not a single row — several rows (one per
-- SKU line) can share it, the same way order_ref/invoice_no isn't unique per
-- order_items row. Index it for lookups instead of a uniqueness constraint.
ALTER TABLE public.franchisee_stock_returns DROP CONSTRAINT IF EXISTS franchisee_stock_returns_return_no_key;
CREATE INDEX IF NOT EXISTS franchisee_stock_returns_return_no_idx ON public.franchisee_stock_returns (return_no);
