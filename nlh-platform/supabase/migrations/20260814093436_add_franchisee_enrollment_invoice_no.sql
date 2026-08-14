alter table franchisees add column enrollment_invoice_no text;

create or replace function assign_franchisee_enrollment_invoice_no()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.enrollment_invoice_no is null then
    new.enrollment_invoice_no := next_receipt_no('FEI', 'HO',
                                  extract(year from coalesce(new.contract_start, current_date))::int);
  end if;
  return new;
end
$function$;

create trigger trg_fr_enrollment_invoice_no
  before insert on public.franchisees
  for each row execute function assign_franchisee_enrollment_invoice_no();
