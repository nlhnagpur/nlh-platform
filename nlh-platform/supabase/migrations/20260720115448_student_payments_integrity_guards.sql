-- student_payments already has a ledger + rollup trigger (recompute_student_fee_paid),
-- but nothing stopped a fee being recorded twice or beyond the total, which is
-- exactly what went wrong on the order side.

-- A payment is money in; zero or negative is always a mistake.
alter table student_payments add constraint student_payments_amount_positive
  check (amount > 0);

-- 'opening' is the historic opening-balance marker used by the backfilled rows.
alter table student_payments add constraint student_payments_mode_check
  check (mode is null or mode = any (array['upi','neft','cash','cheque','razorpay','other','opening']));

-- Never let receipts exceed the fee. fee_total is nullable / 0 for students
-- whose fee isn't set yet — leave those unconstrained rather than blocking entry.
create or replace function check_student_payment_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_other integer; v_total integer;
begin
  select coalesce(sum(amount),0) into v_other
  from student_payments where student_id = NEW.student_id and id <> NEW.id;
  select coalesce(fee_total,0) into v_total from students where id = NEW.student_id;
  if v_total > 0 and v_other + NEW.amount > v_total then
    raise exception 'Payment of % would take the total to % against a fee of %',
      NEW.amount, v_other + NEW.amount, v_total;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_check_student_payment on student_payments;
create trigger trg_check_student_payment
  before insert or update on student_payments
  for each row execute function check_student_payment_total();
