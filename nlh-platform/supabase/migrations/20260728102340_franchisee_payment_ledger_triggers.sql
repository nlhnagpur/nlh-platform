-- Bring franchisee fees up to the same trigger-enforced ledger as students and
-- orders. Until now franchisees.fee_paid was kept in sync by the browser
-- (fee_paid + amount), which is the fragile pattern that let an order double-
-- count. Now the DB owns it, and overpayment past the franchise fee is refused.

-- Keep franchisees.fee_paid = sum(franchisee_payments) on every change.
create or replace function sync_franchisee_fee_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_fr uuid := coalesce(NEW.franchisee_id, OLD.franchisee_id);
begin
  update franchisees
    set fee_paid = coalesce((select sum(amount) from franchisee_payments where franchisee_id = v_fr), 0)
    where id = v_fr;
  return null;
end $$;

drop trigger if exists trg_sync_franchisee_fee on franchisee_payments;
create trigger trg_sync_franchisee_fee
  after insert or update or delete on franchisee_payments
  for each row execute function sync_franchisee_fee_paid();

-- Refuse a payment that would take the total past the agreed franchise fee.
-- enrollment_fee = 0/null (fee not set yet) leaves it unconstrained.
create or replace function check_franchisee_payment_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_other integer; v_fee integer;
begin
  select coalesce(sum(amount),0) into v_other
    from franchisee_payments where franchisee_id = NEW.franchisee_id and id <> NEW.id;
  select coalesce(enrollment_fee,0) into v_fee from franchisees where id = NEW.franchisee_id;
  if v_fee > 0 and v_other + NEW.amount > v_fee then
    raise exception 'Payment of % would take the total to % against a franchise fee of %',
      NEW.amount, v_other + NEW.amount, v_fee;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_check_franchisee_payment on franchisee_payments;
create trigger trg_check_franchisee_payment
  before insert or update on franchisee_payments
  for each row execute function check_franchisee_payment_total();
