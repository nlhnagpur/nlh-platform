-- Monthly-billing cycle tracking, replacing the old global
-- "days left in the calendar month <= 5" check with a per-enrollment,
-- date-anchored cycle: cycle_started_at is this enrollment's own cycle
-- start (not the calendar month), and progress is counted as actual
-- batch_sessions held since then, against a sessions_per_cycle target
-- derived from the agreed weekly frequency (sessions_per_week).
--
-- Renewal moves cycle_started_at forward by hand (not a rigid +30
-- days) so a session or two either side of the boundary can be folded
-- into the next cycle's start date, per the user's own framing: "the
-- month has to be counted from date to date... we may consider a
-- couple of sessions and give a new starting date to the next month."
alter table enrollments add column sessions_per_week integer;
alter table enrollments add column sessions_per_cycle integer;
alter table enrollments add column cycle_started_at date;

-- Backfill existing monthly-billing enrollments' cycle_started_at to
-- their enrollment date, so the new logic has a real starting point
-- immediately instead of every one reading as "just started" from
-- today.
update enrollments e
set cycle_started_at = e.enrolled_at::date
from skus s join courses c on c.id = s.course_id
where s.id = e.sku_id and c.billing_type = 'monthly'
  and e.cycle_started_at is null
  and e.completed_at is null and e.status <> 'discontinued';
