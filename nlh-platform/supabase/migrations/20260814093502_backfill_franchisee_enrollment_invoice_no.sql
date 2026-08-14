do $$
declare r record;
begin
  for r in select id, contract_start, created_at from franchisees where enrollment_invoice_no is null order by created_at asc
  loop
    update franchisees set enrollment_invoice_no = next_receipt_no('FEI', 'HO',
        extract(year from coalesce(r.contract_start, r.created_at))::int)
    where id = r.id;
  end loop;
end $$;
