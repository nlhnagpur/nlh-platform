-- The Record Payment dropdown offers bank_transfer / card / online, which the
-- first version of this constraint would have rejected — the same mismatch
-- that made every order part-payment fail. Match the UI exactly.
alter table student_payments drop constraint student_payments_mode_check;
alter table student_payments add constraint student_payments_mode_check
  check (mode is null or mode = any (array[
    'cash','upi','bank_transfer','cheque','card','online',   -- the dropdown
    'neft','razorpay','other',                               -- other flows
    'opening'                                                -- historic opening balance
  ]));
