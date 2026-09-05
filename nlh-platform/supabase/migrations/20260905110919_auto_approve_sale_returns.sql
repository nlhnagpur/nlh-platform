-- Sale returns are now raised fully automated and pre-approved (app code
-- inserts status='approved' directly, no manual approval step) — the
-- user's own words: "the process of sales return and stock and amount
-- credit should be automated only, if any changes need to be made then
-- will manually update the sales return voucher". The number-assigning
-- trigger previously only fired on the pending->approved UPDATE that no
-- longer happens; it must now also fire on INSERT so a return_no is
-- assigned immediately.

create or replace function generate_sale_return_no()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'approved' and new.return_no is null then
    new.return_no := 'SR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sale_return_seq')::text, 4, '0');
    if new.approved_at is null then
      new.approved_at := now();
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sale_return_no on franchisee_stock_returns;
create trigger trg_sale_return_no
before insert or update on franchisee_stock_returns
for each row execute function generate_sale_return_no();
