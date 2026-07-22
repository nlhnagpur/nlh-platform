-- Student fee payments get RCP-YYYY-NNNN; franchisee order payments got nothing,
-- so money received against a kit invoice had no receipt to hand back.
-- Same sequence for both, so the business has ONE continuous receipt series.
alter table order_payments add column if not exists receipt_no text unique;

create or replace function assign_order_receipt_no() returns trigger
language plpgsql as $$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := 'RCP-' || to_char(now(),'YYYY') || '-' ||
                      lpad(nextval('public.receipt_seq')::text, 4, '0');
  end if;
  return NEW;
end $$;

drop trigger if exists trg_order_receipt_no on order_payments;
create trigger trg_order_receipt_no
  before insert on order_payments
  for each row execute function assign_order_receipt_no();

-- Backfilled historic rows are reconstructions, not receipts that were ever
-- issued — number them so they can be referenced, flagged by their note.
update order_payments set receipt_no = 'RCP-' || to_char(created_at,'YYYY') || '-' ||
       lpad(nextval('public.receipt_seq')::text, 4, '0')
where receipt_no is null;
