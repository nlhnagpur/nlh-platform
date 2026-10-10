-- Receipt date (when the receipt is issued) is now separate from paid_at (the
-- day the money was received). Existing receipts only ever had one date, so
-- both are the same for them.
alter table student_payments add column if not exists receipt_date date;
alter table student_payments add column if not exists receipt_no_previous text;
update student_payments set receipt_date = coalesce(paid_at, created_at::date) where receipt_date is null;
alter table student_payments alter column receipt_date set default current_date;
alter table student_payments alter column receipt_date set not null;

-- Renumber every student receipt from the beginning, per centre/year series,
-- in date order (payment date, then entry order). Old numbers are kept in
-- receipt_no_previous.
create temp table _rn on commit drop as
with parsed as (
  select id, receipt_no as old_no,
         regexp_replace(receipt_no, '-\d+$', '') as prefix,
         paid_at, created_at
  from student_payments
  where receipt_no ~ '^ST-.+-\d{4}-\d+$'
)
select id, old_no, prefix,
       prefix || '-' || lpad((row_number() over (partition by prefix order by paid_at, created_at, id))::text, 4, '0') as new_no
from parsed;

update student_payments p set receipt_no = 'TMP-' || p.id::text from _rn r where r.id = p.id and r.old_no <> r.new_no;
update student_payments p set receipt_no = r.new_no, receipt_no_previous = r.old_no from _rn r where r.id = p.id and r.old_no <> r.new_no;

-- the mirrored ledger carries the same numbers
update transaction_payments t set receipt_no = r.new_no from _rn r where t.receipt_no = r.old_no and r.old_no <> r.new_no;

-- counters continue from the last number actually issued
update receipt_counters c set last_no = x.n
from (select prefix, count(*) n from _rn group by prefix) x
where c.series = 'ST' and x.prefix = 'ST-' || c.centre_code || '-' || c.year;
