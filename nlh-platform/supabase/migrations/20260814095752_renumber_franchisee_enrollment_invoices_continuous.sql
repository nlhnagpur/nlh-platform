-- Switch enrollment invoice numbers from the per-year FEI-HO-YYYY-XXXX
-- scheme (which produced three separate "0001"s across 2023/2025/2026,
-- confusing since it's the only receipt series meant to be read as one
-- continuous roll of franchisees) to one flat, permanent sequence
-- starting at 0001, in the order franchisees actually joined.
create sequence if not exists franchisee_enrollment_invoice_seq start 1;

create or replace function assign_franchisee_enrollment_invoice_no()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.enrollment_invoice_no is null then
    new.enrollment_invoice_no := 'FEI-HO-' || lpad(nextval('franchisee_enrollment_invoice_seq')::text, 4, '0');
  end if;
  return new;
end
$function$;

do $$
declare r record;
begin
  for r in select id from franchisees order by created_at asc
  loop
    update franchisees
    set enrollment_invoice_no = 'FEI-HO-' || lpad(nextval('franchisee_enrollment_invoice_seq')::text, 4, '0')
    where id = r.id;
  end loop;
end $$;
