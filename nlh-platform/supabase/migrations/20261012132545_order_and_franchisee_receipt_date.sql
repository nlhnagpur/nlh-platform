-- Same principle as student receipts: the receipt carries its own issue date
-- (receipt_date), separate from the day the money was received (paid_on /
-- payment_date). Existing rows had one date, so both are equal for them.
alter table order_payments add column if not exists receipt_date date;
update order_payments set receipt_date = coalesce(paid_on, created_at::date) where receipt_date is null;
alter table order_payments alter column receipt_date set default current_date;
alter table order_payments alter column receipt_date set not null;

alter table franchisee_payments add column if not exists receipt_date date;
update franchisee_payments set receipt_date = coalesce(payment_date, created_at::date) where receipt_date is null;
alter table franchisee_payments alter column receipt_date set default current_date;
alter table franchisee_payments alter column receipt_date set not null;
