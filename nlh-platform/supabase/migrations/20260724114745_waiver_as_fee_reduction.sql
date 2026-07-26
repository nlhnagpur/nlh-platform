-- A waiver is now treated exactly like a discount: it reduces the specific
-- course's fee and the student's agreed total, so balance = fee_total-fee_paid
-- is correct everywhere with nothing to subtract. The amount is kept per course
-- so a discontinuation can be reversed.
alter table enrollments add column if not exists waived integer not null default 0;

-- Convert existing waived students (student-level waived_amount) into the new
-- per-course shape: reduce each dropped course's fee_amount and the student's
-- fee_total by that course's outstanding, recorded oldest-first exactly as the
-- app settled it.
with base as (
  select s.id as student_id, s.fee_total, s.other_charges,
         coalesce((select sum(e.fee_amount) from enrollments e where e.student_id=s.id),0) as course_sum,
         coalesce((select sum(p.amount) from student_payments p where p.student_id=s.id),0) as paid
  from students s where coalesce(s.waived_amount,0) > 0
),
cred as (
  select student_id, fee_total,
         paid + greatest(0, course_sum + coalesce(other_charges,0) - fee_total) as credits
  from base
),
rows as (
  select e.id, e.student_id, e.fee_amount, e.status,
         coalesce(sum(e.fee_amount) over (partition by e.student_id
           order by e.enrolled_at, e.created_at, e.id
           rows between unbounded preceding and current row) - e.fee_amount, 0) as cum_before
  from enrollments e
  where e.student_id in (select student_id from base)
),
due as (
  select r.id, r.student_id, r.status, r.fee_amount,
         greatest(0, r.fee_amount - greatest(0, least(r.fee_amount, c.credits - r.cum_before))) as due
  from rows r join cred c on c.student_id = r.student_id
)
update enrollments e
set waived     = case when e.status = 'dropped' then d.due else 0 end,
    fee_amount = case when e.status = 'dropped' then e.fee_amount - d.due else e.fee_amount end
from due d where d.id = e.id;

-- Fold the total waived out of each student's agreed fee; keep waived_amount as
-- the running record for the banner (no balance math reads it any more).
update students s set
  fee_total = s.fee_total - coalesce((select sum(e.waived) from enrollments e where e.student_id = s.id), 0),
  waived_amount = coalesce((select sum(e.waived) from enrollments e where e.student_id = s.id), 0)
where coalesce(s.waived_amount,0) > 0;
