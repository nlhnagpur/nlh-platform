-- The Orders list's "Date" column showed order.created_at unconditionally
-- — for a proforma converted to a real invoice later, that's the original
-- order/proforma date, not when the invoice was actually generated
-- (reported live: ORD-2026-0018 showed 20 Aug, the proforma date, even
-- though INV-2026-0024 wasn't issued until the order was later converted).
-- Add a real invoiced_at column, set alongside invoice_no by the same
-- trigger that already assigns it, so there's an honest source for "when
-- was this actually invoiced" instead of overloading created_at.

alter table orders add column invoiced_at timestamptz;

create or replace function generate_invoice_no()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'invoiced' and old.status in ('pending','proforma') and new.invoice_no is null then
    new.invoice_no := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0');
    new.invoiced_at := now();
  end if;
  return new;
end;
$function$;

-- Backfill existing invoiced orders as best-effort: updated_at is the
-- closest available signal (bumped by that same status-changing update),
-- better than leaving every historical invoice showing its order date.
update orders set invoiced_at = updated_at where invoice_no is not null and invoiced_at is null;
