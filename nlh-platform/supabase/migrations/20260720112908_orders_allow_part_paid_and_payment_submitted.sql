-- The app writes 'part_paid' (Record Payment, partial) and 'payment_submitted'
-- (Razorpay handler) but the CHECK constraint rejected both, so the whole
-- UPDATE was refused — including amount_paid. Part payments never saved.
alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status = any (array['pending','invoiced','part_paid','payment_submitted','dispatched','closed']));

-- Record Payment offers an "Other" mode that the constraint also rejected.
alter table orders drop constraint orders_payment_mode_check;
alter table orders add constraint orders_payment_mode_check
  check (payment_mode = any (array['upi','neft','cash','cheque','razorpay','other']));
