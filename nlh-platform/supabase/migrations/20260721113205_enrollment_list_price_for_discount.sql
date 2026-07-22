-- Snapshot of the catalogue price at the moment of registration, so the
-- discount given on a course stays true even after the SKU is repriced. The
-- discount is list_price - fee_amount: derived from two stored figures rather
-- than looked up live, which is what makes it a durable record.
--
-- NOTE: students.discount_amount is NOT this. That column holds the COUPON
-- discount and the coupon-reversal maths reads it as (fee_total + discount)
-- to recover the gross — writing package discounts there would corrupt it.
alter table enrollments add column if not exists list_price integer;

update enrollments e
set list_price = coalesce(k.student_fee, e.fee_amount, 0)
from skus k
where k.id = e.sku_id and e.list_price is null;

-- Enrolments with no SKU price on file: the charged amount is the list price.
update enrollments set list_price = coalesce(fee_amount, 0) where list_price is null;

-- New enrolments record both: what the course lists at, and what was charged.
create or replace function default_enrollment_fee() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_list integer;
begin
  select coalesce(student_fee, 0) into v_list from skus where id = NEW.sku_id;
  if NEW.list_price is null then NEW.list_price := coalesce(v_list, 0); end if;
  if NEW.fee_amount is null then NEW.fee_amount := coalesce(v_list, 0); end if;
  return NEW;
end $$;
