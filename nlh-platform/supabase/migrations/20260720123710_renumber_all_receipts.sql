-- No receipts have ever been issued, so renumber every existing payment into
-- the new per-centre series, oldest first, so each centre's run is in date order.
truncate receipt_counters;
update student_payments    set receipt_no = null;
update order_payments      set receipt_no = null;
update franchisee_payments set receipt_no = null;

-- Student fees — numbered within the student's own centre.
with ordered as (
  select p.id,
         centre_of_student(p.student_id) as centre,
         extract(year from p.paid_at)::int as yr,
         row_number() over (partition by centre_of_student(p.student_id),
                                         extract(year from p.paid_at)::int
                            order by p.paid_at, p.created_at, p.id) as n
  from student_payments p
)
update student_payments p set receipt_no =
  'ST-' || o.centre || '-' || o.yr || '-' || lpad(o.n::text, 4, '0')
from ordered o where o.id = p.id;

-- Order / kit payments — collected by HO.
with ordered as (
  select id, extract(year from paid_on)::int as yr,
         row_number() over (partition by extract(year from paid_on)::int
                            order by paid_on, created_at, id) as n
  from order_payments
)
update order_payments p set receipt_no =
  'OR-HO-' || o.yr || '-' || lpad(o.n::text, 4, '0')
from ordered o where o.id = p.id;

-- Franchisee enrolment fees — collected by HO.
with ordered as (
  select id, extract(year from payment_date)::int as yr,
         row_number() over (partition by extract(year from payment_date)::int
                            order by payment_date, created_at, id) as n
  from franchisee_payments
)
update franchisee_payments p set receipt_no =
  'FR-HO-' || o.yr || '-' || lpad(o.n::text, 4, '0')
from ordered o where o.id = p.id;

-- Leave the counters where the renumbering finished, so the next receipt continues.
insert into receipt_counters (series, centre_code, year, last_no)
select 'ST', centre_of_student(student_id), extract(year from paid_at)::int, count(*)
from student_payments group by 2, 3
union all
select 'OR', 'HO', extract(year from paid_on)::int, count(*) from order_payments group by 3
union all
select 'FR', 'HO', extract(year from payment_date)::int, count(*) from franchisee_payments group by 3
on conflict (series, centre_code, year) do update set last_no = excluded.last_no;
