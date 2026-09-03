-- Phase 3 infrastructure: keeps transactions.amount_paid/status derived
-- from transaction_payments automatically, mirroring the existing
-- sync_order_payment_total() pattern. For franchise_fee specifically, also
-- re-pulls `total` live from franchisees.enrollment_fee on every payment
-- change rather than storing a second copy that could drift if the fee is
-- edited after the Transaction row was created.

create or replace function sync_transaction_payment_total()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx      uuid := coalesce(new.transaction_id, old.transaction_id);
  v_paid    integer;
  v_type    text;
  v_party   uuid;
  v_status  text;
  v_total   integer;
begin
  select coalesce(sum(amount), 0) into v_paid from transaction_payments where transaction_id = v_tx;
  select type, party_id, status, total into v_type, v_party, v_status, v_total from transactions where id = v_tx;

  if v_type = 'franchise_fee' then
    select coalesce(enrollment_fee, 0) into v_total from franchisees where id = v_party;
  end if;

  update transactions set
    total = v_total,
    amount_paid = v_paid,
    status = case
      when v_status = 'cancelled' then v_status
      when v_total > 0 and v_paid >= v_total then 'paid'
      when v_paid > 0 then 'part_paid'
      else v_status
    end
  where id = v_tx;

  return null;
end;
$function$;

create trigger trg_sync_transaction_payment_total
after insert or update or delete on transaction_payments
for each row execute function sync_transaction_payment_total();
