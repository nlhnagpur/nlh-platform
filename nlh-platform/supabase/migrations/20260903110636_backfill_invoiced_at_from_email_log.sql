-- The first invoiced_at backfill used orders.updated_at as its best-effort
-- proxy — turned out orders has no updated_at-maintaining trigger at all,
-- so it just carries the insert-time value forever and was identical to
-- created_at for every historical row (proved wrong immediately: checked
-- ORD-2026-0018, which the user flagged as still showing its 20 Aug
-- proforma date, not its real invoice date).
--
-- email_log records exactly when each "Invoice INV-... from New Learning
-- Horizons" email actually went out — sent right after invoicing, so it's
-- a much more honest signal than updated_at. Reset and redo the backfill
-- from that instead; a handful of the earliest orders (INV-2026-0001..6)
-- predate email_log and are left null, falling back to created_at in the
-- UI rather than guessing.

update orders o set invoiced_at = e.first_sent
from (
  select regexp_replace(subject, '^Invoice (INV-\d{4}-\d{4}).*', '\1') as invoice_no, min(created_at) as first_sent
  from email_log
  where subject ilike 'Invoice INV-%'
  group by 1
) e
where o.invoice_no = e.invoice_no;
